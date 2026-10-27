// Pure helpers for drawing and navigating video evidence. Everything comes from the backend analysis
// (per-frame DNN detections, track ids, per-track speeds); nothing is synthesised for display.
import type { Analysis, Detection, FrameRecord } from '../types';

export type DetKind = 'running' | 'person' | 'weapon';

export const DET_COLORS: Record<DetKind, string> = {
  running: '#ff4d5e', // tracked person whose measured speed exceeded the running threshold
  person: '#5eead4',
  weapon: '#fbbf24',
};

export interface StyledDetection {
  det: Detection;
  kind: DetKind;
  color: string;
  label: string;
}

export function runningIds(a: Analysis | null | undefined): Set<number> {
  return new Set(a?.motion?.running_track_ids ?? []);
}

export function trackSpeed(a: Analysis | null | undefined, id: number | null | undefined): number | null {
  if (id == null) return null;
  return a?.motion?.tracks_detail?.find((t) => t.id === id)?.speed_bh_s ?? null;
}

/** Colour and label for a detection: running tracks are highlighted, weapon-like objects are never called firearms. */
export function styleDetection(d: Detection, a: Analysis | null | undefined, running: Set<number>): StyledDetection {
  if (d.cls !== 'person') {
    const model = d.source?.startsWith('weapon:') ? 'weapon model' : 'COCO weapon-like';
    return { det: d, kind: 'weapon', color: DET_COLORS.weapon, label: `${d.cls.replace(/_/g, ' ')} ${d.score.toFixed(2)} · ${model}` };
  }
  const isRunning = d.track != null && running.has(d.track);
  const spd = trackSpeed(a, d.track);
  const id = d.track != null ? `#${d.track} ` : '';
  if (isRunning) return { det: d, kind: 'running', color: DET_COLORS.running, label: `${id}RUN ${spd != null ? `${spd.toFixed(1)} BH/s` : ''}`.trim() };
  return { det: d, kind: 'person', color: DET_COLORS.person, label: `${id}person ${d.score.toFixed(2)}` };
}

/** Indices of frames on which the DNN ran. */
export function detectionFrames(perFrame: FrameRecord[] | undefined): number[] {
  return (perFrame ?? []).filter((f) => f.detected).map((f) => f.index);
}

export function nextDetectionFrame(perFrame: FrameRecord[] | undefined, from: number, dir: 1 | -1): number {
  const frames = detectionFrames(perFrame);
  if (!frames.length) return from;
  if (dir > 0) return frames.find((f) => f > from) ?? frames[frames.length - 1];
  return [...frames].reverse().find((f) => f < from) ?? frames[0];
}

/** Foot-point trail of each track over detection frames up to `upto` (inclusive), in source pixels. */
export function trackTrails(perFrame: FrameRecord[] | undefined, upto: number): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  for (const f of perFrame ?? []) {
    if (f.index > upto) break;
    if (!f.detected) continue;
    for (const d of f.detections) {
      if (d.cls !== 'person' || d.track == null) continue;
      const [x, y, w, h] = d.box;
      const arr = out.get(d.track) ?? [];
      arr.push([x + w / 2, y + h]);
      out.set(d.track, arr);
    }
  }
  return out;
}

/** Clip-relative time of a frame, e.g. "t+2.4 s". */
export function frameTime(frame: number, fps: number | undefined): string {
  const f = fps && fps > 0 ? fps : 10;
  return `t+${(frame / f).toFixed(1)} s`;
}

/** Fit a W×H source inside a box (object-fit: contain). */
export function containSize(boxW: number, boxH: number, W: number, H: number): { w: number; h: number } {
  if (boxW <= 0 || boxH <= 0 || W <= 0 || H <= 0) return { w: 0, h: 0 };
  const s = Math.min(boxW / W, boxH / H);
  return { w: Math.floor(W * s), h: Math.floor(H * s) };
}

/** Stroke width / font size that stay legible at any display size. */
export function overlayScale(displayW: number): { line: number; font: number } {
  return { line: Math.max(2, Math.round(displayW / 320)), font: Math.max(11, Math.min(16, Math.round(displayW / 60))) };
}
