"""End-to-end agent runs over all four simulated scenarios, then human review.

All four runs start together (one AgentManager each, because AgentManager.start cancels its previous run) and
share the session analysis cache, so the whole module costs roughly one pass over the distinct clips."""
from __future__ import annotations

import time

import pytest

from clearpath.agent.orchestrator import AgentManager, Run, load_scenarios
from clearpath.twin.building import Building

from .conftest import CachingVisionClient

SCENARIOS = {s["id"]: s for s in load_scenarios()["scenarios"]}
TIMEOUT_S = 420


def wait_for(run: Run, pred, timeout: float = TIMEOUT_S) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = run.snapshot()
        if st["status"] == "error":
            pytest.fail(f"run {run.id} errored: {st['error']}")
        if pred(st):
            return st
        time.sleep(0.25)
    pytest.fail(f"timeout waiting on run {run.id}: status {run.state['status']}")


def awaiting(n_reviews: int = 0):
    return lambda st: st["status"] == "awaiting_review" and len(st["review_history"]) == n_reviews


@pytest.fixture(scope="module")
def runs():
    b = Building.load()
    started = {sid: AgentManager(b, CachingVisionClient()).start(sid, step_delay=0, background=True) for sid in SCENARIOS}
    done = {sid: (r, wait_for(r, awaiting(0))) for sid, r in started.items()}
    yield done
    for r in started.values():
        r.cancelled = True


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_recommendation_matches_expected(runs, sid):
    _, st = runs[sid]
    assert st["assessment"]["recommended"] == SCENARIOS[sid]["expected"]["primary_option"]
    assert st["review"]["allowed_actions"] == ["approve", "reject", "more_evidence", "block_exit"]
    assert st["simulation"] is True
    assert st["metrics"]["vision_calls"] >= 3
    # Every trace step is explainable: a title, and tool calls carry name + args + duration.
    for t in st["trace"]:
        assert t["title"]
        if t["kind"] == "tool_call" and t["tool"]:
            assert {"name", "args", "duration_ms"} <= set(t["tool"])


@pytest.mark.parametrize("sid", ["S2-corroborated-east", "S4-west-threat-congested-exit"])
def test_threat_region(runs, sid):
    _, st = runs[sid]
    expected = set(SCENARIOS[sid]["expected"]["threat_region"])
    assert st["belief"]["localized"] is True
    assert st["belief"]["region"][0] in expected
    assert set(st["belief"]["region"]) <= expected
    assert st["belief"]["supporting_observations"] >= 1


def test_s1_report_not_corroborated(runs):
    _, st = runs["S1-unverified-report"]
    assert st["belief"]["p_threat"] < 0.15
    assert st["belief"]["localized"] is False
    assert any("not corroborated" in t["reason"] for t in st["trace"] if t["title"] == "Stop gathering evidence")


def test_s3_gaps_and_dehaze_reanalysis(runs):
    _, st = runs["S3-degraded-sensing"]
    gap_cams = {g["camera_id"] for g in st["gaps"]}
    assert {"CAM-04", "CAM-02"} <= gap_cams
    assert st["metrics"]["reanalyses"] >= 1
    assert any(a["params"]["enhance"] == "dehaze" for a in st["analyses"].values())
    assert st["cameras"]["CAM-04"]["status"] == "fault"
    assert st["belief"]["localized"] is False
    assert any("CAM-04" in u for u in st["assessment"]["uncertainty"])


def test_s4_congested_route_flagged(runs):
    _, st = runs["S4-west-threat-congested-exit"]
    congested = [r for r in st["routing"]["routes"] if r["operational_status"] == "congested"]
    assert congested and all(r["math_valid"] and not r["safe"] for r in congested)
    assert any("C3" in r["operational"]["congested_zones"] for r in congested)


def test_approve_completes_with_simulated_actions(runs):
    for sid in ("S1-unverified-report", "S3-degraded-sensing"):
        run, st = runs[sid]
        run.submit_review({"action": "approve", "reviewer": "pytest"})
        st = wait_for(run, lambda s: s["status"] == "complete")
        assert st["approved_option"] == SCENARIOS[sid]["expected"]["primary_option"]
        assert st["action_log"]
        assert all(line.startswith("SIMULATED") for line in st["action_log"])
        with pytest.raises(ValueError):
            run.submit_review({"action": "approve"})  # no longer awaiting review


def test_reject_reassesses_to_a_different_option(runs):
    run, st = runs["S2-corroborated-east"]
    first = st["assessment"]["recommended"]
    run.submit_review({"action": "reject", "option_id": first, "reviewer": "pytest", "note": "test"})
    st2 = wait_for(run, awaiting(1))
    assert st2["assessment"]["recommended"] != first
    assert st2["assessment"]["recommended"] == "LOCKDOWN"
    assert next(o for o in st2["assessment"]["options"] if o["id"] == first)["rejected_by_reviewer"]
    run.submit_review({"action": "approve", "reviewer": "pytest"})
    st3 = wait_for(run, lambda s: s["status"] == "complete")
    assert st3["approved_option"] == "LOCKDOWN"
    assert all(line.startswith("SIMULATED") for line in st3["action_log"])


def test_block_exit_recomputes_routes(runs):
    run, st = runs["S4-west-threat-congested-exit"]
    used = {r["exit"] for r in st["routing"]["routes"] if r["exit"]}
    assert "EX-GYM" in used
    run.submit_review({"action": "block_exit", "exit_id": "EX-GYM", "reviewer": "pytest"})
    st2 = wait_for(run, awaiting(1))
    assert "EX-GYM" in st2["routing"]["blocked_exits"]
    for r in st2["routing"]["routes"]:
        assert r["exit"] != "EX-GYM" and "EX-GYM" not in r["path"]
    assert st2["metrics"]["vision_calls"] == st["metrics"]["vision_calls"]  # re-assessment, no new evidence needed
    run.cancelled = True
    wait_for(run, lambda s: s["status"] == "cancelled", timeout=10)
