"""OpenCV pipeline and detector on real (recomposited) footage. Results come from the session cache, so each
clip is decoded and analysed once for the whole test session."""
from __future__ import annotations

import cv2 as cv
import numpy as np
import pytest

from clearpath.agent.perception import _angdiff, interpret
from clearpath.config import BACKEND_DIR
from clearpath.vision import detector as det_mod
from clearpath.vision.pipeline import analyze_video, enhance, frame_quality


def cam(building, cid):
    return {**building.cameras[cid], "id": cid}


# ------------------------------------------------------------------------------- behaviour
def test_calm_vs_flight_activity(analysis, building):
    calm = interpret(analysis("normal_a"), cam(building, "CAM-02"))
    flight = interpret(analysis("flight_left_a"), cam(building, "CAM-02"))
    assert calm.activity == "calm"
    assert flight.activity == "flight"
    assert calm.activity != flight.activity


def test_flight_motion_statistics(analysis):
    m = analysis("flight_left_a")["motion"]
    assert m["speed_bh_s_median"] > 2.0
    assert m["coherence"] > 0.6
    assert m["running_fraction"] >= 0.5
    calm = analysis("normal_a")["motion"]
    assert calm["speed_bh_s_median"] < 2.0


def test_flight_heading_maps_to_west_for_cam03(analysis, building):
    c = cam(building, "CAM-03")
    assert c["image_right_heading_deg"] == 0
    ev = interpret(analysis("flight_left_a"), c)
    assert ev.activity == "flight"
    assert _angdiff(ev.flight_heading_deg, 180.0) < 30, ev.flight_heading_deg  # people move west
    assert _angdiff(ev.source_heading_deg, 0.0) < 30, ev.source_heading_deg  # hazard lies east


def test_empty_clip_has_no_people(analysis, building):
    r = analysis("empty_a")
    assert r["persons"]["count_max"] == 0
    assert interpret(r, cam(building, "CAM-05")).activity == "empty"


def test_frozen_feed_flagged(analysis, building):
    q = analysis("frozen_normal")["quality"]
    assert "frozen_feed" in q["issues"]
    assert q["reliability"] < 0.3
    assert interpret(analysis("frozen_normal"), cam(building, "CAM-02")).activity == "unusable"


def test_tampered_lens_flagged(analysis):
    q = analysis("tampered")["quality"]
    assert "lens_obstructed_or_defocused" in q["issues"]
    assert q["reliability"] < 0.3


def test_smoke_flags_haze_and_stays_usable(analysis):
    q = analysis("smoke_normal")["quality"]
    assert "low_visibility_haze" in q["issues"]
    assert 0.3 <= q["reliability"] < 1.0  # degraded, not discarded: the agent re-analyses with dehaze
    assert "frozen_feed" not in q["issues"]


def test_clean_clip_has_no_quality_issues(analysis):
    q = analysis("normal_a")["quality"]
    assert q["issues"] == [] and q["reliability"] == 1.0


def test_result_contract(analysis):
    r = analysis("normal_a")
    for k in ("decode_ms", "quality_ms", "enhance_ms", "bgsub_ms", "flow_ms", "detect_ms", "total_ms"):
        assert r["timings"][k] >= 0
    assert r["frames_analyzed"] > 0 and r["detector"]["inferences"] > 0
    assert r["service"]["opencv_version"] == cv.__version__
    assert r["service"]["cool"] == "not_in_use"


@pytest.mark.parametrize("mode", ["dehaze", "clahe", "none"])
def test_enhance_returns_same_shape_uint8(footage_dir, mode):
    cap = cv.VideoCapture(str(footage_dir / "smoke_normal.avi"))
    ok, img = cap.read()
    cap.release()
    assert ok
    out = enhance(img, mode)
    assert out.shape == img.shape and out.dtype == np.uint8
    if mode == "dehaze":
        assert frame_quality(out)["contrast"] > frame_quality(img)["contrast"]


def test_analyze_without_frames_on_short_clip(footage_dir):
    r = analyze_video(footage_dir / "empty_a.avi", max_frames=8, include_frames=False)
    assert r["frames_jpeg_b64"] == [] and r["frames_analyzed"] == 8


def test_missing_video_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        analyze_video(tmp_path / "nope.avi")


# ------------------------------------------------------------------------------- detector
def test_yolox_finds_people_in_vtest():
    cap = cv.VideoCapture(str(BACKEND_DIR / "assets" / "vtest.avi"))
    cap.set(cv.CAP_PROP_POS_FRAMES, 200)
    ok, frame = cap.read()
    cap.release()
    assert ok
    dets, infer_ms = det_mod.get_detector().detect(frame)
    persons = [d for d in dets if d.cls == "person" and d.score > 0.5]
    assert len(persons) >= 3, [d.to_dict() for d in dets]
    assert infer_ms > 0
    H, W = frame.shape[:2]
    for d in persons:
        x, y, w, h = d.box
        assert 0 <= x < W and 0 <= y < H and w > 2 and h > 2


def test_no_firearm_class_honesty_guarantee():
    """CLEARPATH never claims firearm detection from the COCO model.

    COCO-80 has no firearm class, so the stock detector *cannot* output one. Only knife / baseball bat / scissors
    are surfaced, as low-specificity 'weapon-like' cues that always route to human verification. A dedicated weapon
    model is opt-in (WEAPON_MODEL); without it the capability is reported as unavailable, never simulated."""
    assert len(det_mod.COCO_CLASSES) == 80
    banned = ("gun", "firearm", "pistol", "rifle", "handgun", "weapon", "shotgun")
    assert not [c for c in det_mod.COCO_CLASSES if any(b in c for b in banned)]
    assert det_mod.WEAPON_LIKE_COCO <= set(det_mod.COCO_CLASSES)
    assert det_mod.WEAPON_LIKE_COCO == {"knife", "baseball bat", "scissors"}
    assert det_mod.get_weapon_detector() is None


# ------------------------------------------------------------------------------- evidence visibility (regression)
def test_evidence_frames_are_native_resolution(analysis):
    """Evidence frames used to be downscaled to 480 px at JPEG q72, too small to see who triggered an event."""
    import base64
    r = analysis("flight_left_a")
    W, H = r["frame_size"]
    assert r["preview_width"] == W  # 768 px source: kept at native size, never upscaled
    img = cv.imdecode(np.frombuffer(base64.b64decode(r["frames_jpeg_b64"][0]), np.uint8), cv.IMREAD_COLOR)
    assert img.shape[1] == W and img.shape[0] == H


def test_running_tracks_and_key_frame_explain_flight(analysis):
    r = analysis("flight_left_a")
    m = r["motion"]
    running = [t for t in m["tracks_detail"] if t["running"]]
    assert running and m["running_track_ids"] == sorted(t["id"] for t in running)
    assert all(t["speed_bh_s"] > 2.0 for t in running)
    kf = r["key_frame"]
    rec = r["per_frame"][kf]
    assert rec["detected"]
    # the key frame actually shows boxes belonging to running tracks
    assert any(d.get("track") in set(m["running_track_ids"]) for d in rec["detections"])
    calm = analysis("normal_a")["motion"]
    assert not [t for t in calm["tracks_detail"] if t["running"]] or calm["running_fraction"] < 0.5
