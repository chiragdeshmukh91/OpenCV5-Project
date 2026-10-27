"""CLEARPATH agent: an explicit perception -> decision -> action state machine.

Every step is recorded in the trace with the tool called, its arguments, a result summary, the state
changes it caused and the reason the agent chose it. OpenCV output changes what the agent does next:
  * which camera is analysed next (expected information about the threat location / route safety),
  * whether a camera is re-analysed with different OpenCV parameters (dehaze for haze, denser
    detection when the tracking and optical-flow estimates disagree, persistence check for weapon-like
    objects),
  * whether a camera is declared faulted (frozen / obstructed) and treated as a coverage gap,
  * when to stop gathering evidence, which response procedure to recommend, and what to ask a human.
The agent never executes a response. Consequential decisions always pause for human review, and all
actions are simulated.
"""
from __future__ import annotations

import base64
import json
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable

from .. import aws
from ..config import DATA_DIR, FOOTAGE_DIR, SCENARIOS_PATH, settings
from ..decision.engine import HOLD_MAX_P, assess_options, compute_routes
from ..twin.building import Building
from ..vision.client import VisionClient, VisionError
from .location import assess_location, confirm_location, dismiss_location
from .perception import ACTIVITY_LABELS, Evidence, ThreatBelief, interpret

TRANSIT_KINDS = {"corridor", "lobby", "cafeteria", "gym", "library"}
CANDIDATE_ACTIVITIES = {"flight", "agitated"}
OBSERVATION_ACTIONS = {"confirm_observation", "dismiss_observation"}


def load_scenarios() -> dict[str, Any]:
    return json.loads(Path(SCENARIOS_PATH).read_text())


def footage_manifest() -> dict[str, Any]:
    p = FOOTAGE_DIR / "manifest.json"
    return json.loads(p.read_text()) if p.exists() else {"clips": {}}


