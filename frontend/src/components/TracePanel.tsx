import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Pause, ScrollText, Video } from 'lucide-react';
import type { RunState, TraceEntry } from '../types';
import { phaseStyle } from '../lib/colors';
import { compactArgs, elapsed, formatTraceTime, isPerceiveAnalysis, ms, parseChange, runElapsed } from '../lib/format';
import { cx } from './ui';

function Changes({ changes }: { changes: string[] }) {
  if (!changes.length) return null;
  return (
    <ul className="mt-1 space-y-[1px] font-mono text-[10.5px]">
      {changes.map((c, i) => {
        const p = parseChange(c);
        const sign = p.kind === 'increase' ? '+' : p.kind === 'decrease' ? '−' : p.kind === 'transition' ? '~' : '•';
        const color =
          p.kind === 'increase' ? 'text-[#e3a0a3]' : p.kind === 'decrease' ? 'text-[#7fd3bd]' : p.kind === 'transition' ? 'text-[#a9c7ea]' : 'text-ink-300';
        return (
          <li key={i} className="flex gap-1.5 rounded-sm bg-ink-950/60 px-1.5">
            <span className={cx('w-2 shrink-0', color)}>{sign}</span>
            <span className="text-ink-300">{p.key}</span>
            {p.kind === 'transition' && (
              <span className="min-w-0 truncate">
                {p.from && <span className="text-ink-400">{p.from} </span>}
                <span className="text-ink-500">→ </span>
                <span className="text-ink-100">{p.to}</span>
              </span>
            )}
            {(p.kind === 'increase' || p.kind === 'decrease') && (
              <span className={color}>
                {p.delta! > 0 ? '+' : ''}
                {p.delta}
              </span>
            )}
            {p.kind === 'set' && p.to && <span className="text-ink-100">{p.to}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function TraceRow({ e, latest, active, onOpen }: { e: TraceEntry; latest: boolean; active: boolean; onOpen?: () => void }) {
  const ph = phaseStyle(e.phase);
  const clickable = !!onOpen;
  return (
    <li
      className={cx(
        'fade-in grid grid-cols-[64px_84px_minmax(0,1fr)] gap-x-3 border-b border-ink-750/80 px-3 py-2 lg:grid-cols-[64px_84px_minmax(0,1fr)_minmax(0,0.9fr)]',
        latest && 'bg-ink-850/70',
        active && 'bg-info-dim/40',
        clickable && 'cursor-pointer hover:bg-ink-850',
      )}
      onClick={onOpen}
      title={clickable ? 'Show this analysis in the camera player' : undefined}
    >
      <div className="tnum font-mono text-[10.5px] leading-5 text-ink-400">
        <div className="text-ink-200">#{String(e.step).padStart(2, '0')}</div>
        <div>{formatTraceTime(e.t)}</div>
      </div>
      <div className="pt-[2px]">
        <span
          className="inline-block rounded border px-1.5 py-[1px] font-mono text-[9.5px] font-semibold tracking-wider"
          style={{ color: ph.fg, background: ph.bg, borderColor: ph.border }}
        >
          {e.phase}
        </span>
        <div className="mt-1 text-[9.5px] text-ink-500">{e.kind.replace('_', ' ')}</div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] font-medium leading-5 text-ink-100">
          {clickable && <Video size={12} className="shrink-0 text-[#8fb8e6]" />}
          <span className="min-w-0">{e.title}</span>
        </div>
        {e.reason && (
          <div className="text-[11.5px] leading-snug text-ink-300">
            <span className="mr-1 text-[9.5px] font-semibold uppercase tracking-wider text-ink-500">why</span>
            {e.reason}
          </div>
        )}
        {e.detail && <div className="mt-0.5 text-[11px] leading-snug text-ink-400">{e.detail}</div>}
        <div className="lg:hidden">
          <Changes changes={e.changes} />
        </div>
      </div>
      <div className="col-span-3 mt-1 min-w-0 lg:col-span-1 lg:mt-0">
        {e.tool && (
          <div className="rounded border border-ink-700 bg-ink-950/70 px-2 py-1 font-mono text-[10.5px]">
            <div className="flex items-center gap-2">
              <span className="text-[#a9c7ea]">{e.tool.name}</span>
              <span className="tnum ml-auto text-ink-400">{ms(e.tool.duration_ms)}</span>
              {e.tool.service?.machine && <span className="text-ink-500">{e.tool.service.machine}</span>}
            </div>
            <div className="truncate text-ink-400" title={JSON.stringify(e.tool.args)}>
              {compactArgs(e.tool.args)}
            </div>
            {e.tool.result && <div className="text-ink-200">→ {e.tool.result}</div>}
          </div>
        )}
        <div className="hidden lg:block">
          <Changes changes={e.changes} />
        </div>
      </div>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-500">{label}</span>
      <span className="tnum font-mono text-[11.5px] text-ink-100">{value}</span>
    </div>
  );
}

export function TracePanel({
  run,
  now,
  selectedAnalysis,
  onOpenAnalysis,
}: {
  run: RunState | null;
  now: number;
  selectedAnalysis: string | null;
  onOpenAnalysis: (cameraId: string, analysisId: string) => void;
}) {
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const trace = run?.trace ?? [];

  useEffect(() => {
    const el = listRef.current;
    if (!follow || !el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => (programmatic.current = false));
    return () => cancelAnimationFrame(id);
  }, [trace.length, follow]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el || programmatic.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && follow) setFollow(false);
  };

  const m = run?.metrics;
  return (
    <section className="panel flex h-full min-h-0 flex-col">
      <header className="panel-header flex-wrap">
        <ScrollText size={13} className="text-ink-400" />
        <span>Live agent trace</span>
        {run && <span className="font-mono text-[10px] normal-case tracking-normal text-ink-500">run {run.run_id}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 normal-case tracking-normal">
          <Metric label="Steps" value={run?.step ?? 0} />
          <Metric label="Vision calls" value={m?.vision_calls ?? 0} />
          <Metric label="Vision time" value={m ? ms(m.vision_ms) : '—'} />
          <Metric label="Re-analyses" value={m?.reanalyses ?? 0} />
          <Metric label="Faults" value={m?.faults ?? 0} />
          <Metric label="Elapsed" value={elapsed(runElapsed(run, now))} />
          <button
            type="button"
            onClick={() => setFollow((f) => !f)}
            className={cx('flex items-center gap-1 rounded border px-1.5 py-[1px] text-[10.5px]', follow ? 'border-info-soft/60 text-[#a9c7ea]' : 'border-ink-600 text-ink-400')}
          >
            {follow ? <ArrowDownToLine size={11} /> : <Pause size={11} />}
            {follow ? 'Auto-scroll' : 'Paused'}
          </button>
        </div>
      </header>
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {trace.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-ink-400">
            Each agent step appears here with its phase, the tool it called, the measured result, what changed in the belief or the twin, and why it chose
            that step.
          </div>
        ) : (
          <ol>
            {trace.map((e, i) => {
              const open = isPerceiveAnalysis(e) ? () => onOpenAnalysis(String(e.data.camera_id ?? ''), String(e.data.analysis_id)) : undefined;
              return <TraceRow key={e.step} e={e} latest={i === trace.length - 1} active={!!selectedAnalysis && e.data?.analysis_id === selectedAnalysis} onOpen={open} />;
            })}
          </ol>
        )}
        {run?.error && <div className="border-t border-threat-soft/50 bg-threat-dim/40 px-3 py-2 text-[12px] text-[#f0c4c6]">Agent error: {run.error}</div>}
      </div>
    </section>
  );
}
