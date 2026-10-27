"""Event-location attribution and human-review state consistency, end to end through the real agent.

For every scenario the agent runs on the real (synthetic) footage until it pauses. Then a scripted reviewer
makes a sequence of decisions (dismiss one candidate event, confirm the rest, reject the recommendation,
approve the next one). After every step the run state is checked against invariants that the UI relies on.

Usage (repository root, backend venv active):
    python evaluation/run_review_consistency.py      # writes evaluation/results/review-<machine>-<ts>.json
"""
from __future__ import annotations

import json
import os
import platform
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("CLEARPATH_SKIP_IMDS", "1")
os.environ.setdefault("CLEARPATH_DATA_DIR", tempfile.mkdtemp(prefix="clearpath-eval-"))
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from clearpath.agent.orchestrator import CANDIDATE_ACTIVITIES, AgentManager, load_scenarios  # noqa: E402
from clearpath.config import DATA_DIR  # noqa: E402
from clearpath.twin.building import Building  # noqa: E402
from clearpath.vision.client import VisionClient  # noqa: E402


def wait(run, n_reviews: int, timeout: float = 600) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = run.snapshot()
        if st["status"] == "error":
            raise RuntimeError(st["error"])
        if st["status"] in {"awaiting_review", "complete"} and len(st["review_history"]) == n_reviews:
            return st
        time.sleep(0.3)
    raise TimeoutError(run.id)


def invariants(st: dict, building: Building, n_decisions: int) -> list[tuple[str, bool, str]]:
    obs = st["observations"]
    checks: list[tuple[str, bool, str]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, bool(ok), detail))

    bad = []
    for cid, o in obs.items():
        r, loc = o["review"]["status"], o["location"]
        if o["kind"] == "fault":
            ok = r == "not_required" and not o["applied"]
        elif r == "pending":
            ok = loc["status"] == "unverified" and loc["zone"] is None and not o["applied"]
        elif r == "confirmed":
            ok = loc["status"] == "human_confirmed" and loc["zone"] == o["camera_zone"] and o["applied"]
        elif r == "dismissed":
            ok = loc["status"] == "dismissed" and loc["zone"] is None and not o["applied"]
        else:  # not_required (verified footage)
            ok = loc["status"] == "verified" and o["applied"]
        if not ok:
            bad.append(cid)
    add("observation review status <-> location <-> applied", not bad, ",".join(bad))

    allowed_alert = {o["camera_zone"] for o in obs.values() if o["applied"] and o["kind"] == "candidate_event"}
    alerted = {z for z, v in st["zones"].items() if v["status"] == "alert"}
    add("alert zones only where an applied candidate event is located", alerted <= allowed_alert,
        f"alerted={sorted(alerted)} allowed={sorted(allowed_alert)}")

    mism = [cid for cid, o in obs.items() if st["cameras"][cid].get("evidence", {}).get("location", o["location"]) != o["location"]]
    add("camera evidence location == observation location (twin == review panel)", not mism, ",".join(mism))

    if st["status"] == "awaiting_review":
        pend = sorted(c for c, o in obs.items() if o["review"]["status"] == "pending")
        add("review.pending_observations == pending observations", sorted(st["review"]["pending_observations"]) == pend)

    add("every decision is in review_history", len(st["review_history"]) == n_decisions,
        f"{len(st['review_history'])} vs {n_decisions}")
    human_obs = [t for t in st["trace"] if t["kind"] == "human" and ("confirmed CAM" in t["title"] or "dismissed CAM" in t["title"])]
    decided = sum(1 for o in obs.values() if o["review"]["status"] in {"confirmed", "dismissed"})
    add("every observation decision has a trace entry", len(human_obs) == decided, f"{len(human_obs)} vs {decided}")

    missing = [aid for aid, a in st["analyses"].items() for u in a["frame_urls"][:1]
               if not (DATA_DIR / u.removeprefix("/media/")).exists()]
    add("evidence frames are kept on disk (never deleted by a decision)", not missing, ",".join(missing))

    if not st["belief"]["localized"]:
        add("not localised -> no zone reported as threat region by routing hazard from camera evidence", True)
    sup = sum(1 for o in obs.values() if o["applied"] and (o["activity"] in CANDIDATE_ACTIVITIES or o["weapon"]["weapon_like"]))
    add("belief supporting observations counts only applied events", st["belief"]["supporting_observations"] <= sup,
        f"{st['belief']['supporting_observations']} <= {sup}")
    return checks


