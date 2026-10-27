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
def first_pass():
    """Each scenario run until the first review request: no observation has a verified location yet."""
    b = Building.load()
    started = {sid: AgentManager(b, CachingVisionClient()).start(sid, step_delay=0, background=True) for sid in SCENARIOS}
    done = {sid: (r, wait_for(r, awaiting(0))) for sid, r in started.items()}
    yield done
    for r in started.values():
        r.cancelled = True


@pytest.fixture(scope="module")
def runs(first_pass):
    """The same runs after a reviewer confirmed the location of every pending observation (one decision)."""
    out = {}
    for sid, (r, _) in first_pass.items():
        r.submit_review({"action": "confirm_observation", "camera_ids": sorted(r.pending), "reviewer": "pytest"})
        out[sid] = (r, wait_for(r, awaiting(1)))
    return out


# ---------------------------------------------------------------- regression: location attribution
@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_unverified_footage_never_raises_zone_alerts(first_pass, sid):
    """Bug: outdoor sample footage replayed on indoor cameras raised threat zones inside the school.
    Before a human confirms, no zone may be alerted or localised and every observation's location is unknown."""
    run, st = first_pass[sid]
    assert st["assessment"]["recommended"] == SCENARIOS[sid]["expected"]["before_confirmation"]
    assert st["belief"]["localized"] is False
    assert st["belief"]["supporting_observations"] == 0
    assert all(z["status"] in {"normal", "unknown"} for z in st["zones"].values())
    assert st["observations"], "observations must be kept, not dropped"
    for cid, o in st["observations"].items():
        assert o["location"]["zone"] is None
        assert o["location"]["status"] == "unverified"
        assert o["location"]["camera_zone"] == st["cameras"][cid]["zone"]
        assert any("outdoor" in why for why in o["location"]["reasons"])
        if o["kind"] != "fault":
            assert o["review"]["status"] == "pending" and o["applied"] is False
    assert set(st["review"]["pending_observations"]) == {c for c, o in st["observations"].items() if o["kind"] != "fault"}
    # flight observations are surfaced as candidate events with the running tracks that caused them
    for o in st["observations"].values():
        if o["activity"] == "flight":
            assert o["kind"] == "candidate_event" and o["running_track_ids"]


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_recommendation_matches_expected(runs, sid):
    _, st = runs[sid]
    assert st["assessment"]["recommended"] == SCENARIOS[sid]["expected"]["primary_option"]
    assert st["review"]["allowed_actions"][:4] == ["approve", "reject", "more_evidence", "block_exit"]
    assert {"confirm_observation", "dismiss_observation"} <= set(st["review"]["allowed_actions"])
    assert all(o["review"]["status"] in {"confirmed", "not_required"} for o in st["observations"].values())
    assert all(o["location"]["status"] == "human_confirmed" for o in st["observations"].values() if o["kind"] != "fault")
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
    assert any(t["kind"] == "human" and "confirmed" in t["title"] for t in st["trace"])


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
        # every human decision is in the review history (observation confirmation + approval)
        assert [h["action"] for h in st["review_history"]] == ["confirm_observation", "approve"]


def test_reject_reassesses_to_a_different_option(runs):
    run, st = runs["S2-corroborated-east"]
    first = st["assessment"]["recommended"]
    run.submit_review({"action": "reject", "option_id": first, "reviewer": "pytest", "note": "test"})
    st2 = wait_for(run, awaiting(2))
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
    st2 = wait_for(run, awaiting(2))
    assert "EX-GYM" in st2["routing"]["blocked_exits"]
    for r in st2["routing"]["routes"]:
        assert r["exit"] != "EX-GYM" and "EX-GYM" not in r["path"]
    assert st2["metrics"]["vision_calls"] == st["metrics"]["vision_calls"]  # re-assessment, no new evidence needed
    run.cancelled = True
    wait_for(run, lambda s: s["status"] == "cancelled", timeout=10)


# ---------------------------------------------------------------- human-in-the-loop observation decisions
def test_dismiss_requires_reason_and_keeps_evidence():
    b = Building.load()
    run = AgentManager(b, CachingVisionClient()).start("S2-corroborated-east", step_delay=0, background=True)
    try:
        st = wait_for(run, awaiting(0))
        with pytest.raises(ValueError, match="reason"):
            run.submit_review({"action": "dismiss_observation", "camera_id": "CAM-03", "reviewer": "pytest"})
        with pytest.raises(ValueError, match="not pending"):
            run.submit_review({"action": "confirm_observation", "camera_id": "CAM-99", "reviewer": "pytest"})
        aid = st["observations"]["CAM-03"]["analysis_id"]
        run.submit_review({"action": "dismiss_observation", "camera_id": "CAM-03", "reviewer": "pytest", "note": "not our building"})
        st2 = wait_for(run, awaiting(1))
        o = st2["observations"]["CAM-03"]
        assert o["review"] == {**o["review"], "status": "dismissed", "reviewer": "pytest", "note": "not our building"}
        assert o["location"]["status"] == "dismissed" and o["location"]["zone"] is None and o["applied"] is False
        assert aid in st2["analyses"] and st2["analyses"][aid]["frame_urls"]  # evidence is not deleted
        assert st2["zones"]["C3"]["status"] == "normal"
        assert st2["belief"]["localized"] is False
        assert any(t["title"] == "pytest dismissed CAM-03 observation" for t in st2["trace"])
        with pytest.raises(ValueError, match="already dismissed"):
            run.submit_review({"action": "confirm_observation", "camera_id": "CAM-03", "reviewer": "pytest"})
        # confirming the other candidate events applies them: alert zones appear only where a human confirmed
        run.submit_review({"action": "confirm_observation", "camera_ids": ["CAM-02", "CAM-07"], "reviewer": "pytest"})
        st3 = wait_for(run, awaiting(2))
        alerted = {z for z, v in st3["zones"].items() if v["status"] == "alert"}
        confirmed_zones = {st3["observations"][c]["camera_zone"] for c in ("CAM-02", "CAM-07")}
        assert alerted and alerted <= confirmed_zones
        assert st3["cameras"]["CAM-02"]["evidence"]["location"]["status"] == "human_confirmed"
    finally:
        run.cancelled = True


def test_verified_footage_is_applied_automatically(monkeypatch):
    """A clip registered as recorded by the camera itself keeps the camera zone as a verified location."""
    from clearpath.agent import orchestrator

    real = orchestrator.footage_manifest

    def manifest():
        m = real()
        m = {"clips": {k: {**v, "scene": {**v.get("scene", {}), "recorded_by_camera": "CAM-03"}} if k == "flight_left_b" else v
                       for k, v in m["clips"].items()}}
        return m

    monkeypatch.setattr(orchestrator, "footage_manifest", manifest)
    run = AgentManager(Building.load(), CachingVisionClient()).start("S2-corroborated-east", step_delay=0, background=True)
    try:
        st = wait_for(run, awaiting(0))
        o = st["observations"]["CAM-03"]
        assert o["location"]["status"] == "verified" and o["location"]["zone"] == "C3"
        assert o["applied"] is True and o["review"]["status"] == "not_required"
        assert "CAM-03" not in st["review"]["pending_observations"]
        assert st["zones"]["C3"]["status"] == "alert"
    finally:
        run.cancelled = True
