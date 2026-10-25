"""Shared fixtures for the CLEARPATH test-suite.

Environment is pinned *before* any clearpath module is imported (clearpath.config reads env at import):
  * no IMDS probes, no AWS calls (no bucket, no CloudWatch, boto3 metadata lookups disabled),
  * vision runs in-process (VISION_MODE=local),
  * run media goes to a throw-away directory instead of backend/runtime (the dev server uses that).

Each OpenCV analysis costs ~4-5 s on 2 vCPU, so every (clip, enhance, detect_every, conf) combination is
analysed at most once per session and shared by the pipeline, perception and agent tests.
"""
from __future__ import annotations

import copy
import os
import sys
import tempfile
import threading
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="clearpath-tests-"))
os.environ["CLEARPATH_SKIP_IMDS"] = "1"
os.environ["AWS_EC2_METADATA_DISABLED"] = "true"
os.environ["VISION_MODE"] = "local"
os.environ["CLEARPATH_DATA_DIR"] = str(_TMP / "runtime")
for _k in ("CLEARPATH_S3_BUCKET", "CLEARPATH_CLOUDWATCH", "VISION_API_KEY", "WEAPON_MODEL",
           "CLEARPATH_COOL_EXPECTED", "CLEARPATH_COOL_MARKER", "AGENT_MAX_STEPS"):
    os.environ.pop(_k, None)

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import pytest  # noqa: E402

from clearpath.config import FOOTAGE_DIR  # noqa: E402
from clearpath.twin.building import Building  # noqa: E402
from clearpath.vision.client import VisionClient  # noqa: E402

_cache: dict[tuple, dict] = {}
_key_locks: dict[tuple, threading.Lock] = {}
_guard = threading.Lock()
STATS = {"computed": 0, "hits": 0}


def cached_analysis(clip_id: str, enhance: str = "none", detect_every: int = 4, conf: float | None = None) -> dict:
    """Real analysis through the in-process vision service, memoised per parameter set.

    Returns a deep copy because the orchestrator mutates results (pops frames, adds analysis_id)."""
    key = (clip_id, enhance, detect_every, conf)
    with _guard:
        lock = _key_locks.setdefault(key, threading.Lock())
    with lock:
        if key not in _cache:
            _cache[key] = VisionClient.analyze(_RAW_CLIENT, clip_id, enhance=enhance, detect_every=detect_every, conf=conf)
            STATS["computed"] += 1
        else:
            STATS["hits"] += 1
        return copy.deepcopy(_cache[key])


_RAW_CLIENT = VisionClient()


class CachingVisionClient(VisionClient):
    """Same contract as VisionClient (local mode); identical requests reuse the first real result."""

    def analyze(self, clip_id: str, enhance: str = "none", detect_every: int = 4, conf: float | None = None) -> dict:
        return cached_analysis(clip_id, enhance, detect_every, conf)


@pytest.fixture(scope="session")
def building() -> Building:
    return Building.load()


@pytest.fixture(scope="session")
def footage_dir() -> Path:
    return FOOTAGE_DIR


@pytest.fixture(scope="session")
def analysis():
    return cached_analysis


@pytest.fixture(scope="session")
def tmp_root() -> Path:
    return _TMP
