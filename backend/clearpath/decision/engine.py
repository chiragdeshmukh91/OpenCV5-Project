"""Decision-support engine: evaluates predefined response procedures against the current simulated
scenario and building state.

Two separate questions are always answered separately:
  * Mathematical route validity - graph/geometry constraints (connectivity, exclusion zone avoided,
    door widths, configured travel distance). A route can be valid on paper and still be unsafe.
  * Operational safety - probability-weighted hazard exposure, fraction of the route verified by a
    recent, reliable camera observation, congestion and sensor faults on the route.

Procedures follow the action vocabulary of the Standard Response Protocol widely used by US schools
(Hold, Secure, Lockdown, Evacuate, Shelter) plus a hybrid Lockdown + targeted Evacuate. The engine
recommends; it never acts. Every consequential option requires human approval.
"""
from __future__ import annotations

from typing import Any

import networkx as nx

from ..agent.perception import Evidence
from ..twin.building import Building

PROCEDURES = {
    "HOLD": "Hold in rooms; keep hallways clear while the situation is verified.",
    "SECURE": "Secure the perimeter; bring people inside (hazard outside the building).",
    "LOCKDOWN": "Lock doors, lights off, out of sight; building-wide.",
    "LOCKDOWN_PLUS_EVACUATE": "Lockdown spaces in/near the probable threat region; evacuate distant spaces via verified routes.",
    "EVACUATE": "Evacuate the whole building via assigned routes.",
    "SHELTER": "Shelter for a specific hazard (weather, hazmat).",
}
HOLD_MAX_P = 0.15
VERIFIED_MIN = 0.7
EXPOSURE_MAX = 0.1


def _route_zone_sequence(path: list[str], b: Building) -> list[str]:
    return [n for n in path if n in b.zones]


def compute_routes(b: Building, belief: dict[str, Any], evidence: dict[str, Evidence],
                   reviewer_constraints: dict[str, Any] | None = None) -> dict[str, Any]:
    cons = b.raw.get("constraints", {})
    reviewer_constraints = reviewer_constraints or {}
    pz = belief["zones"]
    if belief["localized"]:
        hazard = set(belief["region"])
    else:
        hazard = {z for z, p in pz.items() if p >= cons.get("hazard_exclusion_probability", 0.2)}
    exclusion = set(hazard)
    for _ in range(int(cons.get("hazard_buffer_hops", 1))):
        exclusion |= {n for z in list(exclusion) for n in b.neighbors(z)}
    # Corridors are only excluded if they are hazard zones themselves or immediately adjacent to a
    # hazard corridor; rooms adjacent to a hazard corridor stay in lockdown.
    blocked_exits = {e for e, d in b.exits.items() if d["zone"] in exclusion}
    blocked_exits |= set(reviewer_constraints.get("blocked_exits", []))
    zone_obs = {ev.zone: ev for ev in evidence.values()}

    usable = b.graph.copy()
    usable.remove_nodes_from([z for z in exclusion])
    usable.remove_nodes_from([e for e in blocked_exits if e in usable])

    routes = []
    lockdown_spaces = sorted(z for z in b.occupied_spaces() if z in exclusion)
    candidates = [z for z in b.occupied_spaces() if z not in exclusion]
    for s in candidates:
        options = []
        for e in b.exits:
            if e in blocked_exits or e not in usable or not nx.has_path(usable, s, e):
                continue
            path = nx.shortest_path(usable, s, e, weight="length")
            options.append(_assess_route(b, path, pz, zone_obs, cons, exclusion))
        if not options:
            routes.append({"id": f"{s}->none", "from": s, "exit": None, "path": [], "math_valid": False,
                           "math_checks": {"connected": False}, "operational_status": "no_route", "safe": False,
                           "reason": "No exit reachable without entering the exclusion zone"})
            continue
        options.sort(key=lambda r: (not r["safe"], not r["math_valid"], r["operational"]["hazard_exposure"],
                                    -r["operational"]["verified_fraction"], r["length_m"]))
        best = options[0]
        best["alternatives"] = [{"exit": o["exit"], "status": o["operational_status"], "length_m": o["length_m"]}
                                for o in options[1:4]]
        routes.append(best)
    return {"hazard_zones": sorted(hazard), "exclusion_zones": sorted(exclusion), "blocked_exits": sorted(blocked_exits),
            "lockdown_spaces": lockdown_spaces, "routes": routes}


