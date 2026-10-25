"""CLEARPATH Vision Service (FastAPI). Runs locally in development and on AWS Graviton in production.

    uvicorn clearpath.vision.service:app --host 0.0.0.0 --port 8100
"""
from __future__ import annotations

import re
import tempfile
import time
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import aws
from ..config import FOOTAGE_DIR, settings
from .pipeline import analyze_video
from .runtime_info import runtime_info

app = FastAPI(title="CLEARPATH Vision Service", version="1.0.0")
_started = time.time()
_counters = {"analyses": 0, "errors": 0, "total_ms": 0.0}
SAFE = re.compile(r"^[A-Za-z0-9_\-]+$")


class AnalyzeRequest(BaseModel):
    clip_id: str = Field(..., description="Name of a clip in the footage library (without extension)")
    enhance: str = Field("none", pattern="^(none|clahe|dehaze)$")
    detect_every: int = Field(4, ge=1, le=20)
    conf: float | None = Field(None, ge=0.05, le=0.95)
    include_frames: bool = True


def _auth(x_api_key: str | None = Header(default=None)) -> None:
    if settings.vision_api_key and x_api_key != settings.vision_api_key:
        raise HTTPException(401, "invalid API key")


def resolve_clip(clip_id: str) -> Path:
    if not SAFE.match(clip_id):
        raise HTTPException(400, "invalid clip id")
    for ext in (".avi", ".mp4", ".mov", ".mkv"):
        p = FOOTAGE_DIR / f"{clip_id}{ext}"
        if p.exists():
            return p
    p = FOOTAGE_DIR / f"{clip_id}.avi"
    if aws.fetch_footage(p.name, p):
        return p
    raise HTTPException(404, f"clip '{clip_id}' not found")


def _finish(result: dict, t0: float) -> dict:
    ri = runtime_info()
    result["service"] = {
        "machine": ri["machine"], "arm64": ri["arm64"], "on_aws": ri["on_aws"],
        "instance_type": (ri["ec2"] or {}).get("instance_type"),
        "opencv_version": ri["opencv"]["version"], "cool": ri["cool"]["state"],
        "wall_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
    _counters["analyses"] += 1
    _counters["total_ms"] += result["timings"]["total_ms"]
    aws.put_metrics({"VisionTotalMs": result["timings"]["total_ms"], "DetectMs": result["timings"]["detect_ms"],
                     "FlowMs": result["timings"]["flow_ms"]},
                    {"Arch": ri["machine"], "OpenCV": ri["opencv"]["version"], "COOL": ri["cool"]["state"]})
    return result


@app.get("/v1/health")
def health() -> dict:
    return {"status": "ok", "uptime_s": round(time.time() - _started, 1), "counters": _counters,
            "runtime": runtime_info(), "footage_clips": sorted(p.stem for p in FOOTAGE_DIR.glob("*.avi"))}


@app.post("/v1/analyze", dependencies=[Depends(_auth)])
def analyze(req: AnalyzeRequest) -> dict:
    t0 = time.perf_counter()
    path = resolve_clip(req.clip_id)
    try:
        r = analyze_video(path, enhance_mode=req.enhance, detect_every=req.detect_every, conf=req.conf,
                          include_frames=req.include_frames)
    except Exception as e:
        _counters["errors"] += 1
        raise HTTPException(500, f"analysis failed: {e}") from e
    r["clip_id"] = req.clip_id
    return _finish(r, t0)


@app.post("/v1/analyze-upload", dependencies=[Depends(_auth)])
async def analyze_upload(file: UploadFile = File(...), enhance: str = Form("none"), detect_every: int = Form(4)) -> dict:
    t0 = time.perf_counter()
    if enhance not in {"none", "clahe", "dehaze"}:
        raise HTTPException(400, "bad enhance mode")
    suffix = Path(file.filename or "clip.mp4").suffix or ".mp4"
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            r = analyze_video(tmp.name, enhance_mode=enhance, detect_every=detect_every)
        except Exception as e:
            _counters["errors"] += 1
            raise HTTPException(422, f"analysis failed: {e}") from e
    r["clip_id"] = f"upload:{file.filename}"
    return _finish(r, t0)