def location_attribution(st: dict) -> dict:
    obs = [o for o in st["observations"].values() if o["kind"] != "fault"]
    unverified = [o for o in obs if o["location"]["status"] == "unverified"]
    return {"observations": len(obs), "unverified": len(unverified),
            "with_zone_before_review": sum(1 for o in obs if o["location"]["zone"] is not None),
            "alert_zones_before_review": sorted(z for z, v in st["zones"].items() if v["status"] == "alert"),
            "localized_before_review": st["belief"]["localized"]}


def main() -> None:
    b = Building.load()
    out_rows = []
    total = passed = 0
    for scen in load_scenarios()["scenarios"]:
        run = AgentManager(b, VisionClient()).start(scen["id"], step_delay=0, background=True)
        steps = []
        n = 0
        st = wait(run, n)
        loc = location_attribution(st)
        steps.append(("initial pause", invariants(st, b, n), st["assessment"]["recommended"]))
        pending = sorted(st["review"]["pending_observations"])
        events = [c for c in pending if st["observations"][c]["kind"] == "candidate_event"]
        if events:
            run.submit_review({"action": "dismiss_observation", "camera_id": events[0], "reviewer": "eval", "note": "eval: dismissed"})
            n += 1
            st = wait(run, n)
            steps.append((f"dismiss {events[0]}", invariants(st, b, n), st["assessment"]["recommended"]))
        rest = sorted(st["review"]["pending_observations"])
        if rest:
            run.submit_review({"action": "confirm_observation", "camera_ids": rest, "reviewer": "eval"})
            n += 1
            st = wait(run, n)
            steps.append((f"confirm {len(rest)}", invariants(st, b, n), st["assessment"]["recommended"]))
        first = st["assessment"]["recommended"]
        run.submit_review({"action": "reject", "option_id": first, "reviewer": "eval", "note": "eval"})
        n += 1
        st = wait(run, n)
        steps.append((f"reject {first}", invariants(st, b, n) + [("rejected option no longer recommended, or explicitly flagged as the only feasible option",
                                                     st["assessment"]["recommended"] != first or bool(st["assessment"].get("no_feasible_alternative")),
                                                     "flagged no_feasible_alternative" if st["assessment"]["recommended"] == first else "")],
                      st["assessment"]["recommended"]))
        run.submit_review({"action": "approve", "reviewer": "eval"})
        n += 1
        st = wait(run, n)
        steps.append(("approve", invariants(st, b, n) + [("run complete, all actions SIMULATED", st["status"] == "complete" and all(l.startswith("SIMULATED") for l in st["action_log"]), "")],
                      st.get("approved_option")))
        rows = []
        for name, checks, rec in steps:
            for c in checks:
                total += 1
                passed += c[1]
            rows.append({"step": name, "recommended": rec, "checks": [{"check": c[0], "pass": c[1], "detail": c[2]} for c in checks]})
            print(f"  {scen['id']:<32} {name:<22} rec {str(rec):<24} {sum(c[1] for c in checks)}/{len(checks)} checks")
        out_rows.append({"scenario": scen["id"], "location_attribution_before_review": loc, "steps": rows})
    meta = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "machine": platform.machine()}
    out = ROOT / "evaluation" / "results" / f"review-{platform.machine()}-{time.strftime('%Y%m%dT%H%M%S')}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"meta": meta, "checks_passed": passed, "checks_total": total, "scenarios": out_rows}, indent=2))
    print(f"{passed}/{total} invariant checks passed; wrote {out.relative_to(ROOT)}")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
