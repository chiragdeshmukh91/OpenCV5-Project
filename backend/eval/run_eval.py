"""Reproducible evaluation of CLEARPATH.

1. Perception: every synthetic clip is analysed with OpenCV 5 and the interpreted activity is compared
   with the clip's generation ground truth (known because the clips are synthetic composites).
2. Agent: every scenario is run end-to-end until it pauses for human review; the recommendation,
   localisation, evidence efficiency and failure handling are compared with the scenario's expectation.
3. Baseline: a naive "evacuate on any weapon report" rule is scored on the same scenarios.

Usage: python eval/run_eval.py   (writes eval/results/latest.json and docs/EVALUATION_RESULTS.md)
"""
from __future__ import annotations

import json
import os
import platform
import sys
import time
from pathlib import Path

os.environ.setdefault("CLEARPATH_SKIP_IMDS", "1")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import cv2 as cv  # noqa: E402

from clearpath.agent.orchestrator import AgentManager, footage_manifest, load_scenarios  # noqa: E402
from clearpath.agent.perception import interpret  # noqa: E402
from clearpath.twin.building import Building  # noqa: E402
from clearpath.vision.client import VisionClient  # noqa: E402
from clearpath.vision.pipeline import analyze_video  # noqa: E402

EXPECTED_ACTIVITY = {"normal": "calm", "flight": "flight", "empty": "empty", "congested": "congested"}


def expected_activity(spec: dict) -> str:
    if spec.get("frozen") or spec.get("tamper_after") is not None:
        return "unusable"
    return EXPECTED_ACTIVITY[spec["behavior"]]


def perception_eval() -> list[dict]:
    cam = {"id": "EVAL", "zone": "C1", "image_right_heading_deg": 0}
    rows = []
    from clearpath.config import FOOTAGE_DIR
    for clip, meta in sorted(footage_manifest()["clips"].items()):
        spec = meta["spec"]
        res = analyze_video(FOOTAGE_DIR / meta["file"], include_frames=False)
        ev = interpret(res, cam)
        enhanced = None
        if "low_visibility_haze" in ev.issues:
            ev2 = interpret(analyze_video(FOOTAGE_DIR / meta["file"], enhance_mode="dehaze", include_frames=False), cam)
            enhanced = ev2.activity
        exp = expected_activity(spec)
        dir_ok = None
        if spec["behavior"] == "flight" and ev.flight_heading_deg is not None:
            target = 0 if spec.get("direction") == "right" else 180
            dir_ok = abs((ev.flight_heading_deg - target + 180) % 360 - 180) < 30
        rows.append({"clip": clip, "expected": exp, "observed": ev.activity, "after_dehaze": enhanced,
                     "correct": (enhanced or ev.activity) == exp, "direction_correct": dir_ok,
                     "people_true": meta["ground_truth"]["people"], "people_median": ev.persons, "people_max": ev.persons_max,
                     "speed_bh_s": ev.speed_bh_s, "coherence": ev.coherence, "reliability": ev.reliability,
                     "issues": ev.issues, "ms": res["timings"]["total_ms"]})
        print(f"  {clip:<16} expected {exp:<9} observed {ev.activity:<9} {'OK' if rows[-1]['correct'] else 'MISS'}")
    # Unmodified real footage (OpenCV sample vtest.avi, first 60 frames): pedestrians walking -> calm.
    real = ROOT / "assets" / "vtest.avi"
    if real.exists():
        res = analyze_video(real, include_frames=False)
        ev = interpret(res, cam)
        rows.append({"clip": "REAL vtest.avi (unmodified)", "expected": "calm", "observed": ev.activity, "after_dehaze": None,
                     "correct": ev.activity == "calm", "direction_correct": None, "people_true": "n/a",
                     "people_median": ev.persons, "people_max": ev.persons_max, "speed_bh_s": ev.speed_bh_s,
                     "coherence": ev.coherence, "reliability": ev.reliability, "issues": ev.issues, "ms": res["timings"]["total_ms"]})
        print(f"  REAL vtest.avi   expected calm      observed {ev.activity}")
    return rows


def naive_baseline(scen: dict) -> str:
    claim = scen["trigger"]["claim"].lower()
    return "EVACUATE" if any(w in claim for w in ("firearm", "weapon", "shots")) else "HOLD"


