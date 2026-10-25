"""Turn raw OpenCV measurements into camera-level evidence, and maintain the threat-location belief.

The belief is a categorical distribution over building zones plus a NONE hypothesis ("no active
threat"). Evidence updates use likelihood ratios tempered by measured camera reliability, so a
frozen or obstructed camera contributes (almost) nothing, and a single uncorroborated report can
never by itself produce a confident localisation.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from ..twin.building import Building

NONE = "__none__"
NONE_FLOOR = 0.03

ACTIVITY_LABELS = {
    "flight": "Coherent rapid movement (people running in one direction)",
    "agitated": "Rapid but incoherent movement",
    "calm": "Ordinary walking movement",
    "congested": "Dense, near-stationary crowd",
    "empty": "No people detected",
    "unusable": "Feed unusable (frozen / obstructed / no visibility)",
}


@dataclass
class Evidence:
    camera_id: str
    zone: str
    activity: str
    reliability: float
    persons: float
    persons_max: int
    speed_bh_s: float | None
    flow_speed_bh_s: float | None
    running_fraction: float
    coherence: float
    flight_heading_deg: float | None  # map heading people move toward
    source_heading_deg: float | None  # inferred direction of the hazard (opposite of flight)
    weapon_like: list[dict]
    issues: list[str]
    consistency: dict[str, Any] = field(default_factory=dict)
    enhanced: bool = False
    analysis_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = dict(self.__dict__)
        d["activity_label"] = ACTIVITY_LABELS[self.activity]
        return d


def _angdiff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def interpret(result: dict, camera: dict) -> Evidence:
    q, p, m = result["quality"], result["persons"], result["motion"]
    r = float(q["reliability"])
    persons = float(p["count_median"])
    speed = m["speed_bh_s_median"]
    flow_speed = m["speed_bh_s_flow"]
    run_frac = float(m["running_fraction"])
    coh = float(m["coherence"])
    dir_img = m["direction_image_deg"]
    heading = (camera["image_right_heading_deg"] + dir_img) % 360 if dir_img is not None else None

    # Cross-check the two independent motion estimates (tracked detections vs dense Farneback flow).
    consistency: dict[str, Any] = {"checked": False}
    if speed is not None and flow_speed is not None and p["tracks"] >= 3:
        ratio = max(speed, flow_speed) / max(1e-3, min(speed, flow_speed))
        dir_gap = (_angdiff(dir_img, m["flow_direction_image_deg"])
                   if dir_img is not None and m["flow_direction_image_deg"] is not None else None)
        ok = ratio < 2.2 and (dir_gap is None or coh < 0.5 or dir_gap < 50)
        consistency = {"checked": True, "speed_ratio": round(ratio, 2), "direction_gap_deg": dir_gap, "consistent": ok}

    if r < 0.3:
        activity = "unusable"
    elif p["count_max"] == 0:
        activity = "empty"
    elif speed is not None and run_frac >= 0.5 and speed >= 2.0 and coh >= 0.6 and p["tracks"] >= 3:
        activity = "flight"
    elif speed is not None and run_frac >= 0.5 and speed >= 2.0:
        activity = "agitated"
    elif persons >= 10 and (speed or 0) < 0.45:
        activity = "congested"
    else:
        activity = "calm"
    return Evidence(
        camera_id=camera["id"], zone=camera["zone"], activity=activity, reliability=r, persons=persons,
        persons_max=int(p["count_max"]), speed_bh_s=speed, flow_speed_bh_s=flow_speed, running_fraction=run_frac,
        coherence=coh, flight_heading_deg=round(heading, 1) if heading is not None and activity == "flight" else None,
        source_heading_deg=round((heading + 180) % 360, 1) if heading is not None and activity == "flight" else None,
        weapon_like=result.get("weapon_like", []), issues=list(q["issues"]), consistency=consistency,
        enhanced=result["params"]["enhance"] != "none", analysis_id=result.get("analysis_id"),
    )


class ThreatBelief:
    def __init__(self, building: Building):
        self.b = building
        self.zones = list(building.zones)
        self.p: dict[str, float] = {}
        self.supporting = 0  # visual observations that indicate an incident (flight, agitation, weapon-like object)

    # ------------------------------------------------------------------ prior
    def init_from_report(self, zone: str, confidence: float) -> None:
        conf = max(0.01, min(0.95, confidence))
        near = set(self.b.neighbors(zone))
        rest = [z for z in self.zones if z != zone and z not in near]
        self.p = {NONE: 1 - conf}
        self.p[zone] = conf * 0.5
        for z in near:
            self.p[z] = conf * 0.3 / max(1, len(near))
        for z in rest:
            self.p[z] = conf * 0.2 / max(1, len(rest))
        self._norm()

    def _norm(self) -> None:
        s = sum(self.p.values())
        for k in self.p:
            self.p[k] /= s

    # ---------------------------------------------------------------- update
    def likelihoods(self, ev: Evidence) -> dict[str, float]:
        cam = self.b.cameras[ev.camera_id]
        cx, cy = cam["position"]
        near = set(self.b.neighbors(ev.zone))
        lr = {k: 1.0 for k in self.p}
        if ev.activity == "unusable":
            return lr
        if ev.activity == "flight":
            lr[NONE] = 0.25
            for z in self.zones:
                if z == ev.zone:
                    lr[z] = 2.0
                    continue
                zx, zy = self.b.centroid(z)
                bearing = math.degrees(math.atan2(zy - cy, zx - cx)) % 360
                align = max(0.0, math.cos(math.radians(_angdiff(bearing, ev.source_heading_deg))))
                dist = math.hypot(zx - cx, zy - cy)
                lr[z] = 1.0 + 6.0 * ev.coherence * align ** 2 * math.exp(-dist / 30.0)
                if align == 0:
                    lr[z] = 0.6  # people are fleeing toward this side: it is less likely the source
        elif ev.activity == "agitated":
            lr[NONE] = 0.5
            lr[ev.zone] = 2.5
            for z in near:
                lr[z] = 1.5
        elif ev.activity == "calm":
            lr[NONE] = 1.3
            lr[ev.zone] = 0.3
            for z in near:
                lr[z] = 0.75
        elif ev.activity == "empty":
            lr[ev.zone] = 0.5
        elif ev.activity == "congested":
            lr[ev.zone] = 0.6
        for w in ev.weapon_like:
            boost = 1 + (8 if w.get("kind") == "weapon_model" else 4) * float(w["score"])
            lr[ev.zone] = max(lr[ev.zone], boost)
            lr[NONE] = min(lr[NONE], 0.6)
        return lr

    def update(self, ev: Evidence) -> dict[str, float]:
        before = dict(self.p)
        lr = self.likelihoods(ev)
        r = max(0.0, min(1.0, ev.reliability))
        for k in self.p:
            self.p[k] *= lr[k] ** r  # tempered likelihood: unreliable evidence moves the belief less
        self._norm()
        if self.p[NONE] < NONE_FLOOR:
            # Keep a residual for explanations the model does not represent (drill, prank, misread motion).
            scale = (1 - NONE_FLOOR) / (1 - self.p[NONE])
            for k in self.zones:
                self.p[k] *= scale
            self.p[NONE] = NONE_FLOOR
        if r >= 0.3 and (ev.activity in {"flight", "agitated"} or ev.weapon_like):
            self.supporting += 1
        return {k: round(self.p[k] - before[k], 4) for k in self.p if abs(self.p[k] - before[k]) > 0.005}

    # --------------------------------------------------------------- summary
    @property
    def p_threat(self) -> float:
        return 1.0 - self.p[NONE]

    def conditional(self) -> dict[str, float]:
        pt = max(1e-9, self.p_threat)
        return {z: self.p[z] / pt for z in self.zones}

    def region(self) -> tuple[list[str], float]:
        """Most probable compact region (MAP zone + adjacent zones above a floor) and its conditional mass."""
        cond = self.conditional()
        members = [max(cond, key=cond.get)]
        while len(members) < 5:
            frontier = {n for m in members for n in self.b.neighbors(m)} - set(members)
            cand = max(frontier, key=lambda z: cond[z], default=None)
            if cand is None or cond[cand] < 0.05:
                break
            members.append(cand)
        mass = sum(cond[z] for z in members)
        return members, mass

    def entropy(self) -> float:
        cond = self.conditional()
        h = -sum(v * math.log(v) for v in cond.values() if v > 0)
        return h / math.log(len(cond))

    def summary(self) -> dict[str, Any]:
        region, mass = self.region()
        # A report alone can never localise a threat: at least one visual observation must support it.
        localized = self.p_threat >= 0.5 and mass >= 0.7 and self.supporting >= 1
        return {
            "p_threat": round(self.p_threat, 3),
            "p_none": round(self.p[NONE], 3),
            "zones": {z: round(self.p[z], 4) for z in self.zones},
            "conditional": {z: round(v, 4) for z, v in self.conditional().items()},
            "region": region,
            "region_mass": round(mass, 3),
            "localized": localized,
            "entropy": round(self.entropy(), 3),
            "supporting_observations": self.supporting,
        }
