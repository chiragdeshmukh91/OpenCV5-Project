"""CLEARPATH API (orchestrator + digital twin + decision support).

    uvicorn clearpath.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Literal

import cv2 as cv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import aws
from .agent.orchestrator import AgentManager, footage_manifest, load_scenarios
from .config import BACKEND_DIR, DATA_DIR, FOOTAGE_DIR, settings
from .twin.building import Building
from .vision.client import VisionClient, VisionError, save_upload

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="CLEARPATH", version="1.0.0",
              description="Agentic vision-based school safety assessment (SIMULATION ONLY).")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

building = Building.load()
vision = VisionClient()
manager = AgentManager(building, vision)


class StartRun(BaseModel):
    scenario_id: str
    overrides: dict[str, str] = Field(default_factory=dict, description="camera_id -> clip_id")


class Review(BaseModel):
    action: Literal["approve", "reject", "more_evidence", "block_exit"]
    option_id: str | None = None
    exit_id: str | None = None
    note: str = ""
    reviewer: str = "Safety lead"


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "time": time.time()}


@app.get("/api/status")
def status() -> dict:
    vh = vision.health()
    rt = vh.get("runtime", {})
    return {
        "simulation": True,
        "vision": {"mode": vh.get("mode"), "endpoint": vh.get("endpoint"), "reachable": vh.get("reachable"),
                   "latency_ms": vh.get("latency_ms"), "error": vh.get("error"), "machine": rt.get("machine"),
                   "arm64": rt.get("arm64"), "on_aws": rt.get("on_aws"), "graviton": rt.get("graviton"),
                   "ec2": rt.get("ec2"), "opencv": rt.get("opencv"), "cool": rt.get("cool"),
                   "counters": vh.get("counters")},
        "aws": aws.status(),
        "detector": {"model": settings.detector_model.name, "weapon_model": settings.weapon_model.name if settings.weapon_model else None},
    }


@app.get("/api/building")
def get_building() -> dict:
    issues = building.validate()
    return {**building.to_dict(), "validation": [i.to_dict() for i in issues]}


@app.get("/api/scenarios")
def scenarios() -> dict:
    return load_scenarios()


@app.get("/api/footage")
def footage() -> dict:
    m = footage_manifest()
    uploads = sorted(p.stem for p in FOOTAGE_DIR.glob("upload_*"))
    return {"clips": m.get("clips", {}), "uploads": uploads}


@app.get("/api/footage/{clip_id}/preview.jpg")
def footage_preview(clip_id: str, frame: int = 12) -> Response:
    if not clip_id.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(400, "bad clip id")
    path = next(iter(sorted(FOOTAGE_DIR.glob(f"{clip_id}.*"))), None)
    if path is None or path.suffix == ".json":
        raise HTTPException(404, "clip not found")
    cap = cv.VideoCapture(str(path))
    cap.set(cv.CAP_PROP_POS_FRAMES, frame)
    ok, img = cap.read()
    cap.release()
    if not ok:
        raise HTTPException(422, "cannot decode clip")
    img = cv.resize(img, (480, int(img.shape[0] * 480 / img.shape[1])))
    return Response(cv.imencode(".jpg", img, [cv.IMWRITE_JPEG_QUALITY, 70])[1].tobytes(), media_type="image/jpeg",
                    headers={"Cache-Control": "max-age=3600"})


@app.post("/api/footage/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    try:
        cid = save_upload(data, file.filename or "clip.mp4")
    except VisionError as e:
        raise HTTPException(400, str(e)) from e
    cap = cv.VideoCapture(str(next(FOOTAGE_DIR.glob(f"{cid}.*"))))
    ok = cap.isOpened() and cap.read()[0]
    cap.release()
    if not ok:
        raise HTTPException(422, "OpenCV could not decode this video")
    return {"clip_id": cid}


@app.post("/api/runs")
def start_run(req: StartRun) -> dict:
    try:
        run = manager.start(req.scenario_id, req.overrides)
    except KeyError as e:
        raise HTTPException(404, f"unknown id {e}") from e
    return {"run_id": run.id}


@app.get("/api/runs/current")
def current_run() -> dict:
    if not manager.current:
        return {"run": None}
    return {"run": manager.runs[manager.current].snapshot()}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run = manager.runs.get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return run.snapshot()


@app.post("/api/runs/{run_id}/review")
def review(run_id: str, body: Review) -> dict:
    run = manager.runs.get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    if body.action == "block_exit" and body.exit_id not in building.exits:
        raise HTTPException(400, "unknown exit")
    try:
        run.submit_review(body.model_dump())
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True}


@app.post("/api/runs/{run_id}/cancel")
def cancel(run_id: str) -> dict:
    run = manager.runs.get(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    run.cancelled = True
    return {"ok": True}


app.mount("/media", StaticFiles(directory=str(DATA_DIR)), name="media")

_dist = Path(BACKEND_DIR).parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=str(_dist / "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        f = _dist / path
        return FileResponse(f if path and f.is_file() else _dist / "index.html")