def _assess_route(b: Building, path: list[str], pz: dict[str, float], zone_obs: dict[str, Evidence],
                  cons: dict[str, Any], exclusion: set[str]) -> dict[str, Any]:
    zones = _route_zone_sequence(path, b)
    length = b.path_length(path)
    widths = [b.graph.edges[u, v]["width_m"] for u, v in zip(path, path[1:])]
    checks = {
        "connected": True,
        "avoids_exclusion_zone": not any(z in exclusion for z in zones),
        "door_widths_ok": min(widths) >= cons.get("min_door_width_m", 0.0),
        "travel_distance_ok": length <= cons.get("max_travel_distance_m", 1e9),
    }
    transit = [z for z in zones[1:] if b.zones[z]["kind"] in {"corridor", "lobby", "cafeteria", "gym", "library"}]
    # Probability-weighted exposure: zones on the route count fully, zones adjacent to it count half.
    adjacent = {n for z in zones for n in b.neighbors(z)} - set(zones)
    exposure = max([pz.get(z, 0.0) for z in zones] + [0.5 * pz.get(z, 0.0) for z in adjacent] + [0.0])
    verified, unverified, congested, faulted = [], [], [], []
    for z in transit:
        ev = zone_obs.get(z)
        if ev is None:
            unverified.append(z)
        elif ev.activity == "unusable":
            faulted.append(z)
        elif ev.activity == "congested":
            congested.append(z)
        elif ev.activity in {"calm", "empty"} and ev.reliability >= 0.5:
            verified.append(z)
        else:
            unverified.append(z)
    vf = len(verified) / len(transit) if transit else 1.0
    if not all(checks.values()):
        status = "invalid"
    elif exposure >= EXPOSURE_MAX:
        status = "exposed"
    elif congested:
        status = "congested"
    elif faulted or vf < VERIFIED_MIN:
        status = "unverified"
    else:
        status = "verified_clear"
    return {
        "id": f"{path[0]}->{path[-1]}", "from": path[0], "exit": path[-1], "path": path, "length_m": round(length, 1),
        "math_valid": all(checks.values()), "math_checks": checks,
        "operational": {"hazard_exposure": round(exposure, 3), "verified_fraction": round(vf, 2), "verified_zones": verified,
                        "unverified_zones": unverified, "congested_zones": congested, "faulted_zones": faulted},
        "operational_status": status, "safe": status == "verified_clear",
    }


