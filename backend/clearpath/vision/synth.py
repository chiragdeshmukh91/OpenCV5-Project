"""Synthetic camera footage generator (clearly labelled as SYNTHETIC).

Source material: OpenCV's public sample video `vtest.avi` (pedestrians filmed from an elevated camera).
We use OpenCV to (1) estimate a clean background plate with a temporal median, (2) cut out real
pedestrian sprites (detector box + background-difference mask), and (3) re-composite them with
controlled count, direction and speed, plus controlled degradations (smoke/haze, lens tampering,
frozen feed). This gives reproducible inputs whose ground-truth behaviour is known, so the agent can be
evaluated on different visual conditions. The resulting clips are synthetic composites, not real incidents.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2 as cv
import numpy as np

FPS = 10.0
N_FRAMES = 40


@dataclass
class Sprite:
    rgb: np.ndarray
    alpha: np.ndarray  # float32 0..1
    foot_y: int
    height: int


def build_plate_and_sprites(src: Path, out_dir: Path, detector) -> tuple[np.ndarray, list[Sprite]]:
    cap = cv.VideoCapture(str(src))
    frames = []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % 6 == 0:
            frames.append(f)
        i += 1
    cap.release()
    if not frames:
        raise RuntimeError(f"Could not read {src}")
    plate = np.median(np.stack(frames[:130]), axis=0).astype(np.uint8)
    sprites: list[Sprite] = []
    seen = []
    for f in frames[::3]:
        dets, _ = detector.detect(f)
        diff = cv.cvtColor(cv.absdiff(f, plate), cv.COLOR_BGR2GRAY)
        _, fg = cv.threshold(diff, 28, 255, cv.THRESH_BINARY)
        fg = cv.morphologyEx(fg, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_ELLIPSE, (7, 7)))
        fg = cv.morphologyEx(fg, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_ELLIPSE, (3, 3)))
        for d in dets:
            if d.cls != "person" or d.score < 0.8 or d.box[3] < 70:
                continue
            x, y, w, h = d.box
            # Skip overlapping people (sprites must contain a single person).
            others = [o for o in dets if o is not d and o.cls == "person"]
            if any(_iou(d.box, o.box) > 0.05 for o in others):
                continue
            m = fg[y:y + h, x:x + w]
            n, lab, stats, _ = cv.connectedComponentsWithStats(m)
            if n < 2:
                continue
            k = 1 + int(np.argmax(stats[1:, cv.CC_STAT_AREA]))
            mask = (lab == k).astype(np.uint8) * 255
            if mask.mean() / 255 < 0.25:
                continue
            mask = cv.GaussianBlur(mask, (5, 5), 0)
            key = (x // 40, y // 40)
            if key in seen:
                continue
            seen.append(key)
            sprites.append(Sprite(f[y:y + h, x:x + w].copy(), mask.astype(np.float32) / 255.0, y + h, h))
        if len(sprites) >= 40:
            break
    out_dir.mkdir(parents=True, exist_ok=True)
    cv.imwrite(str(out_dir / "plate.png"), plate)
    return plate, sprites


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / float(aw * ah + bw * bh - inter + 1e-9)


def _paste(canvas: np.ndarray, s: Sprite, x: float, foot_y: float) -> None:
    h, w = s.rgb.shape[:2]
    x0, y0 = int(round(x - w / 2)), int(round(foot_y - h))
    H, W = canvas.shape[:2]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    ex, ey = min(w, W - x0), min(h, H - y0)
    if ex <= sx0 or ey <= sy0:
        return
    roi = canvas[y0 + sy0:y0 + ey, x0 + sx0:x0 + ex].astype(np.float32)
    a = s.alpha[sy0:ey, sx0:ex, None]
    roi = roi * (1 - a) + s.rgb[sy0:ey, sx0:ex].astype(np.float32) * a
    canvas[y0 + sy0:y0 + ey, x0 + sx0:x0 + ex] = roi.astype(np.uint8)


def render_clip(plate: np.ndarray, sprites: list[Sprite], spec: dict, out_path: Path, seed: int = 0) -> dict:
    """Render a clip described by `spec` and return its ground-truth metadata."""
    rng = np.random.default_rng(seed)
    behavior = spec["behavior"]
    n = int(spec.get("people", {"normal": 6, "flight": 9, "empty": 0, "congested": 14}.get(behavior, 6)))
    direction = spec.get("direction", "right")  # image direction of flight for "flight"
    H, W = plate.shape[:2]
    # Per-camera look: optional flip/tint so cameras are distinguishable.
    base = plate.copy()
    if spec.get("flip"):
        base = cv.flip(base, 1)
    tint = spec.get("tint")
    if tint:
        base = cv.addWeighted(base, 0.85, np.full_like(base, tint, dtype=np.uint8), 0.15, 0)

    agents = []
    usable = [s for s in sprites if 90 < s.foot_y < H - 5]
    for i in range(n):
        s = usable[int(rng.integers(len(usable)))]
        if behavior == "flight":
            sign = 1 if direction == "right" else -1
            speed = rng.uniform(2.8, 4.0) * s.height  # px/s, body-heights per second
            x = (rng.uniform(-0.15, 0.55) if sign > 0 else rng.uniform(0.45, 1.15)) * W
            vx = sign * speed
        elif behavior == "congested":
            x = rng.normal(0.78 * W, 0.08 * W)
            vx = rng.normal(0, 0.08) * s.height
        else:
            sign = 1 if rng.random() < 0.5 else -1
            vx = sign * rng.uniform(0.7, 1.2) * s.height
            x = rng.uniform(0, W)
        agents.append({"s": s, "x": x, "vx": vx, "phase": rng.uniform(0, 6.28)})

    writer = cv.VideoWriter(str(out_path), cv.VideoWriter_fourcc(*"MJPG"), FPS, (W, H))
    frozen = None
    for t in range(N_FRAMES):
        frame = base.copy()
        for a in sorted(agents, key=lambda a: a["s"].foot_y):
            x = a["x"] + a["vx"] * t / FPS
            if behavior == "normal":
                x = x % (W + 120) - 60  # wrap around so the scene stays populated
            bob = 3 * math.sin(a["phase"] + t * (1.6 if abs(a["vx"]) > 2 * a["s"].height else 0.8))
            _paste(frame, a["s"], x, a["s"].foot_y + bob)
        frame = np.clip(frame.astype(np.float32) + rng.normal(0, 2.5, frame.shape), 0, 255).astype(np.uint8)
        if behavior == "tampered" or spec.get("tamper_after") is not None:
            k = int(spec.get("tamper_after", 0.3) * N_FRAMES)
            if t >= k:
                frame = cv.GaussianBlur(frame, (61, 61), 0)
                frame = cv.addWeighted(frame, 0.15, np.full_like(frame, 25), 0.85, 0)
        if spec.get("smoke"):
            a = min(0.72, spec["smoke"] * (0.5 + t / N_FRAMES))
            haze = cv.GaussianBlur(rng.normal(190, 20, frame.shape[:2]).astype(np.float32), (0, 0), 25)
            haze = np.repeat(haze[..., None], 3, 2)
            frame = np.clip(frame.astype(np.float32) * (1 - a) + haze * a, 0, 255).astype(np.uint8)
        if spec.get("frozen"):
            if frozen is None and t == 2:
                frozen = frame.copy()
            if frozen is not None:
                frame = frozen
        writer.write(frame)
    writer.release()
    return {
        "file": out_path.name,
        "synthetic": True,
        "source": "OpenCV sample vtest.avi (background plate + real pedestrian sprites), recomposited",
        "spec": spec,
        "ground_truth": {"behavior": behavior, "people": n, "direction": direction if behavior == "flight" else None},
    }


def generate_all(src: Path, out_dir: Path, clip_specs: dict[str, dict], detector) -> dict:
    plate, sprites = build_plate_and_sprites(src, out_dir, detector)
    if len(sprites) < 5:
        raise RuntimeError(f"Only {len(sprites)} sprites extracted; cannot synthesize footage")
    manifest = {"sprites": len(sprites), "clips": {}}
    for i, (clip_id, spec) in enumerate(sorted(clip_specs.items())):
        manifest["clips"][clip_id] = render_clip(plate, sprites, spec, out_dir / f"{clip_id}.avi", seed=1000 + i)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest
