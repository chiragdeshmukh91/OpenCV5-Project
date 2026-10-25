import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Pause, Play } from 'lucide-react';
import type { Analysis, Camera, CameraState } from '../types';
import { heldDetections, enhanceLabel } from '../lib/format';
import { imageDirToCanvas } from '../lib/geometry';
import { cx } from './ui';

const PERSON = '#8fc1ec';
const WEAPON = '#e0ad52';

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 6;
  const ty = Math.max(0, y - 13);
  ctx.fillStyle = 'rgba(7,9,13,0.78)';
  ctx.fillRect(x, ty, w, 13);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 3, ty + 10);
}

export function CameraPlayer({
  camera,
  state,
  analyses,
  analysis,
  onSelectAnalysis,
  previewUrl,
}: {
  camera: Camera | undefined;
  state: CameraState | undefined;
  analyses: Analysis[];
  analysis: Analysis | null;
  onSelectAnalysis: (aid: string) => void;
  previewUrl: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlays, setOverlays] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [sizeTick, setSizeTick] = useState(0);

  const urls = analysis?.frame_urls ?? [];
  const fps = analysis?.fps || 10;
  const [W, H] = analysis?.frame_size ?? [4, 3];
  const aspect = H / W;

  // Preload frames for the selected analysis.
  useEffect(() => {
    setLoadedCount(0);
    setFrame(0);
    const imgs = urls.map((u) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => setLoadedCount((c) => c + 1);
      im.src = u;
      return im;
    });
    imagesRef.current = imgs;
    return () => {
      imgs.forEach((im) => (im.onload = null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.analysis_id, urls.length]);

  // Size canvas to container (device-pixel aware).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = Math.round(w * aspect);
      sizeRef.current = { w, h };
      const c = canvasRef.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.height = `${h}px`;
      }
      setSizeTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, analysis?.analysis_id]);

  // Playback clock.
  useEffect(() => {
    if (!playing || urls.length < 2) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = 1000 / fps;
    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= step) {
        const n = Math.floor(acc / step);
        acc -= n * step;
        setFrame((f) => (f + n) % urls.length);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, urls.length]);

  const dets = useMemo(
    () => (analysis ? heldDetections(analysis.per_frame, frame, analysis.weapon_like) : []),
    [analysis, frame],
  );
  const detectedNow = analysis?.per_frame?.[frame]?.detected ?? false;

  // Draw.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !analysis) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let img: HTMLImageElement | undefined;
    for (let j = frame; j >= 0; j--) {
      const cand = imagesRef.current[j];
      if (cand && cand.complete && cand.naturalWidth) {
        img = cand;
        break;
      }
    }
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    if (!overlays) return;
    const s = w / W;
    for (const d of dets) {
      const [x, y, bw, bh] = d.box;
      const isPerson = d.cls === 'person';
      const col = isPerson ? PERSON : WEAPON;
      ctx.lineWidth = isPerson ? 1.25 : 2;
      ctx.strokeStyle = col;
      ctx.globalAlpha = isPerson ? 0.9 : 1;
      ctx.strokeRect(x * s + 0.5, y * s + 0.5, bw * s, bh * s);
      ctx.globalAlpha = 1;
      const label = isPerson
        ? `${d.track != null ? `#${d.track} ` : ''}${d.score.toFixed(2)}`
        : `${d.cls.replace(/_/g, ' ')} ${d.score.toFixed(2)}`;
      drawLabel(ctx, label, x * s, y * s, col);
    }
    const m = analysis.motion;
    if (m && m.direction_image_deg != null && m.coherence > 0) {
      const [dx, dy] = imageDirToCanvas(m.direction_image_deg);
      const cxp = w / 2, cyp = h / 2;
      const len = Math.min(w, h) * (0.12 + 0.22 * Math.min(1, m.coherence));
      const ex = cxp + dx * len, ey = cyp + dy * len;
      ctx.strokeStyle = 'rgba(240,244,248,0.92)';
      ctx.fillStyle = 'rgba(240,244,248,0.92)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(cxp - dx * len * 0.35, cyp - dy * len * 0.35);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const a = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 4, ey + Math.sin(a) * 4);
      ctx.lineTo(ex - Math.cos(a - 0.45) * 13, ey - Math.sin(a - 0.45) * 13);
      ctx.lineTo(ex - Math.cos(a + 0.45) * 13, ey - Math.sin(a + 0.45) * 13);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      drawLabel(ctx, `motion ${m.direction_image_deg.toFixed(0)}° · coh ${m.coherence.toFixed(2)}`, cxp - dx * len * 0.35 - 30, cyp + 26, '#e6ebf0');
    }
  }, [analysis, frame, dets, overlays, loadedCount, W, sizeTick]);

  const statusText =
    state?.status === 'analyzing'
      ? 'OpenCV analysis in progress'
      : state?.status === 'fault'
        ? 'Camera fault — feed unusable'
        : 'Not analysed in this run';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-ink-100">{camera?.id ?? '—'}</span>
            <span className="truncate text-[12px] text-ink-300">{camera?.name}</span>
            {camera && <span className="font-mono text-[10.5px] text-ink-400">zone {camera.zone}</span>}
          </div>
        </div>
        {analyses.length > 1 && (
          <div className="ml-auto flex overflow-hidden rounded-md border border-ink-600">
            {analyses.map((a) => (
              <button
                key={a.analysis_id}
                type="button"
                onClick={() => onSelectAnalysis(a.analysis_id)}
                title={`${a.analysis_id}: enhance=${a.params?.enhance}, detect every ${a.params?.detect_every}`}
                className={cx(
                  'px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                  a.analysis_id === analysis?.analysis_id ? 'bg-info-dim text-[#a9c7ea]' : 'bg-ink-850 text-ink-400 hover:text-ink-200',
                )}
              >
                {enhanceLabel(a.params?.enhance)}
                <span className="ml-1 font-mono text-[9.5px] opacity-70">{a.analysis_id.slice(-2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-md border border-ink-700 bg-black">
        {analysis ? (
          <>
            <canvas ref={canvasRef} className="block w-full" />
            <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
              {analysis.synthetic && (
                <span className="rounded border border-caution-soft/60 bg-black/70 px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.12em] text-[#ecc987]">
                  SYNTHETIC
                </span>
              )}
              <span className="rounded bg-black/70 px-1.5 py-[1px] font-mono text-[9.5px] text-ink-200">
                {enhanceLabel(analysis.params?.enhance)} · {analysis.clip_id}
              </span>
            </div>
            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-[1px] font-mono text-[9.5px] text-ink-200">
              <span className={cx('h-1.5 w-1.5 rounded-full', detectedNow ? 'bg-info' : 'bg-ink-500')} title="DNN ran on this frame" />
              f{String(frame).padStart(2, '0')}/{urls.length} · {fps} fps
            </div>
            {loadedCount === 0 && urls.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-ink-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
          </>
        ) : (
          <div className="relative" style={{ aspectRatio: '4 / 3' }}>
            {previewUrl && <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-black/20 text-center">
              {state?.status === 'analyzing' && <Loader2 size={18} className="animate-spin text-info" />}
              <div className="text-[12px] font-medium text-ink-100">{statusText}</div>
              <div className="text-[11px] text-ink-300">{previewUrl ? 'Showing source clip preview' : 'No clip assigned'}</div>
            </div>
            {previewUrl && (
              <span className="absolute left-2 top-2 rounded border border-caution-soft/60 bg-black/70 px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.12em] text-[#ecc987]">
                SYNTHETIC
              </span>
            )}
          </div>
        )}
      </div>

      {analysis && (
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-ghost px-2 py-1" onClick={() => setPlaying((p) => !p)} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, urls.length - 1)}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              setFrame(Number(e.target.value));
            }}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-[#6b9bd1]"
            aria-label="Frame"
          />
          <button type="button" className={cx('btn-ghost px-2 py-1', overlays && 'text-[#a9c7ea]')} onClick={() => setOverlays((o) => !o)}>
            {overlays ? <Eye size={12} /> : <EyeOff size={12} />}
            Overlays
          </button>
        </div>
      )}
    </div>
  );
}