class Run:
    """One agent execution over one scenario."""

    def __init__(self, building: Building, scenario: dict, vision: VisionClient,
                 overrides: dict[str, str] | None = None, step_delay: float | None = None):
        self.id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        self.b = building
        self.scenario = deepcopy(scenario)
        self.camera_clips = {**scenario["cameras"], **(overrides or {})}
        self.vision = vision
        self.belief = ThreatBelief(building)
        self.lock = threading.RLock()
        self.review_event = threading.Event()
        self.review_input: dict | None = None
        self.cancelled = False
        self.step_delay = settings.agent_step_delay_s if step_delay is None else step_delay
        self.media_dir = DATA_DIR / "runs" / self.id
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.evidence: dict[str, Evidence] = {}  # evidence APPLIED to the belief (location verified or confirmed)
        self.pending: dict[str, Evidence] = {}  # observations whose location is unknown, awaiting a human
        self.visited: set[str] = set()
        self.faulted: dict[str, list[str]] = {}
        self.followups: list[dict] = []
        self.rejected: set[str] = set()
        self.reviewer_constraints: dict[str, Any] = {}
        self.extra_budget = 0
        self.state: dict[str, Any] = {
            "run_id": self.id, "scenario": {k: self.scenario[k] for k in ("id", "title", "summary", "trigger", "expected")},
            "camera_clips": self.camera_clips, "status": "running", "phase": "INITIALIZING", "step": 0,
            "started_at": time.time(), "finished_at": None, "simulation": True, "trace": [], "cameras": {},
            "zones": {}, "belief": None, "belief_history": [], "routing": None, "assessment": None, "review": None,
            "review_history": [], "analyses": {}, "observations": {}, "gaps": [], "verification_tasks": [], "action_log": [],
            "metrics": {"vision_calls": 0, "vision_ms": 0.0, "reanalyses": 0, "faults": 0}, "error": None,
        }
        for cid, cam in building.cameras.items():
            self.state["cameras"][cid] = {"id": cid, "zone": cam["zone"], "clip": self.camera_clips.get(cid),
                                          "status": "idle", "activity": None, "reliability": None, "analysis_id": None}
        for zid in building.zones:
            self.state["zones"][zid] = {"id": zid, "observed": "unobserved", "p_threat": 0.0, "persons": None,
                                        "last_camera": None, "status": "normal"}

    # ------------------------------------------------------------------ utilities
    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return deepcopy(self.state)

    def _trace(self, phase: str, kind: str, title: str, *, detail: str = "", reason: str = "", tool: dict | None = None,
               changes: list[str] | None = None, data: dict | None = None) -> None:
        with self.lock:
            self.state["step"] += 1
            self.state["phase"] = phase
            self.state["trace"].append({"step": self.state["step"], "t": round(time.time() - self.state["started_at"], 2),
                                        "phase": phase, "kind": kind, "title": title, "detail": detail, "reason": reason,
                                        "tool": tool, "changes": changes or [], "data": data or {}})
        if self.step_delay:
            time.sleep(self.step_delay)

    def _tool(self, name: str, args: dict, fn: Callable[[], Any]) -> tuple[Any, dict]:
        t0 = time.perf_counter()
        out = fn()
        return out, {"name": name, "args": args, "duration_ms": round((time.perf_counter() - t0) * 1000, 1)}

    def _publish_belief(self) -> dict[str, Any]:
        s = self.belief.summary()
        with self.lock:
            self.state["belief"] = s
            self.state["belief_history"].append({"step": self.state["step"], "p_threat": s["p_threat"],
                                                 "region_mass": s["region_mass"], "entropy": s["entropy"]})
            for z, p in s["zones"].items():
                self.state["zones"][z]["p_threat"] = p
        return s

    # ------------------------------------------------------------------ main loop
    def run(self) -> None:
        try:
            self._initialize()
            while not self.cancelled:
                self._gather_evidence()
                if self.cancelled:
                    break
                self._assess()
                decision = self._await_review()
                if decision is None or decision == "done":
                    break
            if self.cancelled:
                with self.lock:
                    self.state["status"] = "cancelled"
        except Exception as e:  # surface failures in the UI instead of dying silently
            with self.lock:
                self.state["status"] = "error"
                self.state["error"] = f"{type(e).__name__}: {e}"
            self._trace("ERROR", "error", "Agent stopped on an unexpected error", detail=str(e))
        finally:
            with self.lock:
                self.state["finished_at"] = time.time()
            uri = aws.put_json(f"runs/{self.id}.json", self._export())
            if uri:
                self._trace("ARCHIVE", "tool_call", "Run archived to S3", tool={"name": "s3.put_object", "args": {"key": f"runs/{self.id}.json"}},
                            detail=uri)

    def _export(self) -> dict:
        s = self.snapshot()
        for a in s["analyses"].values():
            a.pop("per_frame", None)
        return s

    def _initialize(self) -> None:
        trig = self.scenario["trigger"]
        self._trace("PERCEIVE", "observation", f"Simulated trigger received: {trig['claim']}",
                    detail=f"Source: {trig['source']}. Stated zone: {trig['zone']} ({self.b.zones[trig['zone']]['name']}). "
                           f"Prior confidence assigned to the report: {trig['confidence']:.2f}.",
                    reason="Every run starts from a simulated report; reports alone are treated as unverified.")
        issues, tool = self._tool("twin.validate_building", {}, self.b.validate)
        errors = [i for i in issues if i.severity == "error"]
        self._trace("VALIDATE", "validation", "Digital twin validated" if not errors else "Digital twin has errors",
                    tool={**tool, "result": f"{len(errors)} errors, {len(issues) - len(errors)} warnings/info"},
                    detail="; ".join(i.message for i in issues[:6]),
                    reason="Routes are only meaningful on a connected, constraint-consistent building model.")
        if errors:
            raise RuntimeError("Building model invalid: " + "; ".join(i.message for i in errors))
        self.belief.init_from_report(trig["zone"], trig["confidence"])
        s = self._publish_belief()
        self._trace("DECIDE", "state_change", "Threat-location prior initialised from the report",
                    detail=f"P(threat) = {s['p_threat']:.2f}; mass concentrated on {trig['zone']} and adjacent zones.",
                    reason="A report is weak evidence: it sets a prior, not a conclusion.",
                    changes=[f"belief.p_threat: 0 -> {s['p_threat']:.2f}"])

    # ------------------------------------------------------------------ planning
    def _camera_scores(self) -> list[tuple[float, str, str]]:
        s = self.belief.summary()
        cond, pt = s["conditional"], s["p_threat"]
        region = set(s["region"])
        excluded_like = {z for z, v in cond.items() if v >= 0.1}
        if s["localized"]:
            excluded_like |= region | {n for z in region for n in self.b.neighbors(z)}
        phase = "localize"
        if self.extra_budget:
            phase = "extra"
        elif s["localized"]:
            supporting = [e for e in self.evidence.values() if e.activity in {"flight", "agitated"} or e.weapon_like]
            phase = "corroborate" if len(supporting) < 2 else "verify_routes"
        out = []
        for cid, cam in self.b.cameras.items():
            if cid in self.visited or not self.camera_clips.get(cid):
                continue
            z = cam["zone"]
            near = set(self.b.neighbors(z))
            info = pt * (cond[z] + 0.35 * sum(cond[n] for n in near))
            route_val = 0.0
            if pt >= 0.3 and self.b.zones[z]["kind"] in TRANSIT_KINDS and z not in excluded_like:
                route_val = 0.25
            if phase == "extra":
                score = info + route_val + 0.05
                why = "additional evidence requested by the reviewer"
            elif phase == "localize":
                score = info + 0.5 * route_val
                why = f"expected information on threat location {info:.2f}"
                if (1 - pt) > 0.5:
                    score += 0.15 * (cond[z] + 0.35 * sum(cond[n] for n in near))
            elif phase == "corroborate":
                if not ({z} | near) & region:
                    continue
                score = info + 0.1
                why = "independent corroboration of the provisional threat region"
            else:
                if route_val == 0.0:
                    continue
                score = route_val + 0.1 * (1 - cond[z])
                why = f"verifying a candidate evacuation corridor ({z}) far from the probable threat"
            out.append((score, cid, why))
        out.sort(reverse=True)
        return out

    def _should_stop(self) -> str | None:
        s = self.belief.summary()
        usable = [e for e in self.evidence.values() if e.activity != "unusable"]
        trig_zone = self.scenario["trigger"]["zone"]
        trig_area = {trig_zone} | set(self.b.neighbors(trig_zone))
        trig_observed = any(e.zone in trig_area for e in usable)
        limit = settings.agent_max_steps + self.extra_budget
        if len(self.visited) + self.state["metrics"]["reanalyses"] >= limit:
            return "evidence budget exhausted"
        if self.extra_budget:
            return None if self._camera_scores() else "all cameras analysed"
        if s["p_threat"] < HOLD_MAX_P * 0.8 and len(usable) >= 3 and trig_observed:
            return f"report not corroborated: P(threat) fell to {s['p_threat']:.2f} after {len(usable)} usable observations"
        if not self._camera_scores():
            if s["localized"]:
                return "threat localised and all candidate evacuation corridors with cameras have been checked"
            return "no further camera can add information"
        return None

    # ------------------------------------------------------------------ evidence loop
    def _gather_evidence(self) -> None:
        while not self.cancelled:
            if self.followups:
                fu = self.followups.pop(0)
                self._analyze(fu["camera_id"], fu["enhance"], fu["detect_every"], fu["reason"], fu.get("conf"), fu)
                continue
            stop = self._should_stop()
            if stop:
                self._trace("DECIDE", "decision", "Stop gathering evidence", reason=stop,
                            detail=f"{len(self.visited)} cameras analysed, {self.state['metrics']['reanalyses']} re-analyses, "
                                   f"{len(self.faulted)} faulted.")
                return
            score, cid, why = self._camera_scores()[0]
            alts = ", ".join(f"{c} ({sc:.2f})" for sc, c, _ in self._camera_scores()[1:4])
            self._trace("DECIDE", "decision", f"Next: analyse {cid} ({self.b.cameras[cid]['name']})",
                        reason=f"Highest value {score:.2f}: {why}.", detail=f"Alternatives: {alts or 'none'}")
            self._analyze(cid, "none", 4, why)

    def _store_analysis(self, cid: str, result: dict) -> str:
        aid = f"{cid}-{len(self.state['analyses']) + 1:02d}"
        adir = self.media_dir / aid
        adir.mkdir(parents=True, exist_ok=True)
        urls = []
        for i, b64 in enumerate(result.pop("frames_jpeg_b64", [])):
            (adir / f"f{i:03d}.jpg").write_bytes(base64.b64decode(b64))
            urls.append(f"/media/runs/{self.id}/{aid}/f{i:03d}.jpg")
        manifest = footage_manifest()["clips"].get(result.get("clip_id", ""), None)
        summary = {k: result[k] for k in ("frames_analyzed", "fps", "frame_size", "preview_width", "params", "quality",
                                          "persons", "motion", "weapon_like", "weapon_model", "detector", "timings", "key_frame",
                                          "per_frame") if k in result}
        summary.update({"analysis_id": aid, "camera_id": cid, "clip_id": result.get("clip_id"), "frame_urls": urls,
                        "service": result.get("service", {}), "synthetic": manifest is not None,
                        "footage_source": manifest["source"] if manifest else "user-provided footage"})
        with self.lock:
            self.state["analyses"][aid] = summary
            self.state["metrics"]["vision_calls"] += 1
            self.state["metrics"]["vision_ms"] += result["timings"]["total_ms"]
        result["analysis_id"] = aid
        return aid

    def _analyze(self, cid: str, enhance: str, detect_every: int, why: str, conf: float | None = None,
                 followup: dict | None = None) -> None:
        cam = self.b.cameras[cid]
        clip = self.camera_clips[cid]
        with self.lock:
            self.state["cameras"][cid]["status"] = "analyzing"
        args = {"camera_id": cid, "clip_id": clip, "enhance": enhance, "detect_every": detect_every}
        if conf:
            args["conf"] = conf
        try:
            result, tool = self._tool("vision.analyze_camera", args,
                                      lambda: self.vision.analyze(clip, enhance=enhance, detect_every=detect_every, conf=conf))
        except VisionError as e:
            self.visited.add(cid)
            self._fault(cid, ["vision_service_error"], f"Vision tool failed: {e}")
            return
        aid = self._store_analysis(cid, result)
        ev = interpret(result, {**cam, "id": cid})
        ev.analysis_id = aid
        q, m, p = result["quality"], result["motion"], result["persons"]
        tool["result"] = (f"{p['count_median']:.0f} people (max {p['count_max']}), speed {m['speed_bh_s_median']} BH/s, "
                          f"running {m['running_fraction']:.0%}, coherence {m['coherence']:.2f}, reliability {q['reliability']:.2f}")
        tool["service"] = result.get("service", {})
        if followup:
            self.state["metrics"]["reanalyses"] += 1
        self._trace("PERCEIVE", "tool_call", f"OpenCV analysis of {cid}" + (f" ({enhance}, every {detect_every} frames)" if followup else ""),
                    tool=tool, reason=why,
                    detail=f"Activity: {ACTIVITY_LABELS[ev.activity]}. Quality issues: {', '.join(q['issues']) or 'none'}. "
                           f"Timings: total {result['timings']['total_ms']:.0f} ms, DNN {result['timings']['detect_ms']:.0f} ms, "
                           f"flow {result['timings']['flow_ms']:.0f} ms.",
                    data={"analysis_id": aid, "camera_id": cid})
        self.visited.add(cid)
        if followup:
            ev = self._merge_followup(followup, ev)
            if ev is None:
                return
        else:
            if self._plan_followup(cid, ev, result):
                with self.lock:
                    self.state["cameras"][cid].update(status="fault" if cid in self.faulted else "pending_recheck",
                                                      analysis_id=aid, activity=ev.activity,
                                                      reliability=ev.reliability)
                return
        self._record_observation(ev, result)

    # ---------------------------------------------------------------- observation -> location -> belief
    def _record_observation(self, ev: Evidence, result: dict) -> None:
        """Attach a location to the observation. Only a verified location is applied to the belief/twin;
        an unknown location is kept as a pending observation for human review (never silently dropped)."""
        cam = {**self.b.cameras[ev.camera_id], "id": ev.camera_id}
        clip = self.camera_clips.get(ev.camera_id)
        meta = footage_manifest()["clips"].get(clip or "", None)
        ev.location = assess_location(cam, clip, meta)
        candidate = ev.activity in CANDIDATE_ACTIVITIES or bool(ev.weapon_like)
        m = result.get("motion", {})
        running = [t for t in m.get("tracks_detail", []) if t.get("running")]
        if ev.activity == "flight":
            why = (f"{len(running)} of {result['persons']['tracks']} tracked people moved faster than 2.0 body-heights/s "
                   f"in one direction (coherence {ev.coherence:.2f}, median speed {ev.speed_bh_s} BH/s)")
        elif ev.activity == "agitated":
            why = f"{len(running)} tracked people moved fast but not in one direction (coherence {ev.coherence:.2f})"
        elif ev.weapon_like:
            why = f"COCO weapon-like object '{ev.weapon_like[0]['cls']}' detected (not a firearm detection)"
        else:
            why = ACTIVITY_LABELS[ev.activity]
        obs = {"camera_id": ev.camera_id, "camera_name": cam["name"], "analysis_id": ev.analysis_id,
               "camera_zone": ev.zone, "activity": ev.activity, "activity_label": ACTIVITY_LABELS[ev.activity],
               "kind": "candidate_event" if candidate else "observation", "reason": why,
               "running_track_ids": [t["id"] for t in running], "key_frame": result.get("key_frame"),
               "weapon": {"firearm_detector": result.get("weapon_model"), "weapon_like": ev.weapon_like},
               "location": ev.location, "applied": False, "recorded_at": time.time(),
               "review": {"status": "not_required" if ev.location["status"] == "verified" else "pending",
                          "reviewer": None, "at": None, "note": ""}}
        with self.lock:
            self.state["observations"][ev.camera_id] = obs
        if ev.location["status"] == "verified":
            self._commit_evidence(ev)
            return
        self.pending[ev.camera_id] = ev
        with self.lock:
            self.state["cameras"][ev.camera_id].update(status="analyzed", activity=ev.activity, reliability=ev.reliability,
                                                       analysis_id=ev.analysis_id, evidence=ev.to_dict())
            z = self.state["zones"][ev.zone]
            if z["observed"] == "unobserved":
                z["observed"] = "unverified footage"
        label = "Candidate event" if candidate else "Observation"
        self._trace("VALIDATE", "validation", f"{label} on {ev.camera_id}: location unknown — not applied",
                    detail=f"{ACTIVITY_LABELS[ev.activity]}. " + " ".join(ev.location["reasons"]),
                    reason="A camera's mount zone is only the observation's location if the footage was recorded there. "
                           "The observation is kept for human review and does not move the threat map.",
                    data={"analysis_id": ev.analysis_id, "camera_id": ev.camera_id})

    # ---------------------------------------------------------------- follow-up logic (vision -> next tool call)
    def _plan_followup(self, cid: str, ev: Evidence, result: dict) -> bool:
        issues = set(ev.issues)
        if "frozen_feed" in issues or "lens_obstructed_or_defocused" in issues:
            self._fault(cid, sorted(issues), "Measured image quality makes this feed unusable; it cannot be fixed by "
                                             "re-processing. Treating the zone as unobserved and looking at adjacent cameras.")
            ev.activity = "unusable"
            self.evidence[cid] = ev
            cam = {**self.b.cameras[cid], "id": cid}
            ev.location = assess_location(cam, self.camera_clips.get(cid), footage_manifest()["clips"].get(self.camera_clips.get(cid) or ""))
            with self.lock:
                self.state["observations"][cid] = {
                    "camera_id": cid, "camera_name": cam["name"], "analysis_id": ev.analysis_id, "camera_zone": ev.zone,
                    "activity": "unusable", "activity_label": ACTIVITY_LABELS["unusable"], "kind": "fault",
                    "reason": "Feed unusable: " + ", ".join(sorted(issues)).replace("_", " "), "running_track_ids": [],
                    "key_frame": result.get("key_frame"), "weapon": {"firearm_detector": result.get("weapon_model"), "weapon_like": []},
                    "location": ev.location, "applied": False, "recorded_at": time.time(),
                    "review": {"status": "not_required", "reviewer": None, "at": None, "note": ""}}
            return True
        if "low_visibility_haze" in issues:
            self.followups.insert(0, {"camera_id": cid, "enhance": "dehaze", "detect_every": 4, "first": ev, "kind": "haze",
                                      "reason": f"Haze measured (dark-channel {result['quality']['haze']:.2f}, contrast "
                                                f"{result['quality']['contrast']:.0f}); re-running with dark-channel dehaze + CLAHE "
                                                f"before trusting the result."})
            self._trace("DECIDE", "decision", f"Re-analyse {cid} with dehazing", reason=self.followups[0]["reason"])
            return True
        if ev.weapon_like:
            best = max(ev.weapon_like, key=lambda w: w["score"])
            self.followups.insert(0, {"camera_id": cid, "enhance": "clahe", "detect_every": 2, "first": ev, "kind": "weapon",
                                      "conf": 0.3, "reason": f"Weapon-like object '{best['cls']}' ({best['score']:.2f}) seen once; "
                                                             f"checking persistence across frames at higher temporal density."})
            self._trace("DECIDE", "decision", f"Persistence check on {cid}", reason=self.followups[0]["reason"])
            return True
        if ev.consistency.get("checked") and not ev.consistency.get("consistent"):
            self.followups.insert(0, {"camera_id": cid, "enhance": "none", "detect_every": 2, "first": ev, "kind": "motion",
                                      "reason": f"Tracked-detection and optical-flow motion estimates disagree "
                                                f"(speed ratio {ev.consistency['speed_ratio']}, direction gap "
                                                f"{ev.consistency['direction_gap_deg']}°); re-running with denser detection."})
            self._trace("VALIDATE", "validation", f"Motion estimates inconsistent on {cid}", reason=self.followups[0]["reason"])
            return True
        return False

    def _merge_followup(self, fu: dict, ev2: Evidence) -> Evidence | None:
        ev1: Evidence = fu["first"]
        if fu["kind"] == "weapon":
            persistent = [w for w in ev2.weapon_like if w["score"] >= 0.3]
            frames = {w["frame"] for w in persistent}
            if len(frames) >= 2:
                ev2.reliability = ev1.reliability
                task = {"camera_id": ev2.camera_id, "zone": ev2.zone, "priority": "high",
                        "task": f"Human verification of weapon-like object ({persistent[0]['cls']}) in {len(frames)} frames",
                        "analysis_id": ev2.analysis_id}
                with self.lock:
                    self.state["verification_tasks"].append(task)
                self._trace("ACT", "human", "Priority verification requested", detail=task["task"],
                            reason="A COCO weapon-like class is not a firearm detection; a person must look at the frames.")
                return ev2
            ev2.weapon_like = []
            self._trace("VALIDATE", "validation", f"Weapon-like detection on {ev2.camera_id} not persistent — discarded",
                        reason="Single-frame detections are treated as noise.")
            return ev2
        same = ev1.activity == ev2.activity
        if same:
            ev2.reliability = round(min(0.85, max(ev1.reliability, ev2.reliability) * 1.4), 3)
            verdict = f"consistent ('{ev2.activity}') under both processing conditions; reliability raised to {ev2.reliability:.2f}"
        else:
            ev2.reliability = round(0.5 * min(ev1.reliability, ev2.reliability), 3)
            verdict = (f"changed from '{ev1.activity}' to '{ev2.activity}'; result is fragile, reliability lowered "
                       f"to {ev2.reliability:.2f}")
        self._trace("VALIDATE", "validation", f"Re-analysis of {ev2.camera_id} {('confirmed' if same else 'contradicted')} the first pass",
                    detail=verdict, reason="Results that survive a change of processing are trusted more.")
        return ev2

    def _fault(self, cid: str, issues: list[str], reason: str) -> None:
        cam = self.b.cameras[cid]
        self.faulted[cid] = issues
        gap = {"camera_id": cid, "zone": cam["zone"], "issues": issues, "reason": reason}
        with self.lock:
            self.state["gaps"].append(gap)
            self.state["metrics"]["faults"] += 1
            self.state["cameras"][cid].update(status="fault", activity="unusable")
            self.state["zones"][cam["zone"]].update(observed="unobserved (camera fault)", status="unknown")
            self.state["verification_tasks"].append({"camera_id": cid, "zone": cam["zone"], "priority": "medium",
                                                     "task": f"Restore or physically check camera {cid} / zone {cam['zone']}"})
        self._trace("ACT", "state_change", f"{cid} marked FAULT; {cam['zone']} is now a coverage gap", reason=reason,
                    changes=[f"camera.{cid}.status -> fault", f"zone.{cam['zone']}.observed -> unobserved"])

    def _commit_evidence(self, ev: Evidence) -> None:
        self.evidence[ev.camera_id] = ev
        with self.lock:
            if ev.camera_id in self.state["observations"]:
                self.state["observations"][ev.camera_id]["applied"] = True
                self.state["observations"][ev.camera_id]["location"] = ev.location
        before = self.belief.summary()
        delta = self.belief.update(ev)
        s = self._publish_belief()
        observed = {"flight": "people fleeing", "agitated": "rapid movement", "calm": "calm", "empty": "clear (empty)",
                    "congested": "congested", "unusable": "unobserved"}[ev.activity]
        with self.lock:
            self.state["cameras"][ev.camera_id].update(status="analyzed", activity=ev.activity, reliability=ev.reliability,
                                                       analysis_id=ev.analysis_id, evidence=ev.to_dict())
            self.state["zones"][ev.zone].update(observed=observed, persons=ev.persons, last_camera=ev.camera_id,
                                                status={"flight": "alert", "agitated": "alert", "congested": "congested"}.get(ev.activity, "normal"))
        top = sorted(delta.items(), key=lambda kv: -abs(kv[1]))[:4]
        changes = [f"P(threat) {before['p_threat']:.2f} -> {s['p_threat']:.2f}",
                   f"region {','.join(before['region'])} ({before['region_mass']:.2f}) -> {','.join(s['region'])} ({s['region_mass']:.2f})"]
        changes += [f"p[{k if k != '__none__' else 'none'}] {v:+.3f}" for k, v in top]
        detail = ""
        if ev.activity == "flight":
            detail = (f"People move toward heading {ev.flight_heading_deg:.0f}° (map); the hazard is most likely toward "
                      f"{ev.source_heading_deg:.0f}° from {ev.camera_id}.")
        self._trace("DECIDE", "state_change", f"Belief and twin updated from {ev.camera_id}: {ACTIVITY_LABELS[ev.activity]}",
                    detail=detail, changes=changes,
                    reason=f"Likelihood update tempered by measured reliability {ev.reliability:.2f}.")
        if s["localized"] and not before["localized"]:
            self._trace("DECIDE", "decision", f"Threat provisionally localised to {', '.join(s['region'])}",
                        reason=f"Region mass {s['region_mass']:.2f} ≥ 0.70 and P(threat) {s['p_threat']:.2f} ≥ 0.50. "
                               f"Seeking independent corroboration and verifying evacuation corridors next.")

    # ---------------------------------------------------------------- assessment and review
    def _assess(self) -> None:
        s = self._publish_belief()
        routing, tool = self._tool("decision.compute_routes", {"exclusion": "region + 1 hop" if s["localized"] else "p>=0.2"},
                                   lambda: compute_routes(self.b, s, self.evidence, self.reviewer_constraints))
        n_valid = sum(r["math_valid"] for r in routing["routes"])
        n_safe = sum(r["safe"] for r in routing["routes"])
        with self.lock:
            self.state["routing"] = routing
        self._trace("ACT", "tool_call", "Evacuation routes computed on the building graph",
                    tool={**tool, "result": f"{len(routing['routes'])} spaces outside exclusion; {n_valid} mathematically valid; "
                                            f"{n_safe} operationally verified"},
                    detail=f"Hazard zones: {', '.join(routing['hazard_zones']) or 'none'}. Exclusion: {', '.join(routing['exclusion_zones']) or 'none'}.",
                    reason="Every candidate route is checked twice: graph constraints, then camera-verified operational safety.")
        for r in routing["routes"]:
            if r["math_valid"] and not r["safe"]:
                op = r["operational"]
                why = []
                if op["hazard_exposure"] >= 0.1:
                    why.append(f"hazard exposure {op['hazard_exposure']:.2f}")
                if op["congested_zones"]:
                    why.append(f"congestion observed in {', '.join(op['congested_zones'])}")
                if op["faulted_zones"]:
                    why.append(f"camera fault in {', '.join(op['faulted_zones'])}")
                if op["unverified_zones"]:
                    why.append(f"unverified {', '.join(op['unverified_zones'])}")
                self._trace("VALIDATE", "validation", f"Route {r['from']} → {r['exit']} valid on paper but not verified safe",
                            detail="; ".join(why), reason="Mathematical validity is not operational safety.")
        assessment, tool = self._tool("decision.assess_options", {"rejected": sorted(self.rejected)},
                                      lambda: assess_options(self.b, s, routing, self.state["gaps"], self.rejected))
        with self.lock:
            self.state["assessment"] = assessment
        rec = next(o for o in assessment["options"] if o["id"] == assessment["recommended"])
        feas = [o["id"] for o in assessment["options"] if o["feasible"]]
        self._trace("DECIDE", "decision", f"Recommended procedure: {rec['id']}",
                    tool={**tool, "result": f"feasible: {', '.join(feas) or 'none'}"},
                    detail=rec["description"],
                    reason="; ".join(f"{p['check']}: {'pass' if p['pass'] else 'fail'} ({p['detail']})" for p in rec["preconditions"]))
        if assessment.get("no_feasible_alternative"):
            self._trace("DECIDE", "decision", f"No alternative to {rec['id']}",
                        reason=assessment["uncertainty"][0],
                        detail="The agent does not invent a procedure whose preconditions fail; the decision returns to the reviewer.")
        if assessment["why_not_full_evacuation"]:
            self._trace("DECIDE", "decision", "Full evacuation not recommended",
                        reason="; ".join(assessment["why_not_full_evacuation"]))

    def _await_review(self) -> str | None:
        a = self.state["assessment"]
        request = {"requested_at": time.time(), "recommended": a["recommended"], "uncertainty": a["uncertainty"],
                   "gaps": self.state["gaps"], "verification_tasks": self.state["verification_tasks"],
                   "pending_observations": sorted(self.pending),
                   "allowed_actions": ["approve", "reject", "more_evidence", "block_exit", *sorted(OBSERVATION_ACTIONS)]}
        with self.lock:
            self.state["review"] = request
            self.state["status"] = "awaiting_review"
        self._trace("REVIEW", "human", "Human review requested",
                    detail=f"Recommendation {a['recommended']} requires approval by an authorised safety lead. Nothing is executed automatically.",
                    reason="Consequential decisions under uncertainty require human control.")
        self.review_event.clear()
        while not self.review_event.wait(0.5):
            if self.cancelled:
                return None
        inp = self.review_input or {}
        action, note, reviewer = inp.get("action"), inp.get("note", ""), inp.get("reviewer", "safety lead")
        with self.lock:
            self.state["review_history"].append({**inp, "at": time.time(), "recommended": a["recommended"]})
            self.state["review"] = None
            self.state["status"] = "running"
        if action in OBSERVATION_ACTIONS:
            return self._decide_observation(action, inp, reviewer, note)
        if action == "approve":
            oid = inp.get("option_id") or a["recommended"]
            opt = next(o for o in a["options"] if o["id"] == oid)
            log = [f"SIMULATED — would initiate {oid}: {act}" for act in opt["actions"]]
            log.append("SIMULATED — no real alert, notification, or door control was triggered.")
            with self.lock:
                self.state["action_log"] = log
                self.state["status"] = "complete"
                self.state["approved_option"] = oid
            self._trace("ACT", "human", f"{reviewer} approved {oid} (simulation)", detail=note or "",
                        reason="Human decision recorded; actions are logged as simulated only.", changes=log[:4])
            return "done"
        if action == "reject":
            oid = inp.get("option_id") or a["recommended"]
            self.rejected.add(oid)
            self._trace("REVIEW", "human", f"{reviewer} rejected {oid}", detail=note,
                        reason="The agent re-assesses with this option excluded.")
            return "reassess"
        if action == "block_exit":
            ex = inp.get("exit_id")
            self.reviewer_constraints.setdefault("blocked_exits", []).append(ex)
            self._trace("REVIEW", "human", f"{reviewer} reported exit {ex} unavailable", detail=note,
                        reason="Human knowledge overrides the model; routes are recomputed.",
                        changes=[f"constraints.blocked_exits += {ex}"])
            return "reassess"
        if action == "more_evidence":
            self.extra_budget += 4
            self._trace("REVIEW", "human", f"{reviewer} requested more evidence", detail=note,
                        reason="The agent analyses remaining cameras before re-assessing.")
            return "reassess"
        self.cancelled = True
        return None

    def _decide_observation(self, action: str, inp: dict, reviewer: str, note: str) -> str:
        for cid in _observation_ids(inp):
            self._decide_one(action, cid, reviewer, note)
        return "reassess"

    def _decide_one(self, action: str, cid: str, reviewer: str, note: str) -> None:
        ev = self.pending.pop(cid)
        confirm = action == "confirm_observation"
        ev.location = confirm_location(ev.location, reviewer) if confirm else dismiss_location(ev.location, reviewer)
        with self.lock:
            obs = self.state["observations"][cid]
            obs["location"] = ev.location
            obs["review"] = {"status": "confirmed" if confirm else "dismissed", "reviewer": reviewer, "at": time.time(),
                             "note": note}
            self.state["cameras"][cid]["evidence"] = ev.to_dict()
        if confirm:
            self._trace("REVIEW", "human", f"{reviewer} confirmed {cid} observation in {ev.zone}",
                        detail=f"{obs['activity_label']}. {note}".strip(),
                        reason="Human-confirmed location: the observation is now applied to the threat belief and the twin.",
                        changes=[f"observation.{cid}.location -> {ev.zone} (human_confirmed)"],
                        data={"analysis_id": ev.analysis_id, "camera_id": cid})
            self._commit_evidence(ev)
        else:
            self._trace("REVIEW", "human", f"{reviewer} dismissed {cid} observation",
                        detail=f"Reason: {note}",
                        reason="Dismissed observations are excluded from the assessment. The footage and analysis are kept; "
                               "dismissing does not change anything in the real world.",
                        changes=[f"observation.{cid}.review -> dismissed"],
                        data={"analysis_id": ev.analysis_id, "camera_id": cid})

    def submit_review(self, payload: dict) -> None:
        if self.state["status"] != "awaiting_review":
            raise ValueError("run is not awaiting review")
        if self.review_event.is_set():
            raise ValueError("a review decision is already being processed")
        if payload.get("action") in OBSERVATION_ACTIONS:
            ids = _observation_ids(payload)
            if not ids:
                raise ValueError("camera_id or camera_ids is required")
            for cid in ids:
                if cid not in self.pending:
                    obs = self.state["observations"].get(cid or "")
                    raise ValueError(f"observation {cid} is not pending review"
                                     + (f" (already {obs['review']['status']})" if obs else ""))
            if payload["action"] == "dismiss_observation" and not (payload.get("note") or "").strip():
                raise ValueError("a reason is required to dismiss an observation")
        self.review_input = payload
        self.review_event.set()


