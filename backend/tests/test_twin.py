"""Digital twin: geometry, connectivity and egress-constraint validation."""
from __future__ import annotations

import json

import networkx as nx
import pytest

from clearpath.config import LAYOUT_PATH
from clearpath.twin.building import Building


def codes(issues, severity="error"):
    return {i.code for i in issues if i.severity == severity}


def test_layout_validates_with_zero_errors(building):
    issues = building.validate()
    errors = [i for i in issues if i.severity == "error"]
    assert errors == [], [e.message for e in errors]


def test_graph_connected(building):
    assert nx.is_connected(building.graph)
    assert set(building.zones) | set(building.exits) == set(building.graph.nodes)


def test_every_occupied_space_reaches_two_exits(building):
    min_exits = building.raw["constraints"]["min_exits_per_occupied_space"]
    assert min_exits >= 2
    for z in building.occupied_spaces():
        reachable = [e for e in building.exits if nx.has_path(building.graph, z, e)]
        assert len(reachable) >= min_exits, z


def test_cameras_reference_real_zones(building):
    for cid, cam in building.cameras.items():
        assert cam["zone"] in building.zones, cid
        assert all(z in building.zones for z in cam["covers"]), cid


# ----------------------------------------------------------------- deliberately broken layouts
def _broken(tmp_path, mutate) -> Building:
    raw = json.loads(LAYOUT_PATH.read_text())
    mutate(raw)
    p = tmp_path / "layout.json"
    p.write_text(json.dumps(raw))
    return Building.load(p)


def _by_id(items, id_):
    return next(x for x in items if x["id"] == id_)


def test_door_moved_off_boundary(tmp_path):
    def mutate(raw):
        _by_id(raw["doors"], "D-R101")["position"] = [7, 36]  # middle of R101, nowhere near C1
    issues = _broken(tmp_path, mutate).validate()
    off = [i for i in issues if i.code == "door_off_boundary"]
    assert off and all(i.subject == "D-R101" for i in off)
    assert any("C1" in i.message for i in off)


def test_overlapping_polygon(tmp_path):
    def mutate(raw):
        _by_id(raw["zones"], "R102")["polygon"] = [[10, 28], [30, 28], [30, 44], [10, 44]]  # 4 m into R101
    issues = _broken(tmp_path, mutate).validate()
    ov = [i for i in issues if i.code == "overlap"]
    assert len(ov) == 1
    assert set(ov[0].subject.split(",")) == {"R101", "R102"}
    assert "64.00 m2" in ov[0].message  # 4 m x 16 m


def test_room_without_door_reports_disconnected_not_crash(tmp_path):
    """Regression: validate() used to raise ValueError (min() of empty sequence) for a space with no exit."""
    def mutate(raw):
        raw["doors"] = [d for d in raw["doors"] if d["id"] != "D-R101"]
    issues = _broken(tmp_path, mutate).validate()
    errs = codes(issues)
    assert {"disconnected", "insufficient_exits"} <= errs
    assert any(i.code == "insufficient_exits" and i.subject == "R101" for i in issues)


@pytest.mark.parametrize("field,value,code", [
    ("width_m", 0.5, "door_too_narrow"),
])
def test_narrow_door(tmp_path, field, value, code):
    def mutate(raw):
        _by_id(raw["doors"], "D-R103")[field] = value
    assert code in codes(_broken(tmp_path, mutate).validate())


def test_exit_not_on_exterior(tmp_path):
    def mutate(raw):
        _by_id(raw["exits"], "EX-W")["position"] = [15, 25]  # inside corridor C1
    errs = codes(_broken(tmp_path, mutate).validate())
    assert {"exit_not_exterior", "exit_off_zone"} <= errs
