#!/usr/bin/env python3
"""Reproducible OpenCV benchmark for CLEARPATH (stock OpenCV vs. COOL on AWS Graviton).

Records the full runtime identity (which cv2 was loaded, a hash of its build information, CPU, EC2 instance type
via IMDSv2, thread count) and then times, on frames decoded from the project's footage clips:

  (a) micro ops   - resize (down/up, INTER_LINEAR/INTER_AREA), adaptiveThreshold (Gaussian 11/2), findContours on
                    Canny edges, GaussianBlur 15x15, cvtColor BGR2LAB, CLAHE, Farneback flow (384x288), MOG2 apply
  (b) end-to-end  - clearpath.vision.pipeline.analyze_video on 3 clips (include_frames=False), stage timings + fps
  (c) DNN only    - YOLOX-S forward pass (cv.dnn), letterboxed 640x640 input

Nothing here is estimated or extrapolated: every number in the output file was measured by this process on this
machine with the OpenCV build named in the "identity" block.

    python benchmarks/bench_opencv.py --label stock-graviton --repeats 30
    python benchmarks/compare.py results/stock-graviton-*.json results/cool-graviton-*.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

import cv2 as cv  # noqa: E402
import numpy as np  # noqa: E402

SCHEMA = "clearpath-opencv-bench/1"
ARM_PARTS = {  # /proc/cpuinfo "CPU part" for ARM Ltd (implementer 0x41) cores used by Graviton generations
    "0xd0c": "Neoverse-N1 (Graviton2)", "0xd40": "Neoverse-V1 (Graviton3/3E)", "0xd4f": "Neoverse-V2 (Graviton4)",
    "0xd8e": "Neoverse-N3", "0xd84": "Neoverse-V3",
}


# ----------------------------------------------------------------------------------------------- identity
def cpu_model() -> dict[str, Any]:
    out: dict[str, Any] = {"model_name": None, "arm_implementer": None, "arm_part": None, "arm_core": None, "flags": None}
    try:
        txt = Path("/proc/cpuinfo").read_text()
    except OSError:
        return out
    for line in txt.splitlines():
        if ":" not in line:
            continue
        k, v = (s.strip() for s in line.split(":", 1))
        if k == "model name" and not out["model_name"]:
            out["model_name"] = v
        elif k == "CPU implementer" and not out["arm_implementer"]:
            out["arm_implementer"] = v
        elif k == "CPU part" and not out["arm_part"]:
            out["arm_part"] = v
            out["arm_core"] = ARM_PARTS.get(v.lower())
        elif k in ("flags", "Features") and not out["flags"]:
            feats = set(v.split())
            out["flags"] = sorted(f for f in feats if f in {
                "avx", "avx2", "avx512f", "avx512bw", "avx512vnni", "fma", "sse4_2",  # x86
                "asimd", "asimddp", "sve", "sve2", "bf16", "i8mm", "fphp", "asimdhp"})  # aarch64
    return out


def ec2_identity() -> dict | None:
    """IMDSv2 (token) lookup; returns None off EC2. Honors CLEARPATH_SKIP_IMDS=1."""
    from clearpath.vision.runtime_info import ec2_identity as _ec2
    return _ec2()


def identity() -> dict[str, Any]:
    from clearpath.vision.runtime_info import cool_status, opencv_build
    info = cv.getBuildInformation()
    try:
        import importlib.metadata as md
        dists = {d: md.version(d) for d in ("opencv-python", "opencv-python-headless", "opencv-contrib-python",
                                            "opencv-contrib-python-headless") if _has_dist(md, d)}
    except Exception:
        dists = {}
    return {
        "opencv_version": cv.__version__,
        "cv2_file": getattr(cv, "__file__", None),
        "build_info_sha256": hashlib.sha256(info.encode()).hexdigest(),
        "build": opencv_build(),
        "opencv_pip_distributions_installed": dists,
        "cool": cool_status(),
        "use_optimized": cv.useOptimized(),
        "num_threads": cv.getNumThreads(),
        "machine": platform.machine(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "cpu_count": os.cpu_count(),
        "cpu": cpu_model(),
        "ec2": ec2_identity(),
        "loadavg_at_start": list(os.getloadavg()) if hasattr(os, "getloadavg") else None,
    }


def _has_dist(md, name: str) -> bool:
    try:
        md.version(name)
        return True
    except md.PackageNotFoundError:
        return False


# ----------------------------------------------------------------------------------------------- timing
def _stats(samples_ms: list[float]) -> dict[str, float]:
    s = sorted(samples_ms)
    p90 = s[min(len(s) - 1, int(round(0.9 * (len(s) - 1))))]
    return {"median_ms": round(statistics.median(s), 4), "p90_ms": round(p90, 4), "min_ms": round(s[0], 4),
            "mean_ms": round(statistics.fmean(s), 4), "n": len(s)}


def time_op(fn: Callable[[int], Any], warmup: int, repeats: int, min_sample_ms: float = 2.0) -> dict[str, Any]:
    """fn(i) runs one call on input i. Each sample batches `inner` calls so it lasts >= min_sample_ms
    (timer noise), and is reported per call."""
    for i in range(max(1, warmup)):
        fn(i)
    t0 = time.perf_counter()
    fn(0)
    one = (time.perf_counter() - t0) * 1000
    inner = max(1, int(min_sample_ms / max(one, 1e-4)))
    samples = []
    k = 0
    for _ in range(repeats):
        t0 = time.perf_counter()
        for _ in range(inner):
            fn(k)
            k += 1
        samples.append((time.perf_counter() - t0) * 1000 / inner)
    return {**_stats(samples), "inner_calls_per_sample": inner}


# ----------------------------------------------------------------------------------------------- inputs
def load_frames(clip: Path, n: int) -> list[np.ndarray]:
    cap = cv.VideoCapture(str(clip))
    frames = []
    while len(frames) < n:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    if not frames:
        raise SystemExit(f"cannot decode {clip}")
    return frames


def micro_ops(frames: list[np.ndarray], warmup: int, repeats: int) -> dict[str, Any]:
    n = len(frames)
    H, W = frames[0].shape[:2]
    gray = [cv.cvtColor(f, cv.COLOR_BGR2GRAY) for f in frames]
    small = [cv.resize(f, (W // 2, H // 2), interpolation=cv.INTER_AREA) for f in frames]
    small_gray = [cv.cvtColor(s, cv.COLOR_BGR2GRAY) for s in small]
    edges = [cv.Canny(g, 50, 150) for g in gray]
    clahe = cv.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    lab_l = [cv.split(cv.cvtColor(f, cv.COLOR_BGR2LAB))[0] for f in frames]
    mog = cv.createBackgroundSubtractorMOG2(history=200, varThreshold=24, detectShadows=False)
    for s in small * 3:  # learn a background first so apply() is measured in steady state
        mog.apply(s)
    up = (W * 5 // 2, H * 5 // 2)  # 768x576 -> 1920x1440
    down = (W // 2, H // 2)  # 768x576 -> 384x288

    ops: dict[str, tuple[str, Callable[[int], Any]]] = {
        "resize_down_linear": (f"{W}x{H}->{down[0]}x{down[1]} INTER_LINEAR",
                               lambda i: cv.resize(frames[i % n], down, interpolation=cv.INTER_LINEAR)),
        "resize_down_area": (f"{W}x{H}->{down[0]}x{down[1]} INTER_AREA",
                             lambda i: cv.resize(frames[i % n], down, interpolation=cv.INTER_AREA)),
        "resize_up_linear": (f"{W}x{H}->{up[0]}x{up[1]} INTER_LINEAR",
                             lambda i: cv.resize(frames[i % n], up, interpolation=cv.INTER_LINEAR)),
        "resize_up_area": (f"{W}x{H}->{up[0]}x{up[1]} INTER_AREA",
                           lambda i: cv.resize(frames[i % n], up, interpolation=cv.INTER_AREA)),
        "adaptive_threshold_gaussian": (f"gray {W}x{H}, ADAPTIVE_THRESH_GAUSSIAN_C, block 11, C 2",
                                        lambda i: cv.adaptiveThreshold(gray[i % n], 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                                                                       cv.THRESH_BINARY, 11, 2)),
        "canny": (f"gray {W}x{H}, 50/150", lambda i: cv.Canny(gray[i % n], 50, 150)),
        "find_contours_on_canny": (f"Canny edges {W}x{H}, RETR_LIST, CHAIN_APPROX_SIMPLE",
                                   lambda i: cv.findContours(edges[i % n], cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)),
        "gaussian_blur_15": (f"BGR {W}x{H}, 15x15", lambda i: cv.GaussianBlur(frames[i % n], (15, 15), 0)),
        "cvtcolor_bgr2lab": (f"BGR {W}x{H} uint8", lambda i: cv.cvtColor(frames[i % n], cv.COLOR_BGR2LAB)),
        "clahe": (f"L channel {W}x{H}, clip 3.0, 8x8 tiles", lambda i: clahe.apply(lab_l[i % n])),
        "farneback_flow": (f"gray {down[0]}x{down[1]}, pyr 0.5/3, win 15, iters 3, poly 5/1.2 (pipeline params)",
                           lambda i: cv.calcOpticalFlowFarneback(small_gray[i % n], small_gray[(i + 1) % n], None,
                                                                 0.5, 3, 15, 3, 5, 1.2, 0)),
        "mog2_apply": (f"BGR {down[0]}x{down[1]}, history 200, varThreshold 24", lambda i: mog.apply(small[i % n])),
    }
    out = {}
    for name, (desc, fn) in ops.items():
        out[name] = {"desc": desc, **time_op(fn, warmup, repeats)}
        print(f"  {name:30s} median {out[name]['median_ms']:9.3f} ms  p90 {out[name]['p90_ms']:9.3f} ms", flush=True)
    return out


def dnn_forward(frame: np.ndarray, warmup: int, repeats: int) -> dict[str, Any]:
    from clearpath.vision.detector import get_detector
    det = get_detector()
    pad, _ = det._letterbox(frame)
    blob = pad.transpose(2, 0, 1)[None].copy()

    def fwd(_i: int):
        det.net.setInput(blob)
        return det.net.forward(det._out_names)

    r = time_op(fwd, warmup, repeats, min_sample_ms=0.0)
    r.update({"desc": f"YOLOX-S {det.size}x{det.size} forward (cv.dnn, default backend/target)", "model": det.model_path.name,
              "model_sha256": hashlib.sha256(det.model_path.read_bytes()).hexdigest()})
    print(f"  {'yolox_forward':30s} median {r['median_ms']:9.3f} ms  p90 {r['p90_ms']:9.3f} ms", flush=True)
    return r


def end_to_end(clips: list[Path], repeats: int) -> dict[str, Any]:
    from clearpath.vision.pipeline import analyze_video
    analyze_video(clips[0], max_frames=8, include_frames=False)  # load model, warm caches
    out = {}
    for clip in clips:
        runs = []
        for _ in range(repeats):
            t0 = time.perf_counter()
            r = analyze_video(clip, include_frames=False)
            wall = (time.perf_counter() - t0) * 1000
            runs.append({"wall_ms": round(wall, 1), "frames": r["frames_analyzed"], "timings": r["timings"],
                         "inferences": r["detector"]["inferences"]})
        walls = [x["wall_ms"] for x in runs]
        med_run = sorted(runs, key=lambda x: x["wall_ms"])[len(runs) // 2]
        frames = med_run["frames"]
        out[clip.stem] = {**_stats(walls), "frames": frames, "fps": round(frames / (statistics.median(walls) / 1000), 2),
                          "dnn_inferences": med_run["inferences"], "stage_timings_ms_median_run": med_run["timings"],
                          "runs": runs}
        print(f"  analyze_video[{clip.stem:14s}] median {out[clip.stem]['median_ms']:9.1f} ms  "
              f"{out[clip.stem]['fps']:6.2f} frames/s", flush=True)
    return out


# ----------------------------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--label", required=True, help="e.g. stock-x86, stock-graviton, cool-graviton")
    ap.add_argument("--repeats", type=int, default=30, help="timed samples per micro op")
    ap.add_argument("--warmup", type=int, default=3)
    ap.add_argument("--dnn-repeats", type=int, default=None, help="default: min(repeats, 15)")
    ap.add_argument("--e2e-repeats", type=int, default=3, help="analyze_video runs per clip")
    ap.add_argument("--clips", default="normal_a,flight_left_a,smoke_normal")
    ap.add_argument("--frames", type=int, default=16, help="frames decoded for micro-op inputs")
    ap.add_argument("--threads", type=int, default=None, help="cv.setNumThreads before benchmarking")
    ap.add_argument("--skip", default="", help="comma list of: micro,dnn,e2e")
    ap.add_argument("--out", type=Path, default=HERE / "results")
    args = ap.parse_args()

    from clearpath.config import FOOTAGE_DIR
    if args.threads is not None:
        cv.setNumThreads(args.threads)
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    clips = [FOOTAGE_DIR / f"{c}.avi" for c in args.clips.split(",")]
    missing = [str(c) for c in clips if not c.exists()]
    if missing:
        raise SystemExit(f"missing footage {missing}; run scripts/generate_footage.py first")

    t_start = time.time()
    ident = identity()
    print(f"OpenCV {ident['opencv_version']} from {ident['cv2_file']}")
    print(f"build sha256 {ident['build_info_sha256'][:16]}..  machine {ident['machine']}  "
          f"cpu {ident['cpu']['model_name'] or ident['cpu']['arm_core'] or ident['cpu']['arm_part']}  "
          f"instance {(ident['ec2'] or {}).get('instance_type')}  threads {ident['num_threads']}  COOL {ident['cool']['state']}")
    frames = load_frames(clips[0], args.frames)
    result: dict[str, Any] = {
        "schema": SCHEMA, "label": args.label, "timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "identity": ident,
        "protocol": {"repeats": args.repeats, "warmup": args.warmup, "dnn_repeats": args.dnn_repeats or min(args.repeats, 15),
                     "e2e_repeats": args.e2e_repeats, "clips": [c.stem for c in clips], "input_clip": clips[0].stem,
                     "input_frames": len(frames), "input_size": [frames[0].shape[1], frames[0].shape[0]],
                     "threads_override": args.threads},
        "micro": {}, "dnn": {}, "e2e": {},
    }
    if "micro" not in skip:
        print("micro ops (per call):")
        result["micro"] = micro_ops(frames, args.warmup, args.repeats)
    if "dnn" not in skip:
        print("DNN:")
        result["dnn"] = {"yolox_forward": dnn_forward(frames[len(frames) // 2], args.warmup, result["protocol"]["dnn_repeats"])}
    if "e2e" not in skip:
        print("end-to-end:")
        result["e2e"] = end_to_end(clips, args.e2e_repeats)
    result["duration_s"] = round(time.time() - t_start, 1)
    result["loadavg_at_end"] = list(os.getloadavg()) if hasattr(os, "getloadavg") else None

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = args.out / f"{args.label}-{ident['machine']}-{stamp}.json"
    path.write_text(json.dumps(result, indent=2))
    print(f"wrote {path} ({result['duration_s']} s)")


if __name__ == "__main__":
    main()
