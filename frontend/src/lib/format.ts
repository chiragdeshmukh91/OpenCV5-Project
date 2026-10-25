import type { Detection, FrameRecord, RunState, TraceEntry, WeaponLike } from '../types';

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

export function ms(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 10000) return `${(v / 1000).toFixed(1)} s`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

export function elapsed(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}m ${s.toFixed(0).padStart(2, '0')}s` : `${s.toFixed(1)} s`;
}

export function humanize(id: string): string {
  return id.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Compact one-line JSON for tool arguments: {camera_id: CAM-03, enhance: none}. */
export function compactArgs(args: Record<string, unknown> | null | undefined, maxLen = 160): string {
  if (!args || Object.keys(args).length === 0) return '{}';
  const parts = Object.entries(args).map(([k, v]) => {
    let s: string;
    if (typeof v === 'string') s = v;
    else if (Array.isArray(v)) s = `[${v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}]`;
    else s = JSON.stringify(v);
    return `${k}: ${s}`;
  });
  const out = `{ ${parts.join(', ')} }`;
  return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out;
}

export type ChangeKind = 'transition' | 'increase' | 'decrease' | 'set';

export interface ParsedChange {
  raw: string;
  kind: ChangeKind;
  key: string;
  from?: string;
  to?: string;
  delta?: number;
}

/**
 * Parse the state-change strings emitted by the orchestrator into diff-style rows.
 *   "P(threat) 0.50 -> 0.86"            -> transition
 *   "belief.p_threat: 0 -> 0.50"        -> transition
 *   "p[C3] +0.324" / "p[none] -0.356"   -> increase / decrease
 *   "camera.CAM-02.status -> fault"     -> transition (no from)
 *   "constraints.blocked_exits += EX-E" -> set
 */
export function parseChange(raw: string): ParsedChange {
  const s = raw.trim();
  const delta = s.match(/^(.*?)\s+([+-]\d*\.?\d+)$/);
  if (delta && !s.includes('->')) {
    const d = parseFloat(delta[2]);
    return { raw, kind: d >= 0 ? 'increase' : 'decrease', key: delta[1], delta: d };
  }
  const arrow = s.indexOf('->');
  if (arrow >= 0) {
    const left = s.slice(0, arrow).trim().replace(/:$/, '');
    const to = s.slice(arrow + 2).trim();
    // "region A,B (0.74)" — split the key from the from-value at the last space-separated token group.
    const m = left.match(/^(\S+(?:\([^)]*\))?)(?::)?\s+(.+)$/);
    if (m) return { raw, kind: 'transition', key: m[1].replace(/:$/, ''), from: m[2], to };
    return { raw, kind: 'transition', key: left, to };
  }
  const plusEq = s.match(/^(.*?)\s*\+=\s*(.*)$/);
  if (plusEq) return { raw, kind: 'set', key: plusEq[1], to: `+ ${plusEq[2]}` };
  return { raw, kind: 'set', key: s };
}

export function formatTraceTime(t: number): string {
  return `T+${t.toFixed(1).padStart(4, '0')}s`;
}

/** One-line summary of a trace entry (used for tooltips / compact view / tests). */
export function traceSummary(e: TraceEntry): string {
  const tool = e.tool ? ` [${e.tool.name} ${ms(e.tool.duration_ms)}]` : '';
  return `#${e.step} ${e.phase} ${e.title}${tool}`;
}

export function isPerceiveAnalysis(e: TraceEntry): boolean {
  return e.phase === 'PERCEIVE' && e.kind === 'tool_call' && typeof e.data?.analysis_id === 'string';
}

/**
 * Boxes to draw on frame i: detections from the most recent frame at or before i on which the DNN
 * ran (detection runs every N frames; boxes are held between detection frames), plus any
 * weapon-model detections recorded for that detection frame.
 */
export function heldDetections(perFrame: FrameRecord[] | undefined, i: number, weaponLike: WeaponLike[] = []): Detection[] {
  if (!perFrame || perFrame.length === 0) return [];
  let j = Math.min(i, perFrame.length - 1);
  while (j >= 0 && !perFrame[j].detected) j--;
  if (j < 0) return [];
  const rec = perFrame[j];
  const dets = [...rec.detections];
  for (const w of weaponLike) {
    if (w.kind === 'weapon_model' && w.frame === rec.index && Array.isArray(w.box) && w.box.length === 4) {
      dets.push({ cls: w.cls, score: w.score, box: w.box as [number, number, number, number], source: w.source });
    }
  }
  return dets;
}

/** Agent working time: live while running, frozen at the review request or at completion. */
export function runElapsed(run: RunState | null, now: number): number | null {
  if (!run) return null;
  let end: number;
  if (run.status === 'running') end = now / 1000;
  else if (run.status === 'awaiting_review' && run.review) end = run.review.requested_at;
  else if (run.finished_at) end = run.finished_at;
  else end = run.started_at + (run.trace[run.trace.length - 1]?.t ?? 0);
  return Math.max(0, end - run.started_at);
}

export function enhanceLabel(mode: string | undefined): string {
  if (!mode || mode === 'none') return 'raw';
  return mode;
}

/**
 * Effective camera status. Backend quirk: a faulted camera is first marked `fault`, then overwritten
 * with `pending_recheck` by the follow-up planner. A camera listed in `gaps` is reported as `fault`.
 */
export function effectiveCameraStatus(run: RunState | null, cid: string): string {
  const st = run?.cameras[cid]?.status ?? 'idle';
  if (st === 'pending_recheck' && run?.gaps.some((g) => g.camera_id === cid)) return 'fault';
  return st;
}
