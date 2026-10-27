import { useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis } from '../types';
import { heldDetections } from '../lib/format';
import { containSize, overlayScale, runningIds, styleDetection, trackTrails } from '../lib/evidence';

/** Preload all frame JPEGs of an analysis; returns the image list and how many have loaded. */
export function useFrameImages(urls: string[]): { images: HTMLImageElement[]; loaded: number } {
  const [loaded, setLoaded] = useState(0);
  const key = urls.join('|');
  const images = useMemo(() => {
    return urls.map((u) => {
      const im = new Image();
      im.decoding = 'async';
      im.src = u;
      return im;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setLoaded(images.filter((i) => i.complete && i.naturalWidth).length);
    const on = () => setLoaded((c) => c + 1);
    images.forEach((im) => {
      if (!(im.complete && im.naturalWidth)) im.onload = on;
    });
    return () => images.forEach((im) => (im.onload = null));
  }, [images]);
  return { images, loaded };
}

type Rect = [number, number, number, number];
const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * Draw a label above the box (or below it when that collides / leaves the frame). Labels that would cover
 * an earlier label are skipped: the box stays, and the track list in the side panel carries the detail.
 */
function label(ctx: CanvasRenderingContext2D, text: string, box: Rect, color: string, font: number, taken: Rect[], canvasW: number, canvasH: number, force = false): void {
  ctx.font = `700 ${font}px Inter, system-ui, sans-serif`;
  const pad = Math.round(font * 0.35);
  const w = ctx.measureText(text).width + pad * 2;
  const hh = font + pad * 1.4;
  const x = Math.max(0, Math.min(canvasW - w, box[0]));
  const above: Rect = [x, box[1] - hh, w, hh];
  const below: Rect = [x, Math.min(canvasH - hh, box[1] + box[3]), w, hh];
  const spot = [above, below].find((r) => r[1] >= 0 && !taken.some((t) => overlaps(t, r))) ?? (force ? (above[1] >= 0 ? above : below) : null);
  if (!spot) return;
  taken.push(spot);
  ctx.fillStyle = color;
  ctx.fillRect(spot[0], spot[1], spot[2], spot[3]);
  ctx.fillStyle = '#05070a';
  ctx.fillText(text, spot[0] + pad, spot[1] + hh - pad * 1.1);
}

/**
 * One analysed frame drawn at the largest size that fits the container (aspect preserved), with the
 * real detections for that frame. Running tracks (the people that made the agent call it "flight") are
 * red with a foot-point trail; other people are teal; weapon-like COCO objects amber.
 */
export function EvidenceCanvas({
  analysis,
  frame,
  overlays,
  runningOnly = false,
  selectedTrack = null,
  className,
}: {
  analysis: Analysis;
  frame: number;
  overlays: boolean;
  runningOnly?: boolean;
  selectedTrack?: number | null;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { images, loaded } = useFrameImages(analysis.frame_urls);
  const [W, H] = analysis.frame_size ?? [4, 3];
  const running = useMemo(() => runningIds(analysis), [analysis]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const size = containSize(box.w, box.h, W, H);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, size.w, size.h);
    let img: HTMLImageElement | undefined;
    for (let j = Math.min(frame, images.length - 1); j >= 0; j--) {
      const cand = images[j];
      if (cand && cand.complete && cand.naturalWidth) {
        img = cand;
        break;
      }
    }
    if (img) ctx.drawImage(img, 0, 0, size.w, size.h);
    if (!overlays) return;
    const s = size.w / W;
    const { line, font } = overlayScale(size.w);
    // trails of running tracks (measured foot points on detection frames so far)
    const trails = trackTrails(analysis.per_frame, frame);
    for (const [id, pts] of trails) {
      if (!running.has(id) || pts.length < 2) continue;
      ctx.strokeStyle = 'rgba(255,77,94,0.85)';
      ctx.lineWidth = Math.max(1.5, line * 0.75);
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const dets = heldDetections(analysis.per_frame, frame, analysis.weapon_like).map((d) => styleDetection(d, analysis, running));
    // draw ordinary people first so highlighted boxes sit on top
    const order = { person: 0, running: 1, weapon: 2 } as const;
    dets.sort((a, b) => order[a.kind] - order[b.kind]);
    const shown = dets.filter((sd) => !(runningOnly && sd.kind === 'person'));
    for (const sd of shown) {
      const [x, y, bw, bh] = sd.det.box;
      const sel = selectedTrack != null && sd.det.track === selectedTrack;
      ctx.lineWidth = sd.kind === 'person' ? line : line + 1 + (sel ? 2 : 0);
      ctx.strokeStyle = '#000';
      ctx.globalAlpha = 0.55;
      ctx.strokeRect(x * s - 1, y * s - 1, bw * s + 2, bh * s + 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sel ? '#ffffff' : sd.color;
      ctx.strokeRect(x * s, y * s, bw * s, bh * s);
    }
    // labels: selected and weapon-like first, then running, then ordinary people; no label covers another
    const taken: Rect[] = [];
    const rank = (sd: (typeof shown)[number]) => (selectedTrack != null && sd.det.track === selectedTrack ? 0 : sd.kind === 'weapon' ? 1 : sd.kind === 'running' ? 2 : 3);
    for (const sd of [...shown].sort((a, b) => rank(a) - rank(b))) {
      const sel = selectedTrack != null && sd.det.track === selectedTrack;
      if (sd.kind === 'person' && !sel && size.w < 520) continue;
      const [x, y, bw, bh] = sd.det.box;
      label(ctx, sd.label, [x * s, y * s, bw * s, bh * s], sel ? '#ffffff' : sd.color, sd.kind === 'person' ? font - 1 : font, taken, size.w, size.h, sel || sd.kind === 'weapon');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, frame, overlays, runningOnly, selectedTrack, loaded, size.w, size.h, W]);

  return (
    <div ref={wrap} className={className ?? 'flex h-full w-full items-center justify-center'}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} className="block rounded-md" role="img" aria-label={`Frame ${frame} of ${analysis.camera_id} with ${overlays ? 'detection overlays' : 'no overlays (original footage)'}`} />
    </div>
  );
}
