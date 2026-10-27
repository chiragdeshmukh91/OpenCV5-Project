"""Decision engine on synthetic beliefs and hand-built evidence.

Mathematical route validity (graph constraints) and operational safety (camera-verified, unexposed, uncongested)
are separate questions; these tests pin that separation down."""
from __future__ import annotations

from clearpath.agent.perception import Evidence
from clearpath.decision.engine import HOLD_MAX_P, assess_options, compute_routes


def make_belief(building, p_threat: float, region: list[str] | None = None, localized: bool = False,
                region_mass: float = 0.9) -> dict:
    zones = {z: 0.0 for z in building.zones}
    if region:
        w = [0.6] + [0.4 / max(1, len(region) - 1)] * (len(region) - 1)
        for z, wi in zip(region, w):
            zones[z] = p_threat * wi * (region_mass if len(region) > 1 else 1.0)
    else:
        for z in zones:
            zones[z] = p_threat / len(zones)
    return {"p_threat": p_threat, "p_none": 1 - p_threat, "zones": zones, "region": region or [max(zones, key=zones.get)],
            "region_mass": region_mass if region else 0.2, "localized": localized, "entropy": 0.5,
            "supporting_observations": 1 if localized else 0}


def obs(zone: str, activity: str = "calm", reliability: float = 0.9) -> Evidence:
    return Evidence(camera_id=f"TEST-{zone}", zone=zone, activity=activity, reliability=reliability, persons=3,
                    persons_max=4, speed_bh_s=0.8, flow_speed_bh_s=0.8, running_fraction=0.0, coherence=0.2,
                    flight_heading_deg=None, source_heading_deg=None, weapon_like=[], issues=[])


def evidence(*items: Evidence) -> dict[str, Evidence]:
    return {e.camera_id: e for e in items}


WEST = ["C1", "R101", "R104"]
CLEAR_EAST_AND_NORTH = ("C3", "C4", "GYM", "LIB", "LOBBY", "CAF")


def opt(assessment, oid):
    return next(o for o in assessment["options"] if o["id"] == oid)


def run(building, belief, ev, gaps=None, rejected=None, constraints=None):
    routing = compute_routes(building, belief, ev, constraints)
    return routing, assess_options(building, belief, routing, gaps or [], rejected)


def test_hold_when_p_below_threshold(building):
    belief = make_belief(building, 0.08)
    assert belief["p_threat"] < HOLD_MAX_P
    _, a = run(building, belief, {})
    assert a["recommended"] == "HOLD"
    assert not opt(a, "LOCKDOWN")["feasible"]


def test_lockdown_when_not_localized(building):
    belief = make_belief(building, 0.45, region=["C2", "LIB", "C4"], localized=False, region_mass=0.5)
    ev = evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH))
    _, a = run(building, belief, ev)
    assert a["recommended"] == "LOCKDOWN"
    assert not opt(a, "LOCKDOWN_PLUS_EVACUATE")["feasible"]
    assert not opt(a, "HOLD")["feasible"]


def test_hybrid_only_when_localized_and_verified_route(building):
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    # A space whose own exterior door is its exit (CAF, GYM, LOBBY) has no transit zones, so the engine treats that
    # route as verified without a camera. Block those doors to get the "nothing camera-verified" case:
    # localised, but no operationally safe route -> hybrid infeasible.
    direct = {"blocked_exits": ["EX-CAF", "EX-GYM", "EX-S"]}
    routing, a = run(building, belief, {}, constraints=direct)
    assert not any(r["safe"] for r in routing["routes"])
    assert any(r["math_valid"] for r in routing["routes"])  # valid on paper, still not safe
    assert not opt(a, "LOCKDOWN_PLUS_EVACUATE")["feasible"]
    assert a["recommended"] == "LOCKDOWN"
    # Same belief with calm, reliable observations along the eastern corridors -> verified routes -> hybrid.
    routing, a = run(building, belief, evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH)))
    safe = [r for r in routing["routes"] if r["safe"]]
    assert safe
    assert a["recommended"] == "LOCKDOWN_PLUS_EVACUATE"
    hybrid = opt(a, "LOCKDOWN_PLUS_EVACUATE")
    assert set(hybrid["spaces"]["lockdown"]) >= {"R101", "R104"}
    assert all(r["exit"] != "EX-W" for r in safe)  # the exit inside the threat region is never used
    assert hybrid["requires_human_approval"]


