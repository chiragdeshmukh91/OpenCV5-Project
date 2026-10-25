// Pure derivations from real run state for the command-center views. Nothing here invents data:
// every string is composed from backend fields (trace, belief, evidence, assessment, gaps).
import type { Building, RunState, TraceEntry } from '../types';
import { isPerceiveAnalysis } from './format';

export type Tone = 'threat' | 'caution' | 'clear' | 'info' | 'muted';

/** Incident priority from P(threat): <0.15 Low, <0.5 Elevated, >=0.5 High. */
export function priorityOf(p: number | null | undefined): { label: 'Low' | 'Elevated' | 'High' | 'Unknown'; tone: Tone } {
  if (p == null || !Number.isFinite(p)) return { label: 'Unknown', tone: 'muted' };
  if (p < 0.15) return { label: 'Low', tone: 'clear' };
  if (p < 0.5) return { label: 'Elevated', tone: 'caution' };
  return { label: 'High', tone: 'threat' };
}

/** Uncertainty about the threat location, from normalised entropy and region mass. */
export function uncertaintyLevel(run: RunState | null): { label: 'Low' | 'Medium' | 'High' | '—'; tone: Tone; detail: string } {
  const b = run?.belief;
  if (!b) return { label: '—', tone: 'muted', detail: 'No belief yet' };
  const detail = `entropy ${b.entropy.toFixed(2)} · region mass ${(b.region_mass * 100).toFixed(0)}%`;
  if (b.localized && b.entropy < 0.45 && b.region_mass >= 0.8) return { label: 'Low', tone: 'clear', detail };
  if (b.entropy < 0.65 && b.region_mass >= 0.6) return { label: 'Medium', tone: 'caution', detail };
  return { label: 'High', tone: 'threat', detail };
}

/** "LOCKDOWN_PLUS_EVACUATE" -> ["LOCKDOWN", "EVACUATE"] (rendered with an arrow). */
export function procedureParts(id: string | null | undefined): string[] {
  if (!id) return [];
  return id.split('_PLUS_').map((p) => p.replace(/_/g, ' '));
}

export function procedureText(id: string | null | undefined): string {
  return procedureParts(id).join(' → ');
}

export function lastEntry(run: RunState | null, pred: (e: TraceEntry) => boolean): TraceEntry | undefined {
  if (!run) return undefined;
  for (let i = run.trace.length - 1; i >= 0; i--) if (pred(run.trace[i])) return run.trace[i];
  return undefined;
}

/** Human-readable status for the incident strip. */
export function statusText(run: RunState | null): string {
  if (!run) return 'No active run';
  switch (run.status) {
    case 'running':
      return run.assessment ? 'Re-assessing' : run.phase === 'PERCEIVE' ? 'Analyzing evidence' : 'Investigating';
    case 'awaiting_review':
      return 'Awaiting decision';
    case 'complete':
      return run.approved_option ? `Approved (simulated)` : 'Complete';
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return 'Error';
    default:
      return run.status;
  }
}

/** AI Summary composed only from real state: trigger, latest decision, localisation, gaps. */
export function composeSummary(run: RunState | null): string {
  if (!run) return '';
  const parts: string[] = [];
  const trig = run.scenario.trigger;
  parts.push(`${trig.source}: ${trig.claim}.`);
  const dec = lastEntry(run, (e) => e.kind === 'decision' || (e.kind === 'human' && e.phase !== 'REVIEW'));
  if (dec) parts.push(`${dec.title}.`);
  const b = run.belief;
  if (b) {
    if (b.localized) parts.push(`Threat localised to ${b.region.join(', ')} (${Math.round(b.region_mass * 100)}% of mass).`);
    else parts.push(`Not localised: P(threat) ${Math.round(b.p_threat * 100)}%, ${b.supporting_observations} supporting visual observation${b.supporting_observations === 1 ? '' : 's'}.`);
  }
  if (run.gaps.length) parts.push(`${run.gaps.length} coverage gap${run.gaps.length === 1 ? '' : 's'} (${run.gaps.map((g) => g.camera_id).join(', ')}).`);
  return parts.join(' ');
}

/** Elapsed agent time in seconds: live while running, frozen at the review request or finish. */
export function elapsedSeconds(run: RunState | null, nowMs: number): number | null {
  if (!run) return null;
  let end: number;
  if (run.status === 'running') end = nowMs / 1000;
  else if (run.status === 'awaiting_review' && run.review) end = run.review.requested_at;
  else if (run.finished_at) end = run.finished_at;
  else end = run.started_at + (run.trace[run.trace.length - 1]?.t ?? 0);
  return Math.max(0, end - run.started_at);
}

