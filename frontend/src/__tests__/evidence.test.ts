// Regression: evidence must make it obvious which detections triggered an event.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures_run_s2_unverified.json';
import { containSize, detectionFrames, nextDetectionFrame, overlayScale, runningIds, styleDetection, trackTrails } from '../lib/evidence';
import { heldDetections } from '../lib/format';
import type { RunState } from '../types';

const run = fixture as unknown as RunState;
const a = run.analyses[run.observations!['CAM-03'].analysis_id!];

describe('evidence frames', () => {
  it('are stored at the source resolution', () => {
    expect(a.preview_width).toBe(a.frame_size![0]);
  });

  it('key frame shows the running tracks that produced the flight label', () => {
    const running = runningIds(a);
    expect(running.size).toBeGreaterThan(0);
    const dets = heldDetections(a.per_frame, a.key_frame!, a.weapon_like).map((d) => styleDetection(d, a, running));
    const runningBoxes = dets.filter((d) => d.kind === 'running');
    expect(runningBoxes.length).toBeGreaterThan(0);
    for (const d of runningBoxes) expect(d.label).toMatch(/^#\d+ RUN \d+\.\d BH\/s$/);
  });

  it('weapon-like objects are labelled as COCO weapon-like, never firearms', () => {
    const s = styleDetection({ cls: 'knife', score: 0.41, box: [0, 0, 5, 5] }, a, new Set());
    expect(s.kind).toBe('weapon');
    expect(s.label).toContain('COCO weapon-like');
    expect(s.label.toLowerCase()).not.toContain('firearm');
  });

  it('navigates between DNN frames and builds trails from real detections', () => {
    const frames = detectionFrames(a.per_frame);
    expect(frames[0]).toBe(0);
    expect(nextDetectionFrame(a.per_frame, 0, 1)).toBe(frames[1]);
    expect(nextDetectionFrame(a.per_frame, frames[1], -1)).toBe(0);
    const trails = trackTrails(a.per_frame, a.per_frame!.length - 1);
    const id = [...runningIds(a)][0];
    expect(trails.get(id)!.length).toBeGreaterThan(1);
  });

  it('keeps aspect ratio and legible overlays at any size', () => {
    expect(containSize(1000, 500, 768, 576)).toEqual({ w: 666, h: 500 });
    expect(containSize(400, 1000, 768, 576)).toEqual({ w: 400, h: 300 });
    expect(overlayScale(300).line).toBeGreaterThanOrEqual(2);
    expect(overlayScale(300).font).toBeGreaterThanOrEqual(11);
    expect(overlayScale(1200).line).toBeGreaterThan(overlayScale(300).line);
  });
});
