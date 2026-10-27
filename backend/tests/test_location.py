"""Location attribution (regression for: people outside the school raised alerts inside buildings)."""
from __future__ import annotations

from clearpath.agent.location import assess_location, confirm_location, dismiss_location
from clearpath.agent.orchestrator import footage_manifest


def _cam(building, cid):
    return {**building.cameras[cid], "id": cid}


def test_layout_cameras_declare_environment(building):
    assert all(c.get("environment") == "indoor" for c in building.cameras.values())


def test_all_synthetic_clips_are_outdoor_and_not_from_a_school_camera():
    clips = footage_manifest()["clips"]
    assert clips
    for c in clips.values():
        assert c["scene"]["environment"] == "outdoor"
        assert c["scene"]["recorded_by_camera"] is None


def test_outdoor_clip_on_indoor_camera_has_unknown_location(building):
    meta = footage_manifest()["clips"]["flight_left_a"]
    loc = assess_location(_cam(building, "CAM-03"), "flight_left_a", meta)
    assert loc["status"] == "unverified" and loc["zone"] is None and loc["confidence"] == 0
    assert loc["camera_zone"] == "C3"
    assert any("outdoor" in r and "indoor" in r for r in loc["reasons"])


def test_uploaded_clip_location_unknown(building):
    loc = assess_location(_cam(building, "CAM-01"), "upload_abc", None)
    assert loc["status"] == "unverified" and loc["zone"] is None
    assert "origin unknown" in loc["reasons"][0]


def test_registered_feed_is_verified(building):
    meta = {"scene": {"environment": "indoor", "recorded_by_camera": "CAM-02"}}
    assert assess_location(_cam(building, "CAM-02"), "x", meta)["zone"] == "C2"
    # a feed registered to another camera is not this camera's location
    assert assess_location(_cam(building, "CAM-03"), "x", meta)["zone"] is None


def test_confirm_and_dismiss(building):
    loc = assess_location(_cam(building, "CAM-02"), "normal_a", footage_manifest()["clips"]["normal_a"])
    c = confirm_location(loc, "Lead")
    assert c["zone"] == "C2" and c["status"] == "human_confirmed" and "Lead" in c["basis"]
    d = dismiss_location(loc, "Lead")
    assert d["zone"] is None and d["status"] == "dismissed"
