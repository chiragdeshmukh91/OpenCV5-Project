"""Where did an observation happen?

A camera's configured zone is where the camera is *mounted*. It is only the location of the people in a
clip when the clip really was recorded by that camera. In this simulation every clip is replayed sample
footage assigned to a camera by the scenario (the synthetic clips are recomposited from OpenCV's outdoor
vtest.avi plaza), so the mount zone cannot be trusted as the observation's location. Treating it as such
is what made people walking on an outdoor lawn raise a threat zone inside the East Hall.

Rules:
  * verified    - the footage metadata says it was recorded by this camera (``scene.recorded_by_camera``).
  * unverified  - anything else. The observation is kept and shown, but it does not update the zone
                  belief or the twin until a human confirms the location; its location is shown as unknown.
"""
from __future__ import annotations

from typing import Any


def assess_location(camera: dict[str, Any], clip_id: str | None, clip_meta: dict[str, Any] | None) -> dict[str, Any]:
    zone = camera["zone"]
    scene = (clip_meta or {}).get("scene") or {}
    env = scene.get("environment") or "unknown"
    cam_env = camera.get("environment") or "unknown"
    recorded_by = scene.get("recorded_by_camera")
    if recorded_by and recorded_by == camera.get("id"):
        return {"camera_zone": zone, "zone": zone, "status": "verified", "confidence": 1.0,
                "footage_environment": env, "camera_environment": cam_env,
                "basis": f"footage recorded by {camera.get('id')}, mounted in {zone}", "reasons": []}
    reasons: list[str] = []
    if clip_meta is None:
        reasons.append("Footage origin unknown (uploaded or unregistered clip); it is not a registered feed of this camera.")
    else:
        reasons.append(f"Clip '{clip_id}' is replayed sample footage assigned to this camera by the scenario, "
                       f"not a recording from it.")
    if env != "unknown" and cam_env != "unknown" and env != cam_env:
        reasons.append(f"Footage shows an {env} scene; this camera is mounted {cam_env} in {zone}.")
    if scene.get("description"):
        reasons.append(f"Footage: {scene['description']}.")
    return {"camera_zone": zone, "zone": None, "status": "unverified", "confidence": 0.0,
            "footage_environment": env, "camera_environment": cam_env,
            "basis": "location unknown — footage not verified as recorded at this camera's site", "reasons": reasons}


def confirm_location(loc: dict[str, Any], reviewer: str) -> dict[str, Any]:
    return {**loc, "zone": loc["camera_zone"], "status": "human_confirmed", "confidence": 1.0,
            "basis": f"{reviewer} confirmed the observation happened in {loc['camera_zone']}"}


def dismiss_location(loc: dict[str, Any], reviewer: str) -> dict[str, Any]:
    return {**loc, "zone": None, "status": "dismissed", "confidence": 0.0,
            "basis": f"{reviewer} dismissed this observation; it is excluded from the assessment"}
