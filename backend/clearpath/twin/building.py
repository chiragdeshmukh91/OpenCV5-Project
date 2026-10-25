"""School digital twin: geometry (Shapely) + connectivity graph (NetworkX) + constraint validation."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import networkx as nx
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from ..config import LAYOUT_PATH


@dataclass
class ValidationIssue:
    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    subject: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class Building:
    raw: dict[str, Any]
    zones: dict[str, dict[str, Any]] = field(default_factory=dict)
    polygons: dict[str, Polygon] = field(default_factory=dict)
    exits: dict[str, dict[str, Any]] = field(default_factory=dict)
    doors: dict[str, dict[str, Any]] = field(default_factory=dict)
    cameras: dict[str, dict[str, Any]] = field(default_factory=dict)
    graph: nx.Graph = field(default_factory=nx.Graph)

    @classmethod
    def load(cls, path: Path | str = LAYOUT_PATH) -> "Building":
        raw = json.loads(Path(path).read_text())
        b = cls(raw=raw)
        for z in raw["zones"]:
            b.zones[z["id"]] = z
            b.polygons[z["id"]] = Polygon(z["polygon"])
        b.exits = {e["id"]: e for e in raw["exits"]}
        b.doors = {d["id"]: d for d in raw["doors"]}
        b.cameras = {c["id"]: c for c in raw["cameras"]}
        b._build_graph()
        return b

    # ------------------------------------------------------------------ graph
    def centroid(self, node: str) -> tuple[float, float]:
        if node in self.polygons:
            c = self.polygons[node].centroid
            return (c.x, c.y)
        if node in self.exits:
            p = self.exits[node]["position"]
            return (float(p[0]), float(p[1]))
        raise KeyError(node)

    def _build_graph(self) -> None:
        g = nx.Graph()
        for zid, z in self.zones.items():
            g.add_node(zid, kind=z["kind"], name=z["name"], node_type="zone", pos=self.centroid(zid))
        for eid, e in self.exits.items():
            g.add_node(eid, kind="exit", name=e["name"], node_type="exit", pos=tuple(e["position"]))
        for did, d in self.doors.items():
            a, b, p = d["a"], d["b"], d["position"]
            length = math.dist(self.centroid(a), p) + math.dist(p, self.centroid(b))
            g.add_edge(a, b, door=did, width_m=d["width_m"], length=length, via=tuple(p), door_kind=d["kind"])
        for eid, e in self.exits.items():
            z = e["zone"]
            g.add_edge(z, eid, door=eid, width_m=e["width_m"], length=math.dist(self.centroid(z), e["position"]),
                       via=tuple(e["position"]), door_kind="exit")
        self.graph = g

    def neighbors(self, zone: str) -> list[str]:
        return [n for n in self.graph.neighbors(zone) if n in self.zones]

    def zones_within_hops(self, zone: str, hops: int) -> set[str]:
        lengths = nx.single_source_shortest_path_length(self.graph.subgraph(self.zones.keys()), zone, cutoff=hops)
        return set(lengths)

    def heading_between(self, a: str, b: str) -> float:
        """Map heading (deg, 0 = east, 90 = north) from centroid a to centroid b."""
        ax, ay = self.centroid(a)
        bx, by = self.centroid(b)
        return math.degrees(math.atan2(by - ay, bx - ax)) % 360

    def path_length(self, path: list[str]) -> float:
        return sum(self.graph.edges[u, v]["length"] for u, v in zip(path, path[1:]))

    def occupied_spaces(self) -> list[str]:
        return [z for z, d in self.zones.items() if d["kind"] not in {"corridor"}]

    def cameras_covering(self, zone: str) -> list[str]:
        return [cid for cid, c in self.cameras.items() if zone in c["covers"]]

    # ------------------------------------------------------------- validation
    def validate(self) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        cons = self.raw.get("constraints", {})
        tol = 0.25
        # Geometry validity and overlap.
        ids = list(self.polygons)
        for zid, poly in self.polygons.items():
            if not poly.is_valid:
                issues.append(ValidationIssue("error", "invalid_polygon", f"{zid} polygon is not valid", zid))
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                inter = self.polygons[a].intersection(self.polygons[b]).area
                if inter > 1e-6:
                    issues.append(ValidationIssue("error", "overlap", f"{a} overlaps {b} by {inter:.2f} m2", f"{a},{b}"))
        footprint = unary_union(list(self.polygons.values()))
        # Doors must lie on the shared boundary of both spaces.
        for did, d in self.doors.items():
            p = Point(d["position"])
            for side in (d["a"], d["b"]):
                if self.polygons[side].exterior.distance(p) > tol:
                    issues.append(ValidationIssue("error", "door_off_boundary", f"{did} is not on the boundary of {side}", did))
            if d["width_m"] < cons.get("min_door_width_m", 0):
                issues.append(ValidationIssue("error", "door_too_narrow", f"{did} width {d['width_m']} m < minimum", did))
        # Exits must lie on the exterior of the building footprint and on their zone boundary.
        for eid, e in self.exits.items():
            p = Point(e["position"])
            if footprint.exterior.distance(p) > tol:
                issues.append(ValidationIssue("error", "exit_not_exterior", f"{eid} is not on the building exterior", eid))
            if self.polygons[e["zone"]].exterior.distance(p) > tol:
                issues.append(ValidationIssue("error", "exit_off_zone", f"{eid} not on boundary of {e['zone']}", eid))
        # Cameras inside their zone.
        for cid, c in self.cameras.items():
            if not self.polygons[c["zone"]].buffer(tol).contains(Point(c["position"])):
                issues.append(ValidationIssue("error", "camera_outside_zone", f"{cid} not inside {c['zone']}", cid))
        # Connectivity.
        if not nx.is_connected(self.graph):
            issues.append(ValidationIssue("error", "disconnected", "Building graph is not connected"))
        # Egress constraints per occupied space.
        min_exits = cons.get("min_exits_per_occupied_space", 2)
        max_travel = cons.get("max_travel_distance_m", 1e9)
        for z in self.occupied_spaces():
            reachable = [e for e in self.exits if nx.has_path(self.graph, z, e)]
            if len(reachable) < min_exits:
                issues.append(ValidationIssue("error", "insufficient_exits", f"{z} reaches {len(reachable)} exits", z))
            if not reachable:
                continue
            d = min(nx.shortest_path_length(self.graph, z, e, weight="length") for e in reachable)
            if d > max_travel:
                issues.append(ValidationIssue("warning", "travel_distance", f"{z}: nearest exit {d:.0f} m > {max_travel:.0f} m (graph distance)", z))
        # Single points of failure: articulation points among zones.
        zone_graph = self.graph.subgraph(self.zones.keys())
        for ap in nx.articulation_points(zone_graph):
            if self.zones[ap]["kind"] == "corridor":
                issues.append(ValidationIssue("info", "articulation_point",
                                              f"{ap} is the only internal connection for part of the building", ap))
        uncovered = [z for z in self.zones if not self.cameras_covering(z) and self.zones[z]["kind"] == "corridor"]
        for z in uncovered:
            issues.append(ValidationIssue("warning", "corridor_without_camera", f"Corridor {z} has no camera coverage", z))
        return issues

    # -------------------------------------------------------------- export
    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.raw["name"],
            "units": self.raw.get("units", "meters"),
            "constraints": self.raw.get("constraints", {}),
            "zones": [
                {**z, "centroid": list(self.centroid(zid)), "area_m2": round(self.polygons[zid].area, 1)}
                for zid, z in self.zones.items()
            ],
            "exits": list(self.exits.values()),
            "doors": list(self.doors.values()),
            "cameras": list(self.cameras.values()),
            "bounds": list(unary_union(list(self.polygons.values())).bounds),
        }