def _observation_ids(payload: dict) -> list[str]:
    ids = list(payload.get("camera_ids") or [])
    if payload.get("camera_id"):
        ids.insert(0, payload["camera_id"])
    return list(dict.fromkeys(i for i in ids if i))


class AgentManager:
    def __init__(self, building: Building, vision: VisionClient):
        self.b = building
        self.vision = vision
        self.runs: dict[str, Run] = {}
        self.current: str | None = None
        self._lock = threading.Lock()

    def start(self, scenario_id: str, overrides: dict[str, str] | None = None, step_delay: float | None = None,
              background: bool = True) -> Run:
        scen = next((s for s in load_scenarios()["scenarios"] if s["id"] == scenario_id), None)
        if scen is None:
            raise KeyError(scenario_id)
        for cid in (overrides or {}):
            if cid not in self.b.cameras:
                raise KeyError(cid)
        with self._lock:
            if self.current and self.runs[self.current].state["status"] in {"running", "awaiting_review"}:
                self.runs[self.current].cancelled = True
            run = Run(self.b, scen, self.vision, overrides, step_delay)
            self.runs[run.id] = run
            self.current = run.id
        if background:
            threading.Thread(target=run.run, daemon=True, name=f"run-{run.id}").start()
        else:
            run.run()
        return run