export function clockTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function entryTime(run: RunState, e: TraceEntry): string {
  return clockTime(run.started_at + e.t);
}

// ------------------------------------------------------------------ agent activity
export type StageState = 'done' | 'active' | 'pending' | 'skipped';

export interface ActivityStage {
  key: string;
  label: string;
  tag: string;
  state: StageState;
  time: string | null;
  detail: string;
  step?: number;
}

/**
 * The six-stage agent activity view (Observed, Analyzed, Corroborated, Assessed uncertainty,
 * Recommended, Human review) mapped from real trace entries.
 */
export function agentActivity(run: RunState | null): ActivityStage[] {
  const mk = (key: string, label: string, tag: string): ActivityStage => ({ key, label, tag, state: 'pending', time: null, detail: '' });
  const stages = [
    mk('observed', 'Observed', 'Report'),
    mk('analyzed', 'Analyzed', 'Vision'),
    mk('corroborated', 'Corroborated', 'Corroboration'),
    mk('assessed', 'Assessed Uncertainty', 'Assessment'),
    mk('recommended', 'Recommended', 'Recommendation'),
    mk('review', 'Human Review', 'Review'),
  ];
  if (!run) return stages;
  const set = (i: number, e: TraceEntry | undefined, detail: string, state: StageState = 'done') => {
    if (!e) return;
    stages[i] = { ...stages[i], state, time: entryTime(run, e), detail, step: e.step };
  };
  const first = run.trace[0];
  set(0, first, first?.title.replace(/^Simulated trigger received:\s*/, '') ?? '');

  const analyses = run.trace.filter(isPerceiveAnalysis);
  const lastA = analyses[analyses.length - 1];
  if (lastA) {
    const cams = new Set(analyses.map((e) => String(e.data.camera_id)));
    set(1, lastA, `${analyses.length} OpenCV analys${analyses.length === 1 ? 'is' : 'es'} on ${cams.size} camera${cams.size === 1 ? '' : 's'}; latest ${lastA.data.camera_id}`);
  }

  const localised = run.trace.find((e) => e.kind === 'decision' && e.title.startsWith('Threat provisionally localised'));
  const stop = lastEntry(run, (e) => e.kind === 'decision' && e.title === 'Stop gathering evidence');
  if (localised) {
    const sup = run.belief?.supporting_observations ?? 0;
    set(2, localised, `${localised.title.replace('Threat provisionally localised to ', 'Region ')}; ${sup} supporting observation${sup === 1 ? '' : 's'}`);
  } else if (stop) {
    set(2, stop, 'Report not corroborated by visual evidence', 'skipped');
  }

  if (stop) set(3, stop, stop.reason);
  const rec = lastEntry(run, (e) => e.kind === 'decision' && e.title.startsWith('Recommended procedure'));
  if (rec) set(4, rec, procedureText(run.assessment?.recommended ?? rec.title.replace('Recommended procedure: ', '')));

  const reviewReq = lastEntry(run, (e) => e.phase === 'REVIEW' && e.kind === 'human' && e.title === 'Human review requested');
  const approved = lastEntry(run, (e) => e.phase === 'ACT' && e.kind === 'human');
  if (approved) set(5, approved, approved.title);
  else if (run.status === 'awaiting_review' && reviewReq) set(5, reviewReq, 'Waiting for operator decision', 'active');
  else if (run.status === 'cancelled') stages[5] = { ...stages[5], state: 'skipped', detail: 'Run cancelled' };

  // While the agent works, the first pending stage is the active one.
  if (run.status === 'running') {
    const i = stages.findIndex((s) => s.state === 'pending');
    if (i >= 0) stages[i] = { ...stages[i], state: 'active', detail: stages[i].detail || 'In progress' };
  }
  return stages;
}

// ------------------------------------------------------------------ evidence timeline
export interface TimelineItem {
  step: number;
  time: string;
  title: string;
  tag: string;
  phase: string;
  zones: string[];
  cameraId: string | null;
  analysisId: string | null;
  thumb: string | null;
}

const TAG_FOR: Record<string, string> = {
  tool_call: 'Vision',
  state_change: 'Analysis',
  decision: 'Decision',
  validation: 'Validation',
  human: 'Review',
  observation: 'Report',
};