def assess_options(b: Building, belief: dict[str, Any], routing: dict[str, Any], gaps: list[dict],
                   rejected: set[str] | None = None) -> dict[str, Any]:
    rejected = rejected or set()
    p = belief["p_threat"]
    localized = belief["localized"]
    routes = routing["routes"]
    safe_routes = [r for r in routes if r["safe"]]
    evac_candidates = [r["from"] for r in routes]
    n_occupied = len(b.occupied_spaces())
    opts: list[dict[str, Any]] = []

    def option(oid: str, pre: list[tuple[str, bool, str]], score: float, actions: list[str], risks: list[str],
               spaces: dict[str, list[str]] | None = None, route_ids: list[str] | None = None) -> None:
        feasible = all(ok for _, ok, _ in pre) and oid not in rejected
        opts.append({"id": oid, "description": PROCEDURES[oid], "preconditions": [
            {"check": c, "pass": ok, "detail": d} for c, ok, d in pre],
            "feasible": feasible, "rejected_by_reviewer": oid in rejected,
            "score": round(score if feasible else 0.0, 3), "raw_score": round(score, 3), "actions": actions,
            "risks": risks, "spaces": spaces or {}, "routes": route_ids or [], "requires_human_approval": True})

    option("HOLD", [("threat probability below hold threshold", p < HOLD_MAX_P, f"P(threat)={p:.2f}, threshold {HOLD_MAX_P}")],
           0.9 - p, ["Hold in classrooms; keep hallways clear", "Dispatch SRO/administrator to verify the report in person",
                     "Re-assess on any new evidence"],
           ["If the report is true and visual coverage missed it, people remain in rooms (lower exposure than hallways)."])
    option("SECURE", [("hazard assessed outside the building", False,
                       "No evidence places the hazard outside; exterior cameras are not modelled")],
           0.2, ["Lock exterior doors; bring people inside"], ["Not applicable to an interior threat"])
    option("LOCKDOWN", [("threat probability at or above hold threshold", p >= HOLD_MAX_P, f"P(threat)={p:.2f}")],
           0.55 + 0.35 * (1 - belief["region_mass"]) + (0.1 if gaps else 0.0) if not localized else 0.6,
           ["Lock and barricade doors in all spaces; lights off; out of sight", "Clear hallways",
            "Law enforcement handles movement of occupants"],
           ["Occupants near the threat cannot move away", "Does not use verified-clear routes that may exist"],
           {"lockdown": b.occupied_spaces()})
    hybrid_pre = [
        ("threat localised (region mass >= 0.70)", localized, f"region {belief['region']} mass {belief['region_mass']:.2f}"),
        ("threat corroborated (P >= 0.5)", p >= 0.5, f"P(threat)={p:.2f}"),
        ("at least one operationally verified route", len(safe_routes) > 0, f"{len(safe_routes)} verified-clear route(s)"),
    ]
    frac_safe = len(safe_routes) / max(1, len(evac_candidates))
    option("LOCKDOWN_PLUS_EVACUATE", hybrid_pre, 0.65 + 0.3 * frac_safe,
           [f"Lockdown: {', '.join(routing['lockdown_spaces']) or 'none'}"]
           + [f"Evacuate {r['from']} via {' > '.join(r['path'][1:])}" for r in safe_routes]
           + [f"Hold in place (route not verified): {r['from']} ({r['operational_status']})" for r in routes if not r["safe"]],
           ["Belief could be wrong: evacuees could move toward an unobserved second threat",
            "Routes are verified only by cameras at the time of analysis; conditions change"],
           {"lockdown": routing["lockdown_spaces"], "evacuate": [r["from"] for r in safe_routes],
            "hold": [r["from"] for r in routes if not r["safe"]]}, [r["id"] for r in safe_routes])
    all_safe = len(safe_routes) == n_occupied
    option("EVACUATE", [
        ("threat localised", localized, f"region mass {belief['region_mass']:.2f}"),
        ("every occupied space has a verified route", all_safe,
         f"{len(safe_routes)}/{n_occupied} spaces; {len(routing['lockdown_spaces'])} inside the exclusion zone")],
           0.7, ["Evacuate all spaces via assigned routes"],
           ["Moves people through hallways during an active threat"], {"evacuate": b.occupied_spaces()})
    option("SHELTER", [("hazard is weather/hazmat", False, "Not applicable to an active-threat scenario")], 0.1,
           ["Shelter for the specific hazard"], ["Wrong procedure for this hazard type"])

    feasible = [o for o in opts if o["feasible"]]
    no_alternative = False
    if feasible:
        rec = max(feasible, key=lambda o: o["score"])
    else:
        # Nothing feasible is left (typically: the reviewer rejected the only option whose preconditions hold).
        # Fall back to the evidence-supported baseline, and say so explicitly instead of silently re-proposing it.
        fallback = "LOCKDOWN" if p >= HOLD_MAX_P else "HOLD"
        rec = next(o for o in opts if o["id"] == fallback)
        no_alternative = True
    why_not_evac = next(o for o in opts if o["id"] == "EVACUATE")
    uncertainty = [
        f"P(active threat) = {p:.2f} (P(no threat) = {belief['p_none']:.2f}).",
        (f"Location: region {', '.join(belief['region'])} holds {belief['region_mass']:.0%} of the conditional probability; "
         f"normalised entropy {belief['entropy']:.2f}.") if p >= HOLD_MAX_P else "Location is not meaningful at this threat level.",
        "Route validity is a graph property; operational safety additionally requires recent, reliable camera verification.",
    ] + [f"Coverage gap: {g['camera_id']} ({', '.join(g['issues']) or g['reason']}) — zone {g['zone']} is unobserved." for g in gaps]
    if no_alternative:
        uncertainty.insert(0, f"No other procedure's preconditions hold; {rec['id']} remains the only evidence-supported "
                              f"option{' although the reviewer rejected it' if rec['id'] in rejected else ''}. "
                              f"The reviewer can approve it, request more evidence, or cancel the run.")
    return {"options": opts, "recommended": rec["id"], "uncertainty": uncertainty,
            "no_feasible_alternative": no_alternative,
            "why_not_full_evacuation": [pc["detail"] for pc in why_not_evac["preconditions"] if not pc["pass"]]}
