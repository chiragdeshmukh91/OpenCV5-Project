// Pure derivations for the Scenario Lab, Agent Intelligence and Incident History views.
import type { Building, FootageClip, RunState, Scenario, TraceEntry } from '../types';
import { elapsedSeconds } from './derive';
import { isPerceiveAnalysis } from './format';

export type ClipCategory = 'flight' | 'degraded' | 'congested' | 'calm' | 'empty' | 'unknown';

/** Behaviour category of a footage clip from its manifest spec (synthetic clips) — uploads are 'unknown'. */
export function clipCategory(clip: FootageClip | Record<string, unknown> | undefined | null): ClipCategory {
  if (!clip) return 'unknown';
  const spec = ((clip as FootageClip).spec ?? clip) as Record<string, unknown>;
  if (spec.frozen || spec.tamper_after != null || (typeof spec.smoke === 'number' && spec.smoke >= 0.5)) return 'degraded';
  switch (spec.behavior) {
    case 'flight':
      return 'flight';
    case 'congested':
      return 'congested';
    case 'empty':
      return 'empty';
    case 'normal':
      return 'calm';
    default:
      return 'unknown';
  }
}

export const CATEGORY_META: Record<ClipCategory, { label: string; color: string }> = {
  flight: { label: 'People fleeing', color: '#ef4444' },
  degraded: { label: 'Degraded feed', color: '#a78bfa' },
  congested: { label: 'Congested', color: '#f59e0b' },
  calm: { label: 'Calm', color: '#2dd4bf' },
  empty: { label: 'Empty', color: '#64748b' },
  unknown: { label: 'User footage', color: '#38bdf8' },
};

const RANK: Record<ClipCategory, number> = { flight: 0, degraded: 1, congested: 2, calm: 3, empty: 4, unknown: 5 };

/**
 * The most telling camera clip of a scenario for its hero image: the most alarming behaviour
 * category wins (flight > degraded > congested > calm > empty), ties go to the camera in the
 * trigger zone, then to camera order.
 */
export function heroClip(
  scenario: Pick<Scenario, 'cameras' | 'trigger'>,
  building: Pick<Building, 'cameras'> | null,
  clips: Record<string, FootageClip | Record<string, unknown>>,
  overrides: Record<string, string> = {},
): { cameraId: string; clipId: string; category: ClipCategory } | null {
  const cams = { ...scenario.cameras, ...overrides };
  const zoneOf = new Map((building?.cameras ?? []).map((c) => [c.id, c.zone]));
  const ids = Object.keys(cams).sort();
  let best: { cameraId: string; clipId: string; category: ClipCategory; score: number } | null = null;
  for (const cid of ids) {
    const clipId = cams[cid];
    if (!clipId) continue;
    const category = clipCategory(clips[clipId]);
    const score = RANK[category] * 10 + (zoneOf.get(cid) === scenario.trigger.zone ? 0 : 1);
    if (!best || score < best.score) best = { cameraId: cid, clipId, category, score };
  }
  return best ? { cameraId: best.cameraId, clipId: best.clipId, category: best.category } : null;
}

export type TriggerKind = 'tip' | '911' | 'radio' | 'other';

export function triggerKind(source: string): TriggerKind {
  const s = source.toLowerCase();
  if (s.includes('911') || s.includes('emergency')) return '911';
  if (s.includes('tip')) return 'tip';
  if (s.includes('radio')) return 'radio';
  return 'other';
}

export const TRIGGER_LABEL: Record<TriggerKind, string> = { tip: 'Tip-line', '911': '911 relay', radio: 'Staff radio', other: 'Report' };

/** Short source label, e.g. "SIMULATED 911 relay" -> "911 relay". */
export function shortSource(source: string): string {
  return source.replace(/^SIMULATED\s+/i, '');
}

