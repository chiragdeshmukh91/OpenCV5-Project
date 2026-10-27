"""Frame-level detection, track-level running classification, clip-level false alerts and processing time.

Ground truth comes from the synthetic footage generator (backend/footage/<clip>.gt.json): every pasted
pedestrian sprite's rectangle per frame and its true speed. Only synthetic composites have this ground truth;
nothing here measures performance on real school footage.

Usage (from the repository root, backend venv active):
    python evaluation/run_detection_eval.py            # writes evaluation/results/detection-<machine>-<ts>.json
"""
from __future__ import annotations

import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

os.environ.setdefault("CLEARPATH_SKIP_IMDS", "1")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import cv2 as cv  # noqa: E402

from clearpath.agent.perception import interpret  # noqa: E402
from clearpath.config import FOOTAGE_DIR  # noqa: E402
from clearpath.vision.detector import get_detector  # noqa: E402
from clearpath.vision.pipeline import RUNNING_BH_PER_S, analyze_video  # noqa: E402

IOU_THRESHOLDS = (0.5, 0.75)
MIN_VISIBLE = 0.5  # GT boxes less than half inside the frame are "ignore" regions (neither TP nor FN)
CANDIDATE_ACTIVITIES = {"flight", "agitated"}


def iou(a: list[float], b: list[float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / (aw * ah + bw * bh - inter + 1e-9)


def match(dets: list[list[float]], gts: list[dict], thr: float) -> tuple[int, int, int, list[tuple[int, int]]]:
    """Greedy one-to-one matching by IoU. Returns TP, FP, FN and (det_index, agent_id) pairs."""
    pairs = sorted(((iou(d, g["box"]), i, j) for i, d in enumerate(dets) for j, g in enumerate(gts)), reverse=True)
    used_d, used_g, matched = set(), set(), []
    for v, i, j in pairs:
        if v < thr or i in used_d or j in used_g:
            continue
        used_d.add(i)
        used_g.add(j)
        matched.append((i, gts[j]["agent"]))
    tp = sum(1 for i, a in matched if next(g for g in gts if g["agent"] == a)["visible"] >= MIN_VISIBLE)
    fn = sum(1 for j, g in enumerate(gts) if g["visible"] >= MIN_VISIBLE and j not in used_g)
    fp = sum(1 for i in range(len(dets)) if i not in used_d)  # matches to ignore regions are neither TP nor FP
    return tp, fp, fn, matched


def frame_detection(det, clip: str, gt: dict) -> dict:
    cap = cv.VideoCapture(str(FOOTAGE_DIR / f"{clip}.avi"))
    rows = {thr: {"clean": [0, 0, 0], "smoke": [0, 0, 0], "degraded": [0, 0, 0]} for thr in IOU_THRESHOLDS}
    infer_ms: list[float] = []
    for f in gt["frames"]:
        ok, img = cap.read()
        if not ok:
            break
        dets, ms = det.detect(img)
        infer_ms.append(ms)
        boxes = [list(d.box) for d in dets if d.cls == "person"]
        bucket = "degraded" if f["degraded"] else ("smoke" if f["smoke_alpha"] > 0 else "clean")
        for thr in IOU_THRESHOLDS:
            tp, fp, fn, _ = match(boxes, f["boxes"], thr)
            r = rows[thr][bucket]
            r[0] += tp
            r[1] += fp
            r[2] += fn
    cap.release()
    return {"counts": {str(k): v for k, v in rows.items()}, "infer_ms": infer_ms}


def track_running(result: dict, gt: dict) -> dict:
    """Map each tracked person to a ground-truth agent (majority of IoU>=0.5 matches) and compare running flags."""
    agent_speed = {a["id"]: a["speed_bh_s"] for a in gt["agents"]}
    votes: dict[int, dict[int, int]] = {}
    for rec in result["per_frame"]:
        if not rec["detected"]:
            continue
        persons = [d for d in rec["detections"] if d["cls"] == "person" and d.get("track") is not None]
        _, _, _, matched = match([d["box"] for d in persons], gt["frames"][rec["index"]]["boxes"], 0.5)
        for i, agent in matched:
            v = votes.setdefault(persons[i]["track"], {})
            v[agent] = v.get(agent, 0) + 1
    out = {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "unmatched_tracks": 0, "tracks": 0}
    for t in result["motion"]["tracks_detail"]:
        out["tracks"] += 1
        v = votes.get(t["id"])
        if not v:
            out["unmatched_tracks"] += 1
            continue
        agent = max(v, key=v.get)
        truth = agent_speed[agent] > RUNNING_BH_PER_S
        pred = bool(t["running"])
        out[("tp" if truth else "fp") if pred else ("fn" if truth else "tn")] += 1
    return out


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f1 = 2 * p * r / (p + r) if p and r else None
    return {"tp": tp, "fp": fp, "fn": fn, "precision": None if p is None else round(p, 3),
            "recall": None if r is None else round(r, 3), "f1": None if f1 is None else round(f1, 3)}


def main() -> None:
    manifest = json.loads((FOOTAGE_DIR / "manifest.json").read_text())["clips"]
    missing = [c for c, m in manifest.items() if not (FOOTAGE_DIR / m["file"]).exists() or not (FOOTAGE_DIR / f"{c}.gt.json").exists()]
    if missing:
        sys.exit(f"missing clips or ground truth for {missing}: run `python backend/scripts/generate_footage.py`")
    det = get_detector()
    cam = {"id": "EVAL", "zone": "C1", "image_right_heading_deg": 0}
    clips, totals = [], {str(t): {"clean": [0, 0, 0], "smoke": [0, 0, 0], "degraded": [0, 0, 0]} for t in IOU_THRESHOLDS}
    all_infer: list[float] = []
    track_tot = {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "unmatched_tracks": 0, "tracks": 0}
    alerts = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    pipeline_ms: list[float] = []
    for clip in sorted(manifest):
        gt = json.loads((FOOTAGE_DIR / f"{clip}.gt.json").read_text())
        fd = frame_detection(det, clip, gt)
        all_infer += fd["infer_ms"]
        for thr, buckets in fd["counts"].items():
            for b, v in buckets.items():
                for k in range(3):
                    totals[thr][b][k] += v[k]
        t0 = time.perf_counter()
        res = analyze_video(FOOTAGE_DIR / f"{clip}.avi", include_frames=False)
        pipeline_ms.append(res["timings"]["total_ms"])
        ev = interpret(res, cam)
        if "low_visibility_haze" in ev.issues:  # the agent's own follow-up: dehaze re-run
            res2 = analyze_video(FOOTAGE_DIR / f"{clip}.avi", enhance_mode="dehaze", include_frames=False)
            ev = interpret(res2, cam)
            res = res2
        tr = track_running(res, gt)
        for k in track_tot:
            track_tot[k] += tr[k]
        truth_event = gt["behavior"] == "flight"
        raised = ev.activity in CANDIDATE_ACTIVITIES or bool(ev.weapon_like)
        alerts[("tp" if truth_event else "fp") if raised else ("fn" if truth_event else "tn")] += 1
        clips.append({"clip": clip, "behavior": gt["behavior"], "people": gt["people"], "activity": ev.activity,
                      "candidate_event": raised, "weapon_like": len(ev.weapon_like),
                      "detection_iou50": {b: prf(*v) for b, v in fd["counts"]["0.5"].items() if sum(v)},
                      "running_tracks": tr, "pipeline_ms": res["timings"]["total_ms"],
                      "wall_ms": round((time.perf_counter() - t0) * 1000, 1)})
        c = clips[-1]
        d = c["detection_iou50"].get("clean") or c["detection_iou50"].get("smoke") or {}
        print(f"  {clip:<16} {gt['behavior']:<9} activity {ev.activity:<9} event {'Y' if raised else 'n'}  "
              f"det P {d.get('precision')} R {d.get('recall')}  tracks {tr['tp']}/{tr['fp']}/{tr['fn']}/{tr['tn']}")
    plate_dets, _ = det.detect(cv.imread(str(FOOTAGE_DIR / "plate.png")))
    meta = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "machine": platform.machine(),
            "cpu": _cpu(), "cpus": os.cpu_count(), "opencv": cv.__version__, "detector": det.model_path.name,
            "conf": det.conf, "min_visible": MIN_VISIBLE}
    summary = {
        "detection": {thr: {b: prf(*v) for b, v in buckets.items()} for thr, buckets in totals.items()},
        "plate_residual_person_detections": sum(1 for d in plate_dets if d.cls == "person"),
        "running_track_classification": {**prf(track_tot["tp"], track_tot["fp"], track_tot["fn"]), "tn": track_tot["tn"],
                                         "tracks": track_tot["tracks"], "unmatched_tracks": track_tot["unmatched_tracks"]},
        "clip_candidate_events": {**prf(alerts["tp"], alerts["fp"], alerts["fn"]), "tn": alerts["tn"],
                                  "false_alert_rate": round(alerts["fp"] / max(1, alerts["fp"] + alerts["tn"]), 3)},
        "timing": {"dnn_infer_ms_median": round(statistics.median(all_infer), 1),
                   "dnn_infer_ms_p95": round(sorted(all_infer)[int(0.95 * (len(all_infer) - 1))], 1),
                   "pipeline_ms_per_clip_median": round(statistics.median(pipeline_ms), 1),
                   "frames_per_clip": 40, "detect_every": 4},
    }
    out = ROOT / "evaluation" / "results" / f"detection-{platform.machine()}-{time.strftime('%Y%m%dT%H%M%S')}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"meta": meta, "summary": summary, "clips": clips}, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"wrote {out.relative_to(ROOT)}")


def _cpu() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.lower().startswith(("model name", "cpu model")):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "unknown"


if __name__ == "__main__":
    main()
