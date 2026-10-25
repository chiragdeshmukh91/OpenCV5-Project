"""Vision client used by the agent. Same contract whether the vision service runs in-process (local
development) or remotely on AWS Graviton (VISION_MODE=remote, VISION_SERVICE_URL=...)."""
from __future__ import annotations

import time
from pathlib import Path

import httpx

from ..config import FOOTAGE_DIR, settings


class VisionError(RuntimeError):
    pass


class VisionClient:
    def __init__(self) -> None:
        self.mode = settings.vision_mode
        self.url = settings.vision_service_url.rstrip("/")
        self._last_health: dict | None = None
        self._last_health_t = 0.0

    def _headers(self) -> dict:
        return {"x-api-key": settings.vision_api_key} if settings.vision_api_key else {}

    def health(self, max_age_s: float = 10.0) -> dict:
        if self._last_health and time.time() - self._last_health_t < max_age_s:
            return self._last_health
        t0 = time.perf_counter()
        if self.mode == "remote":
            try:
                r = httpx.get(f"{self.url}/v1/health", timeout=5, headers=self._headers())
                r.raise_for_status()
                h = {"reachable": True, **r.json()}
            except Exception as e:
                h = {"reachable": False, "error": f"{type(e).__name__}: {e}"[:200]}
        else:
            from .service import health
            h = {"reachable": True, **health()}
        h["mode"] = self.mode
        h["endpoint"] = self.url if self.mode == "remote" else "in-process"
        h["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        self._last_health, self._last_health_t = h, time.time()
        return h

    def analyze(self, clip_id: str, enhance: str = "none", detect_every: int = 4, conf: float | None = None) -> dict:
        payload = {"clip_id": clip_id, "enhance": enhance, "detect_every": detect_every, "conf": conf}
        if clip_id.startswith("upload_") and self.mode == "remote":
            return self._analyze_upload(clip_id, enhance, detect_every)
        if self.mode == "remote":
            try:
                r = httpx.post(f"{self.url}/v1/analyze", json=payload, timeout=settings.vision_timeout_s,
                               headers=self._headers())
            except httpx.HTTPError as e:
                raise VisionError(f"vision service unreachable: {type(e).__name__}") from e
            if r.status_code != 200:
                raise VisionError(f"vision service error {r.status_code}: {r.text[:200]}")
            return r.json()
        from fastapi import HTTPException

        from .service import AnalyzeRequest, analyze
        try:
            return analyze(AnalyzeRequest(**payload))
        except HTTPException as e:
            raise VisionError(str(e.detail)) from e

    def _analyze_upload(self, clip_id: str, enhance: str, detect_every: int) -> dict:
        path = next(FOOTAGE_DIR.glob(f"{clip_id}.*"), None)
        if path is None:
            raise VisionError(f"upload {clip_id} missing")
        with open(path, "rb") as f:
            r = httpx.post(f"{self.url}/v1/analyze-upload", files={"file": (path.name, f)},
                           data={"enhance": enhance, "detect_every": str(detect_every)},
                           timeout=settings.vision_timeout_s, headers=self._headers())
        if r.status_code != 200:
            raise VisionError(f"vision service error {r.status_code}: {r.text[:200]}")
        out = r.json()
        out["clip_id"] = clip_id
        return out


def save_upload(data: bytes, filename: str) -> str:
    import hashlib
    suffix = Path(filename).suffix.lower() or ".mp4"
    if suffix not in {".mp4", ".avi", ".mov", ".mkv"}:
        raise VisionError("unsupported video type")
    cid = "upload_" + hashlib.sha256(data).hexdigest()[:12]
    (FOOTAGE_DIR / f"{cid}{suffix}").write_bytes(data)
    return cid
