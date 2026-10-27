"""OpenCV 5 video analysis pipeline used as the agent's perception tool.

Stages (all OpenCV): decode -> image-quality assessment (brightness/contrast/Laplacian sharpness,
dark-channel haze, frozen-feed and lens-tamper checks) -> optional enhancement (CLAHE or dark-channel
dehaze) -> background subtraction (MOG2) -> dense optical flow (Farneback) -> DNN object detection
(YOLOX via cv.dnn) -> lightweight multi-object tracking -> motion statistics normalised by body height.
"""
from __future__ import annotations

import base64
import math
import time
from pathlib import Path
from typing import Any

import cv2 as cv
import numpy as np

from .detector import WEAPON_LIKE_COCO, get_detector, get_weapon_detector

RUNNING_BH_PER_S = 2.0  # body-heights per second; ordinary walking is roughly 0.6-1.2


# --------------------------------------------------------------------------- quality / enhancement
def dark_channel(img: np.ndarray, k: int = 15) -> np.ndarray:
    m = np.min(img, axis=2)
    return cv.erode(m, cv.getStructuringElement(cv.MORPH_RECT, (k, k)))


def frame_quality(img: np.ndarray) -> dict[str, float]:
    gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY)
    small = cv.resize(img, (img.shape[1] // 4, img.shape[0] // 4), interpolation=cv.INTER_AREA)
    return {
        "brightness": float(gray.mean()),
        "contrast": float(gray.std()),
        "sharpness": float(cv.Laplacian(gray, cv.CV_64F).var()),
        "haze": float(dark_channel(small, 5).mean() / 255.0),
    }


def enhance(img: np.ndarray, mode: str) -> np.ndarray:
    if mode == "none":
        return img
    if mode == "dehaze":
        f = img.astype(np.float32) / 255.0
        dc = dark_channel(img, 15).astype(np.float32) / 255.0
        n = max(1, int(dc.size * 0.001))
        idx = np.argpartition(dc.ravel(), -n)[-n:]
        A = np.maximum(f.reshape(-1, 3)[idx].mean(0), 0.5)
        t = 1.0 - 0.9 * dark_channel((f / A * 255).clip(0, 255).astype(np.uint8), 15).astype(np.float32) / 255.0
        t = cv.GaussianBlur(np.maximum(t, 0.25), (0, 0), 7)[..., None]
        img = (((f - A) / t + A).clip(0, 1) * 255).astype(np.uint8)
    lab = cv.cvtColor(img, cv.COLOR_BGR2LAB)
    l, a, b = cv.split(lab)
    l = cv.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(l)
    return cv.cvtColor(cv.merge((l, a, b)), cv.COLOR_LAB2BGR)


# --------------------------------------------------------------------------- tracking
def _associate(tracks: list[dict], dets: list[dict], t: float, gate_bh: float = 2.5) -> None:
    unmatched = list(range(len(dets)))
    for tr in sorted(tracks, key=lambda x: -len(x["pts"])):
        if not tr["alive"]:
            continue
        lx, ly, lh, lt = tr["pts"][-1]
        best, bd = None, 1e9
        for j in unmatched:
            x, y, w, h = dets[j]["box"]
            cx, cy = x + w / 2, y + h
            d = math.hypot(cx - lx, cy - ly)
            if d < gate_bh * max(h, lh) * max(1.0, (t - lt) * 2.5) and d < bd:
                best, bd = j, d
        if best is None:
            tr["miss"] += 1
            tr["alive"] = tr["miss"] < 2
            continue
        x, y, w, h = dets[best]["box"]
        tr["pts"].append((x + w / 2, y + h, h, t))
        tr["miss"] = 0
        dets[best]["track"] = tr["id"]
        unmatched.remove(best)
    for j in unmatched:
        x, y, w, h = dets[j]["box"]
        tid = len(tracks) + 1
        tracks.append({"id": tid, "pts": [(x + w / 2, y + h, h, t)], "alive": True, "miss": 0})
        dets[j]["track"] = tid


def _track_velocity(tr: dict) -> tuple[float, float, float] | None:
    if len(tr["pts"]) < 2:
        return None
    (x0, y0, h0, t0), (x1, y1, h1, t1) = tr["pts"][0], tr["pts"][-1]
    if t1 <= t0:
        return None
    hm = float(np.median([p[2] for p in tr["pts"]]))
    return (x1 - x0) / (t1 - t0), (y1 - y0) / (t1 - t0), hm


# --------------------------------------------------------------------------- main analysis
def analyze_video(path: Path | str, *, enhance_mode: str = "none", detect_every: int = 4, conf: float | None = None,
                  max_frames: int = 60, frame_width: int = 960, include_frames: bool = True,
                  jpeg_quality: int = 88) -> dict[str, Any]:
    t_start = time.perf_counter()
    timings = {"decode_ms": 0.0, "quality_ms": 0.0, "enhance_ms": 0.0, "bgsub_ms": 0.0, "flow_ms": 0.0,
               "detect_ms": 0.0, "encode_ms": 0.0}
    cap = cv.VideoCapture(str(path))
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video {path}")
    fps = cap.get(cv.CAP_PROP_FPS) or 10.0
    detector = get_detector()
    weapon_det = get_weapon_detector()
    mog = cv.createBackgroundSubtractorMOG2(history=200, varThreshold=24, detectShadows=False)

    frames_out: list[str] = []
    per_frame: list[dict] = []
    qualities: list[dict] = []
    diffs: list[float] = []
    fg_ratios: list[float] = []
    flow_vecs: list[tuple[float, float, float]] = []  # vx, vy (px/frame at full res), fg-weighted magnitude
    tracks: list[dict] = []
    weapon_like: list[dict] = []
    person_counts: list[int] = []
    person_scores: list[float] = []
    person_heights: list[float] = []
    prev_gray_small = None
    prev_frame = None
    n_infer = 0
    i = 0
    W = H = 0
    while i < max_frames:
        t0 = time.perf_counter()
        ok, raw = cap.read()
        timings["decode_ms"] += (time.perf_counter() - t0) * 1000
        if not ok:
            break
        H, W = raw.shape[:2]
        t0 = time.perf_counter()
        q = frame_quality(raw)
        qualities.append(q)
        if prev_frame is not None:
            diffs.append(float(cv.absdiff(raw, prev_frame).mean()))
        prev_frame = raw
        timings["quality_ms"] += (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        img = enhance(raw, enhance_mode)
        timings["enhance_ms"] += (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        small = cv.resize(img, (W // 2, H // 2), interpolation=cv.INTER_AREA)
        fg = mog.apply(small)
        fg = cv.morphologyEx(fg, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_ELLIPSE, (3, 3)))
        fg_ratio = float((fg > 0).mean())
        if i >= 3:
            fg_ratios.append(fg_ratio)
        timings["bgsub_ms"] += (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        gray_small = cv.cvtColor(small, cv.COLOR_BGR2GRAY)
        if prev_gray_small is not None:
            flow = cv.calcOpticalFlowFarneback(prev_gray_small, gray_small, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            mask = fg > 0
            if mask.sum() > 50:
                vx = float(flow[..., 0][mask].mean()) * 2
                vy = float(flow[..., 1][mask].mean()) * 2
                mag = float(np.linalg.norm(flow[mask], axis=1).mean()) * 2
                flow_vecs.append((vx, vy, mag))
        prev_gray_small = gray_small
        timings["flow_ms"] += (time.perf_counter() - t0) * 1000

        frame_dets: list[dict] = []
        frame_dets_extra: list[dict] = []
        if i % detect_every == 0:
            t0 = time.perf_counter()
            dets, _ = detector.detect(img, conf)
            n_infer += 1
            if weapon_det is not None:
                wd, _ = weapon_det.detect(img)
                for d in wd:
                    item = {**d.to_dict(), "frame": i, "kind": "weapon_model"}
                    weapon_like.append(item)
                    frame_dets_extra.append(item)
            timings["detect_ms"] += (time.perf_counter() - t0) * 1000
            persons = [d for d in dets if d.cls == "person"]
            person_counts.append(len(persons))
            person_scores += [d.score for d in persons]
            person_heights += [d.box[3] for d in persons]
            frame_dets = [d.to_dict() for d in persons]
            _associate(tracks, frame_dets, i / fps)
            for d in dets:
                if d.cls in WEAPON_LIKE_COCO:
                    item = {**d.to_dict(), "frame": i, "kind": "coco_weapon_like"}
                    weapon_like.append(item)
                    frame_dets.append(item)
            frame_dets += frame_dets_extra
        per_frame.append({"index": i, "detections": frame_dets, "detected": i % detect_every == 0,
                          "fg_ratio": round(fg_ratio, 4)})
        if include_frames:
            t0 = time.perf_counter()
            # Evidence frames at native resolution (never upscaled, capped at frame_width) so people and
            # objects stay legible when inspected full-size.
            out_w = min(W, frame_width)
            small_img = img if out_w == W else cv.resize(img, (out_w, int(round(H * out_w / W))), interpolation=cv.INTER_AREA)
            jpg = cv.imencode(".jpg", small_img, [cv.IMWRITE_JPEG_QUALITY, jpeg_quality])[1]
            frames_out.append(base64.b64encode(jpg.tobytes()).decode())
            timings["encode_ms"] += (time.perf_counter() - t0) * 1000
        i += 1
    cap.release()
    if i == 0:
        raise ValueError(f"No frames decoded from {path}")

    # ---------------- quality summary
    med = {k: float(np.median([q[k] for q in qualities])) for k in qualities[0]}
    frozen_ratio = float(np.mean([d < 0.35 for d in diffs])) if diffs else 0.0
    covered = [q["contrast"] < 14 and q["sharpness"] < 20 for q in qualities]
    tamper_ratio = float(np.mean(covered))
    hazy = med["haze"] > 0.5 and med["contrast"] < 38
    issues = []
    if frozen_ratio > 0.6:
        issues.append("frozen_feed")
    if tamper_ratio > 0.3:
        issues.append("lens_obstructed_or_defocused")
    if hazy:
        issues.append("low_visibility_haze")
    if med["brightness"] < 35:
        issues.append("too_dark")
    reliability = 1.0
    reliability *= (1 - 0.95 * frozen_ratio) if frozen_ratio > 0.6 else 1.0
    reliability *= max(0.05, 1 - tamper_ratio)
    reliability *= 0.55 if hazy else 1.0
    reliability *= 0.6 if med["brightness"] < 35 else 1.0
    reliability = float(max(0.02, min(1.0, reliability)))

    # ---------------- motion summary
    h_med = float(np.median(person_heights)) if person_heights else None
    vels = [v for tr in tracks if (v := _track_velocity(tr)) is not None]
    # Per-track measurements, so the UI can show exactly which tracked people drove the activity label.
    tracks_detail = []
    for tr in tracks:
        v = _track_velocity(tr)
        if v is None:
            continue
        vx, vy, hm = v
        spd = math.hypot(vx, vy) / hm if hm > 0 else 0.0
        tracks_detail.append({"id": tr["id"], "first_frame": int(round(tr["pts"][0][3] * fps)),
                              "last_frame": int(round(tr["pts"][-1][3] * fps)), "points": len(tr["pts"]),
                              "speed_bh_s": round(spd, 2), "running": bool(spd > RUNNING_BH_PER_S),
                              "direction_image_deg": round(math.degrees(math.atan2(-vy, vx)) % 360, 1)})
    running_ids = {t["id"] for t in tracks_detail if t["running"]}
    # Key frame: the detection frame showing the most running tracks (else the most people).
    key_frame, best = None, (-1, -1)
    for rec in per_frame:
        if not rec["detected"]:
            continue
        persons_f = [d for d in rec["detections"] if d.get("cls") == "person"]
        score = (sum(1 for d in persons_f if d.get("track") in running_ids), len(persons_f))
        if score > best:
            key_frame, best = rec["index"], score
    speeds = [math.hypot(vx, vy) / h for vx, vy, h in vels if h > 0]
    running_fraction = float(np.mean([s > RUNNING_BH_PER_S for s in speeds])) if speeds else 0.0
    if vels:
        units = np.array([[vx, vy] / (np.hypot(vx, vy) + 1e-6) for vx, vy, _ in vels])
        mean_u = units.mean(0)
        coherence = float(np.linalg.norm(mean_u))
        dir_img = float(math.degrees(math.atan2(-mean_u[1], mean_u[0])) % 360)
    else:
        coherence, dir_img = 0.0, None
    if flow_vecs:
        fv = np.array(flow_vecs)
        flow_speed_px_s = float(fv[:, 2].mean() * fps)
        flow_dir = float(math.degrees(math.atan2(-fv[:, 1].mean(), fv[:, 0].mean())) % 360)
    else:
        flow_speed_px_s, flow_dir = 0.0, None
    flow_speed_bh = flow_speed_px_s / h_med if h_med else None

    timings = {k: round(v, 1) for k, v in timings.items()}
    timings["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
    return {
        "frames_analyzed": i,
        "key_frame": key_frame,
        "fps": fps,
        "frame_size": [W, H],
        "preview_width": min(W, frame_width),
        "params": {"enhance": enhance_mode, "detect_every": detect_every, "conf": conf or detector.conf},
        "quality": {**{k: round(v, 3) for k, v in med.items()}, "frozen_ratio": round(frozen_ratio, 3),
                    "obstructed_ratio": round(tamper_ratio, 3), "issues": issues, "reliability": round(reliability, 3)},
        "persons": {
            "count_median": float(np.median(person_counts)) if person_counts else 0.0,
            "count_max": int(max(person_counts)) if person_counts else 0,
            "mean_score": round(float(np.mean(person_scores)), 3) if person_scores else None,
            "median_height_px": h_med,
            "tracks": len([t for t in tracks if len(t["pts"]) >= 2]),
        },
        "motion": {
            "fg_ratio": round(float(np.mean(fg_ratios)), 4) if fg_ratios else 0.0,
            "speed_bh_s_median": round(float(np.median(speeds)), 2) if speeds else None,
            "speed_bh_s_flow": round(flow_speed_bh, 2) if flow_speed_bh is not None else None,
            "running_fraction": round(running_fraction, 2),
            "direction_image_deg": round(dir_img, 1) if dir_img is not None else None,
            "flow_direction_image_deg": round(flow_dir, 1) if flow_dir is not None else None,
            "coherence": round(coherence, 2),
            "tracks_detail": tracks_detail,
            "running_track_ids": sorted(running_ids),
            "track_vectors": [[round(vx, 1), round(vy, 1), round(h, 1)] for vx, vy, h in vels][:40],
        },
        "weapon_like": weapon_like,
        "weapon_model": weapon_det.name if weapon_det else None,
        "detector": {"model": detector.name, "file": detector.model_path.name, "inferences": n_infer},
        "per_frame": per_frame,
        "frames_jpeg_b64": frames_out,
        "timings": timings,
    }