def agent_eval() -> list[dict]:
    rows = []
    for scen in load_scenarios()["scenarios"]:
        m = AgentManager(Building.load(), VisionClient())
        t0 = time.time()
        run = m.start(scen["id"], step_delay=0, background=True)
        while run.state["status"] == "running":
            time.sleep(0.3)
        st = run.snapshot()
        run.cancelled = True
        b = st["belief"]
        exp = scen["expected"]
        region_ok = None
        if exp["threat_region"]:
            region_ok = b["region"][0] in exp["threat_region"]
        rec = st["assessment"]["recommended"] if st["assessment"] else None
        naive = naive_baseline(scen)
        rows.append({
            "scenario": scen["id"], "expected": exp["primary_option"], "recommended": rec,
            "correct": rec == exp["primary_option"], "region": b["region"], "region_correct": region_ok,
            "p_threat": b["p_threat"], "localized": b["localized"], "cameras_analysed": len({a["camera_id"] for a in st["analyses"].values()}),
            "vision_calls": st["metrics"]["vision_calls"], "reanalyses": st["metrics"]["reanalyses"],
            "faults": st["metrics"]["faults"], "gaps": [g["camera_id"] for g in st["gaps"]], "steps": st["step"],
            "wall_s": round(time.time() - t0, 1), "vision_s": round(st["metrics"]["vision_ms"] / 1000, 1),
            "human_review_requested": st["status"] == "awaiting_review",
            "naive_baseline": naive, "naive_correct": naive == exp["primary_option"],
        })
        print(f"  {scen['id']:<32} expected {exp['primary_option']:<24} agent {rec:<24} naive {naive}")
    return rows


def write_markdown(perc: list[dict], agent: list[dict], meta: dict, out: Path) -> None:
    pc = sum(r["correct"] for r in perc)
    ac = sum(r["correct"] for r in agent)
    nc = sum(r["naive_correct"] for r in agent)
    L = ["# CLEARPATH evaluation results", "",
         f"Generated {meta['generated']} on `{meta['machine']}` with OpenCV {meta['opencv']} (vision mode: {meta['vision_mode']}).",
         "All footage is synthetic (recomposited OpenCV sample video) and all triggers are simulated. "
         "Numbers below are produced by `backend/eval/run_eval.py` and are reproducible.", "",
         "## Perception (OpenCV 5) vs generation ground truth", "",
         f"Activity classification: **{pc}/{len(perc)}** clips correct.", "",
         "| Clip | Expected | Observed | After dehaze | People (true / median / max) | Speed BH/s | Coherence | Reliability | Issues | ms |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    for r in perc:
        L.append(f"| {r['clip']} | {r['expected']} | {r['observed']} | {r['after_dehaze'] or '—'} | {r['people_true']} / {r['people_median']:.0f} / {r['people_max']} | "
                 f"{r['speed_bh_s'] if r['speed_bh_s'] is not None else '—'} | {r['coherence']:.2f} | {r['reliability']:.2f} | {', '.join(r['issues']) or '—'} | {r['ms']:.0f} |")
    L += ["", "## Agent (end-to-end, until human review)", "",
          f"Recommendation matches expectation: **{ac}/{len(agent)}** scenarios. Naive baseline (\"evacuate on any weapon report\"): **{nc}/{len(agent)}**.", "",
          "| Scenario | Expected | Agent | Naive baseline | P(threat) | Region (correct?) | Cameras used / 7 | Re-analyses | Faults → gaps | Steps | Wall s |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in agent:
        reg = f"{', '.join(r['region'])} ({'yes' if r['region_correct'] else 'no'})" if r["region_correct"] is not None else "n/a (not localised)"
        L.append(f"| {r['scenario']} | {r['expected']} | {r['recommended']} | {r['naive_baseline']} | {r['p_threat']:.2f} | {reg} | {r['cameras_analysed']} | {r['reanalyses']} | "
                 f"{r['faults']} → {', '.join(r['gaps']) or '—'} | {r['steps']} | {r['wall_s']} |")
    L += ["", "Every run paused for human review before any (simulated) action: "
          + ("yes" if all(r["human_review_requested"] for r in agent) else "NO") + ".", "",
          "## Limitations", "",
          "- Footage is synthetic; sprites are real pedestrians but motion is composited, so this measures the pipeline and the agent logic, not field accuracy.",
          "- The detector is COCO YOLOX; it has no firearm class. CLEARPATH never claims a firearm detection; weapon-like COCO classes only trigger a persistence check and a human-verification task.",
          "- Activity thresholds (running ≥ 2 body-heights/s, coherence ≥ 0.6) were set on these clips and need validation on real footage.",
          "- Likelihood ratios in the belief update are hand-set, documented constants, not learned from data."]
    out.write_text("\n".join(L) + "\n")


def main() -> None:
    print("Perception evaluation")
    perc = perception_eval()
    print("Agent evaluation")
    agent = agent_eval()
    meta = {"generated": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "machine": platform.machine(), "opencv": cv.__version__,
            "vision_mode": os.getenv("VISION_MODE", "local")}
    outdir = ROOT / "eval" / "results"
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / f"eval-{platform.machine()}-{time.strftime('%Y%m%dT%H%M%S')}.json").write_text(
        json.dumps({"meta": meta, "perception": perc, "agent": agent}, indent=2))
    write_markdown(perc, agent, meta, ROOT.parent / "docs" / "EVALUATION_RESULTS.md")
    print("Wrote docs/EVALUATION_RESULTS.md")


if __name__ == "__main__":
    main()
