"""Threat-location belief: priors, tempered updates, NONE floor."""
from __future__ import annotations

import pytest

from clearpath.agent.perception import NONE, NONE_FLOOR, Evidence, ThreatBelief


def ev(camera_id="CAM-02", zone="C2", activity="calm", reliability=0.9, **kw) -> Evidence:
    base = dict(persons=5.0, persons_max=6, speed_bh_s=0.8, flow_speed_bh_s=0.8, running_fraction=0.0, coherence=0.3,
                flight_heading_deg=None, source_heading_deg=None, weapon_like=[], issues=[])
    base.update(kw)
    return Evidence(camera_id=camera_id, zone=zone, activity=activity, reliability=reliability, **base)


def flight(camera_id="CAM-03", zone="C3", reliability=1.0) -> Evidence:
    return ev(camera_id, zone, "flight", reliability, speed_bh_s=2.8, running_fraction=1.0, coherence=0.93,
              flight_heading_deg=180.0, source_heading_deg=0.0)


@pytest.mark.parametrize("conf", [0.05, 0.5, 0.95])
def test_report_only_prior_is_never_localized(building, conf):
    b = ThreatBelief(building)
    b.init_from_report("C3", conf)
    s = b.summary()
    assert s["supporting_observations"] == 0
    assert s["localized"] is False
    assert abs(sum(b.p.values()) - 1) < 1e-9
    assert max(s["conditional"], key=s["conditional"].get) == "C3"


def test_unusable_evidence_leaves_belief_unchanged(building):
    b = ThreatBelief(building)
    b.init_from_report("C2", 0.45)
    before = dict(b.p)
    delta = b.update(ev(activity="unusable", reliability=0.05, issues=["frozen_feed"]))
    assert delta == {}
    assert b.p == pytest.approx(before)
    assert b.supporting == 0


def test_zero_reliability_flight_has_no_effect(building):
    b = ThreatBelief(building)
    b.init_from_report("C2", 0.45)
    before = dict(b.p)
    b.update(flight(reliability=0.0))
    assert b.p == pytest.approx(before)
    assert b.supporting == 0  # unreliable evidence never counts as support


def test_calm_evidence_lowers_p_threat(building):
    b = ThreatBelief(building)
    b.init_from_report("C2", 0.35)
    p0 = b.p_threat
    b.update(ev(activity="calm"))
    p1 = b.p_threat
    b.update(ev("CAM-03", "C3", "calm"))
    assert p1 < p0 and b.p_threat < p1
    assert b.summary()["localized"] is False


def test_flight_raises_and_localizes(building):
    b = ThreatBelief(building)
    b.init_from_report("C3", 0.5)
    b.update(flight())
    s = b.summary()
    assert s["supporting_observations"] == 1
    assert s["p_threat"] > 0.5
    assert s["region"][0] == "C3"


def test_none_floor_respected(building):
    b = ThreatBelief(building)
    b.init_from_report("C3", 0.95)
    for _ in range(12):
        b.update(flight())
        assert b.p[NONE] >= NONE_FLOOR - 1e-12
        assert abs(sum(b.p.values()) - 1) < 1e-9
    assert b.p[NONE] == pytest.approx(NONE_FLOOR)
    assert b.p_threat == pytest.approx(1 - NONE_FLOOR)