// ------------------------------------------------------------------ procedures
export const PROCEDURE_ORDER = ['HOLD', 'SECURE', 'LOCKDOWN', 'LOCKDOWN_PLUS_EVACUATE', 'EVACUATE', 'SHELTER'];

export const PROCEDURE_SHORT: Record<string, string> = {
  HOLD: 'Hold',
  SECURE: 'Secure',
  LOCKDOWN: 'Lockdown',
  LOCKDOWN_PLUS_EVACUATE: 'Lockdown + Evacuate',
  EVACUATE: 'Evacuate',
  SHELTER: 'Shelter',
};

// ------------------------------------------------------------------ trace
export const PHASES = ['PERCEIVE', 'VALIDATE', 'DECIDE', 'ACT', 'REVIEW'] as const;
export type MainPhase = (typeof PHASES)[number];

export function phaseCounts(trace: TraceEntry[]): Record<MainPhase, number> {
  const out = { PERCEIVE: 0, VALIDATE: 0, DECIDE: 0, ACT: 0, REVIEW: 0 } as Record<MainPhase, number>;
  for (const e of trace) if ((PHASES as readonly string[]).includes(e.phase)) out[e.phase as MainPhase]++;
  return out;
}

export function filterTrace(trace: TraceEntry[], phases: Set<string>, query = ''): TraceEntry[] {
  const q = query.trim().toLowerCase();
  return trace.filter((e) => (phases.size === 0 || phases.has(e.phase)) && (!q || `${e.title} ${e.reason} ${e.detail}`.toLowerCase().includes(q)));
}

// ------------------------------------------------------------------ runs
export type OutcomeState = 'approved' | 'pending' | 'running' | 'rejected' | 'cancelled' | 'error' | 'complete';

export interface RunOutcome {
  state: OutcomeState;
  recommended: string | null;
  approved: string | null;
  rejected: string[];
  label: string;
}

/** Outcome of a run: what was recommended and what the human decided (all simulated). */
export function runOutcome(r: RunState): RunOutcome {
  const rejected = r.review_history.filter((h) => h.action === 'reject').map((h) => h.option_id ?? h.recommended);
  const recommended = r.assessment?.recommended ?? r.review?.recommended ?? null;
  const approved = r.approved_option ?? null;
  let state: OutcomeState;
  if (approved) state = 'approved';
  else if (r.status === 'awaiting_review') state = 'pending';
  else if (r.status === 'running') state = 'running';
  else if (r.status === 'cancelled') state = 'cancelled';
  else if (r.status === 'error') state = 'error';
  else state = rejected.length ? 'rejected' : 'complete';
  const label = { approved: 'Approved', pending: 'Awaiting review', running: 'Running', rejected: 'Rejected', cancelled: 'Cancelled', error: 'Error', complete: 'Complete' }[state];
  return { state, recommended, approved, rejected, label };
}

export interface RunStats {
  durationS: number | null;
  analysed: number;
  faults: number;
  reanalyses: number;
  thumb: string | null;
  steps: number;
}

export function runStats(r: RunState, nowMs = Date.now()): RunStats {
  // Thumbnail: the first analysed frame in trace order that is usable (reliable and showing people).
  const ordered = r.trace.filter(isPerceiveAnalysis).map((e) => r.analyses[String(e.data.analysis_id)]).filter(Boolean);
  const all = ordered.length ? ordered : Object.values(r.analyses);
  const a = all.find((x) => (x.quality?.reliability ?? 0) >= 0.5 && (x.persons?.count_max ?? 0) > 0) ?? all[0];
  return {
    durationS: elapsedSeconds(r, nowMs),
    analysed: new Set(Object.values(r.analyses).map((x) => x.camera_id)).size,
    faults: r.metrics.faults,
    reanalyses: r.metrics.reanalyses,
    thumb: a?.frame_urls[Math.floor(a.frame_urls.length / 2)] ?? null,
    steps: r.trace.length,
  };
}

export function fmtDuration(s: number | null): string {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`;
}