def test_unreliable_observation_does_not_verify(building):
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    routing, _ = run(building, belief, evidence(*(obs(z, reliability=0.3) for z in CLEAR_EAST_AND_NORTH)),
                     constraints={"blocked_exits": ["EX-CAF", "EX-GYM", "EX-S"]})
    assert not any(r["safe"] for r in routing["routes"])
    assert any(r["operational_status"] == "unverified" for r in routing["routes"])


def test_congested_route_is_valid_but_not_safe(building):
    """Mathematical validity vs operational safety: R103 can only leave via the East Hall (C3); C3 is congested."""
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    ev = evidence(*(obs(z) for z in ("C4", "GYM", "LIB", "LOBBY", "CAF")), obs("C3", "congested", 0.9))
    routing, a = run(building, belief, ev)
    r103 = next(r for r in routing["routes"] if r["from"] == "R103")
    assert r103["math_valid"] is True
    assert all(r103["math_checks"].values())
    assert r103["safe"] is False
    assert r103["operational_status"] == "congested"
    assert "C3" in r103["operational"]["congested_zones"]
    hybrid = opt(a, "LOCKDOWN_PLUS_EVACUATE")
    assert "R103" in hybrid["spaces"]["hold"] and "R103" not in hybrid["spaces"]["evacuate"]


def test_faulted_camera_route_not_safe(building):
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    ev = evidence(*(obs(z) for z in ("C3", "GYM", "LIB", "LOBBY", "CAF")), obs("C4", "unusable", 0.05))
    routing, _ = run(building, belief, ev)
    via_c4 = [r for r in routing["routes"] if "C4" in r["path"][1:]]
    assert via_c4, "expected at least one best route through C4"
    for r in via_c4:
        assert r["math_valid"] and not r["safe"] and "C4" in r["operational"]["faulted_zones"]


def test_evacuate_infeasible_when_spaces_inside_exclusion(building):
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    ev = evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH))
    routing, a = run(building, belief, ev)
    assert {"R101", "R104"} <= set(routing["lockdown_spaces"])
    assert {"C1", "C2"} <= set(routing["exclusion_zones"])  # region + 1 hop buffer
    assert "EX-W" in routing["blocked_exits"]
    evac = opt(a, "EVACUATE")
    assert evac["feasible"] is False
    failed = [p for p in evac["preconditions"] if not p["pass"]]
    assert failed and "inside the exclusion zone" in failed[0]["detail"]
    assert a["why_not_full_evacuation"]


def test_rejected_option_is_never_recommended(building):
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    _, a = run(building, belief, evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH)), rejected={"LOCKDOWN_PLUS_EVACUATE"})
    assert a["recommended"] == "LOCKDOWN"
    assert opt(a, "LOCKDOWN_PLUS_EVACUATE")["rejected_by_reviewer"]


def test_reviewer_blocked_exit_removed_from_routes(building):
    belief = make_belief(building, 0.92, region=WEST, localized=True)
    ev = evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH))
    routing = compute_routes(building, belief, ev, {"blocked_exits": ["EX-S"]})
    assert "EX-S" in routing["blocked_exits"]
    assert all(r["exit"] != "EX-S" and "EX-S" not in r["path"] for r in routing["routes"])


def test_rejecting_the_only_feasible_option_is_flagged_not_silently_reproposed(building):
    """Regression: rejecting HOLD (or LOCKDOWN) when nothing else is feasible used to re-recommend it with no notice."""
    belief = make_belief(building, 0.05, region=WEST, localized=False)
    _, a = run(building, belief, evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH)), rejected={"HOLD"})
    assert a["recommended"] == "HOLD"
    assert a["no_feasible_alternative"] is True
    assert "only evidence-supported option" in a["uncertainty"][0] and "rejected" in a["uncertainty"][0]
    _, b = run(building, belief, evidence(*(obs(z) for z in CLEAR_EAST_AND_NORTH)))
    assert b["no_feasible_alternative"] is False