/** Evidence timeline rows from PERCEIVE / DECIDE / VALIDATE trace entries with zone tags and frames. */
export function evidenceTimeline(run: RunState | null, building: Building | null): TimelineItem[] {
  if (!run) return [];
  const zoneIds = new Set((building?.zones ?? []).map((z) => z.id));
  const camZone = new Map((building?.cameras ?? []).map((c) => [c.id, c.zone]));
  const out: TimelineItem[] = [];
  for (const e of run.trace) {
    if (!['PERCEIVE', 'DECIDE', 'VALIDATE'].includes(e.phase)) continue;
    if (e.kind === 'decision' && e.title.startsWith('Next: analyse')) continue; // planning noise
    const cam = (typeof e.data?.camera_id === 'string' ? e.data.camera_id : null) ?? e.title.match(/CAM-\d+/)?.[0] ?? null;
    let aid = typeof e.data?.analysis_id === 'string' ? e.data.analysis_id : null;
    if (!aid && cam) aid = run.cameras[cam]?.analysis_id ?? null;
    const a = aid ? run.analyses[aid] : undefined;
    const zones = new Set<string>();
    if (cam && camZone.get(cam)) zones.add(camZone.get(cam)!);
    for (const tok of `${e.title} ${e.detail}`.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) ?? []) if (zoneIds.has(tok)) zones.add(tok);
    if (e.kind === 'observation' && run.scenario.trigger.zone) zones.add(run.scenario.trigger.zone);
    let tag = TAG_FOR[e.kind] ?? e.kind;
    if (e.title.startsWith('Threat provisionally localised')) tag = 'Corroboration';
    if (e.title.startsWith('Recommended procedure')) tag = 'Recommendation';
    out.push({
      step: e.step,
      time: entryTime(run, e),
      title: e.title,
      tag,
      phase: e.phase,
      zones: [...zones].slice(0, 3),
      cameraId: cam,
      analysisId: aid,
      thumb: a && a.frame_urls.length ? a.frame_urls[Math.min(a.frame_urls.length - 1, Math.floor(a.frame_urls.length / 2))] : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ key observations
export interface Observation {
  text: string;
  tone: Tone;
  cameraId?: string;
}

/** Key observations derived from per-camera evidence (activity labels, weapon-like objects, faults). */
export function keyObservations(run: RunState | null): Observation[] {
  if (!run) return [];
  const out: Observation[] = [];
  const quiet: string[] = [];
  for (const cam of Object.values(run.cameras)) {
    const ev = cam.evidence;
    if (!ev) continue;
    if (ev.activity === 'flight') {
      out.push({ text: `People fleeing in ${ev.zone} (${cam.id}) toward ${ev.flight_heading_deg?.toFixed(0)}°`, tone: 'threat', cameraId: cam.id });
    } else if (ev.activity === 'agitated') {
      out.push({ text: `Rapid, incoherent movement in ${ev.zone} (${cam.id})`, tone: 'caution', cameraId: cam.id });
    } else if (ev.activity === 'congested') {
      out.push({ text: `Dense, near-stationary crowd in ${ev.zone} (${cam.id})`, tone: 'caution', cameraId: cam.id });
    } else if (ev.activity === 'calm' || ev.activity === 'empty') {
      quiet.push(ev.zone);
    }
    if (ev.weapon_like.length) out.push({ text: `Weapon-like object (${ev.weapon_like[0].cls}) on ${cam.id} — needs human verification`, tone: 'caution', cameraId: cam.id });
  }
  for (const g of run.gaps) out.push({ text: `${g.camera_id} unusable (${g.issues.map((i) => i.replace(/_/g, ' ')).join(', ')}) — ${g.zone} unobserved`, tone: 'muted', cameraId: g.camera_id });
  if (quiet.length) out.push({ text: `Ordinary activity or empty: ${quiet.join(', ')}`, tone: 'clear' });
  return out;
}

/** Cameras analysed / total. */
export function cameraCoverage(run: RunState | null, total: number): { analysed: number; total: number; analysing: string | null } {
  if (!run) return { analysed: 0, total, analysing: null };
  const cams = Object.values(run.cameras);
  return {
    analysed: cams.filter((c) => c.status === 'analyzed' || c.status === 'pending_recheck' || c.status === 'fault' || !!c.analysis_id).length,
    total: total || cams.length,
    analysing: cams.find((c) => c.status === 'analyzing')?.id ?? null,
  };
}

/** Analyses most relevant for the human reviewer: supporting cameras first, then the rest. */
export function supportingAnalyses(run: RunState | null, max = 5): string[] {
  if (!run) return [];
  const score = (cid: string) => {
    const a = run.cameras[cid]?.activity;
    return a === 'flight' ? 0 : a === 'agitated' || a === 'congested' ? 1 : run.cameras[cid]?.evidence?.weapon_like.length ? 0 : 2;
  };
  const latestPerCam = new Map<string, string>();
  for (const a of Object.values(run.analyses)) latestPerCam.set(a.camera_id, a.analysis_id);
  return [...latestPerCam.entries()].sort((a, b) => score(a[0]) - score(b[0])).slice(0, max).map(([, aid]) => aid);
}
