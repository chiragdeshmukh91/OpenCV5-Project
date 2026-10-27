"""HTTP contracts of the main API and the standalone vision service (FastAPI TestClient; no network)."""
from __future__ import annotations

import cv2 as cv
import numpy as np
import pytest
from fastapi.testclient import TestClient

from clearpath import main
from clearpath.agent.orchestrator import Run, load_scenarios
from clearpath.config import settings
from clearpath.vision import service


@pytest.fixture(scope="module")
def api():
    with TestClient(main.app) as c:
        yield c


@pytest.fixture(scope="module")
def vsvc():
    with TestClient(service.app) as c:
        yield c


# ------------------------------------------------------------------------------ main API
def test_status(api):
    r = api.get("/api/status")
    assert r.status_code == 200
    j = r.json()
    assert j["simulation"] is True
    v = j["vision"]
    assert v["mode"] == "local" and v["reachable"] is True
    assert v["opencv"]["version"] == cv.__version__
    assert v["cool"]["state"] == "not_in_use"
    assert v["machine"]
    assert "connected" in j["aws"]


def test_building_includes_validation(api):
    j = api.get("/api/building").json()
    assert isinstance(j["validation"], list)
    assert not [i for i in j["validation"] if i["severity"] == "error"]
    assert {"zones", "exits", "doors", "cameras", "bounds"} <= set(j)
    assert len(j["zones"]) == 16


def test_scenarios(api):
    j = api.get("/api/scenarios").json()
    ids = [s["id"] for s in j["scenarios"]]
    assert len(ids) == 4 and all(s["expected"]["primary_option"] for s in j["scenarios"])


def test_footage_list(api):
    j = api.get("/api/footage").json()
    assert {"normal_a", "flight_left_a", "smoke_normal", "tampered"} <= set(j["clips"])
    assert all(c["synthetic"] for c in j["clips"].values())


def test_footage_preview_jpeg(api):
    r = api.get("/api/footage/normal_a/preview.jpg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    img = cv.imdecode(np.frombuffer(r.content, np.uint8), cv.IMREAD_COLOR)
    assert img is not None and img.shape[1] == 480


@pytest.mark.parametrize("clip,code", [("bad$id", 400), ("no_such_clip", 404), ("manifest", 404)])
def test_footage_preview_invalid(api, clip, code):
    assert api.get(f"/api/footage/{clip}/preview.jpg").status_code == code


def test_unknown_scenario_404(api):
    assert api.post("/api/runs", json={"scenario_id": "S9-nope"}).status_code == 404


def test_review_unknown_run_404(api):
    assert api.post("/api/runs/does-not-exist/review", json={"action": "approve"}).status_code == 404


def test_review_on_non_awaiting_run_409(api):
    scen = load_scenarios()["scenarios"][0]
    run = Run(main.building, scen, main.vision, step_delay=0)  # constructed, never started: status "running"
    main.manager.runs[run.id] = run
    try:
        assert run.state["status"] == "running"
        r = api.post(f"/api/runs/{run.id}/review", json={"action": "approve"})
        assert r.status_code == 409
        assert api.post(f"/api/runs/{run.id}/review", json={"action": "block_exit", "exit_id": "EX-NOPE"}).status_code == 400
        assert api.post(f"/api/runs/{run.id}/review", json={"action": "launch"}).status_code == 422
        assert api.get(f"/api/runs/{run.id}").json()["run_id"] == run.id
        assert api.post(f"/api/runs/{run.id}/cancel").json() == {"ok": True}
    finally:
        main.manager.runs.pop(run.id, None)


# ------------------------------------------------------------------------------ vision service
def test_vision_health(vsvc):
    j = vsvc.get("/v1/health").json()
    assert j["status"] == "ok"
    rt = j["runtime"]
    assert rt["opencv"]["version"] == cv.__version__
    assert rt["ec2"] is None and rt["on_aws"] is False  # CLEARPATH_SKIP_IMDS=1
    assert rt["cool"]["state"] == "not_in_use"
    assert "normal_a" in j["footage_clips"]


def test_vision_analyze(vsvc):
    r = vsvc.post("/v1/analyze", json={"clip_id": "normal_a", "include_frames": False})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["clip_id"] == "normal_a"
    assert j["frames_jpeg_b64"] == []
    assert j["persons"]["count_max"] >= 3
    assert j["service"]["machine"] and j["service"]["opencv_version"] == cv.__version__
    assert j["timings"]["total_ms"] > 0


@pytest.mark.parametrize("body,code", [
    ({"clip_id": "../etc/passwd"}, 400),
    ({"clip_id": "bad id"}, 400),
    ({"clip_id": "no_such_clip"}, 404),
    ({"clip_id": "normal_a", "enhance": "sharpen"}, 422),
    ({"clip_id": "normal_a", "detect_every": 0}, 422),
])
def test_vision_analyze_bad_requests(vsvc, body, code):
    assert vsvc.post("/v1/analyze", json=body).status_code == code


def test_vision_api_key_enforced(vsvc, monkeypatch):
    monkeypatch.setattr(settings, "vision_api_key", "s3cret")
    assert vsvc.post("/v1/analyze", json={"clip_id": "../x"}).status_code == 401
    assert vsvc.post("/v1/analyze", json={"clip_id": "../x"}, headers={"x-api-key": "s3cret"}).status_code == 400


def test_cool_marker_states(vsvc, monkeypatch):
    """The COOL state is measured against the loaded build, never asserted from configuration alone."""
    monkeypatch.setattr(settings, "cool_expected", True)
    monkeypatch.setattr(settings, "cool_marker", "definitely-not-in-this-build-0xC001")
    assert vsvc.get("/v1/health").json()["runtime"]["cool"]["state"] == "expected_not_verified"
    monkeypatch.setattr(settings, "cool_marker", "General configuration for OpenCV")  # present in every build
    assert vsvc.get("/v1/health").json()["runtime"]["cool"]["state"] == "verified_marker"


def test_missing_footage_is_reported_with_the_fix(api, monkeypatch, tmp_path):
    """Regression: a fresh checkout has the manifest but not the generated .avi clips; previews returned a bare 404."""
    from clearpath import main
    monkeypatch.setattr(main, "FOOTAGE_DIR", tmp_path)
    assert "normal_a" in main.missing_clips()
    r = api.get("/api/footage/normal_a/preview.jpg")
    assert r.status_code == 404 and "generate_footage.py" in r.json()["detail"]
    assert "normal_a" in api.get("/api/footage").json()["missing"]
