import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Cloud, Cpu, Loader2, Play, SlidersHorizontal, Square, Workflow, Zap } from 'lucide-react';
import type { RunState, Scenario, Status } from '../types';
import { cx } from './ui';
import { phaseStyle } from '../lib/colors';

function Pill({
  icon,
  label,
  value,
  state,
  children,
  extra,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  extra?: ReactNode;
  state: 'ok' | 'warn' | 'off' | 'busy';
  children?: ReactNode;
}) {
  const dot = { ok: 'bg-clear', warn: 'bg-caution', off: 'bg-ink-400', busy: 'bg-info pulse-soft' }[state];
  return (
    <div className="group relative">
      <div
        tabIndex={0}
        className="flex h-8 cursor-default items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2 text-[11.5px] outline-none transition-colors hover:border-ink-500 focus:border-ink-500"
      >
        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
        <span className="hidden text-ink-400 min-[1700px]:inline">{icon}</span>
        <span className="font-medium text-ink-300">{label}</span>
        <span className="tnum max-w-[220px] truncate text-ink-100">{value}</span>
        {extra && <span className="tnum hidden text-ink-400 min-[1440px]:inline">{extra}</span>}
      </div>
      {children && (
        <div className="pointer-events-none invisible absolute right-0 top-[calc(100%+6px)] z-50 w-80 rounded-lg border border-ink-600 bg-ink-850 p-3 text-[11.5px] opacity-0 shadow-2xl shadow-black/60 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          {children}
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[2px]">
      <span className="text-ink-400">{k}</span>
      <span className="tnum text-right font-mono text-[11px] text-ink-100">{v ?? '—'}</span>
    </div>
  );
}

const yn = (b: boolean | null | undefined) => (b == null ? '—' : b ? 'yes' : 'no');

function ScenarioSelect({
  scenarios,
  value,
  onChange,
  disabled,
}: {
  scenarios: Scenario[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const cur = scenarios.find((s) => s.id === value);
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={cur?.summary}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 w-[230px] max-w-full min-[1440px]:w-[300px] items-center gap-2 rounded-md border border-ink-600 bg-ink-850 px-2.5 text-left text-[12px] text-ink-100 transition-colors hover:border-ink-500 disabled:opacity-50"
      >
        <span className="font-mono text-[10.5px] text-ink-400">{cur?.id.split('-')[0] ?? '—'}</span>
        <span className="truncate">{cur?.title ?? 'Select scenario'}</span>
        <ChevronDown size={14} className="ml-auto shrink-0 text-ink-400" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="fade-in absolute left-0 top-[calc(100%+6px)] z-50 w-[440px] overflow-hidden rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-2xl shadow-black/60"
        >
          {scenarios.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === value}>
              <button
                type="button"
                title={s.summary}
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
                className={cx(
                  'block w-full px-3 py-2 text-left transition-colors hover:bg-ink-750',
                  s.id === value && 'bg-ink-800',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10.5px] text-ink-400">{s.id}</span>
                </div>
                <div className="text-[12.5px] font-medium text-ink-100">{s.title}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-ink-300">{s.summary}</div>
                <div className="mt-1 text-[10.5px] text-ink-400">
                  Trigger: {s.trigger.source} · zone {s.trigger.zone} · prior {s.trigger.confidence.toFixed(2)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopBar({
  scenarios,
  scenarioId,
  onScenario,
  onRun,
  onCancel,
  run,
  starting,
  status,
  statusError,
  inputsOpen,
  onToggleInputs,
  overrideCount,
}: {
  scenarios: Scenario[];
  scenarioId: string;
  onScenario: (id: string) => void;
  onRun: () => void;
  onCancel: () => void;
  run: RunState | null;
  starting: boolean;
  status: Status | null;
  statusError: string | null;
  inputsOpen: boolean;
  onToggleInputs: () => void;
  overrideCount: number;
}) {
  const active = run && (run.status === 'running' || run.status === 'awaiting_review');
  const v = status?.vision;
  const aws = status?.aws;
  const ocv = v?.opencv?.version;
  const visionValue = !status
    ? statusError
      ? 'unreachable'
      : '…'
    : `${v?.mode ?? '?'} · ${v?.machine ?? '?'}${v?.graviton ? ' · Graviton' : v?.on_aws ? ' · AWS' : ''}`;
  const awsValue = !aws ? '…' : aws.connected ? `connected${aws.s3_bucket ? ' · S3' : ''}${aws.cloudwatch ? ' · CW' : ''}` : 'offline';
  const coolState = v?.cool?.state ?? (status ? 'unknown' : '…');
  const ph = run ? phaseStyle(run.phase) : null;

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-700/80 bg-ink-900 px-4 py-2.5">
      <div className="flex items-center gap-3 pr-2">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#111821" stroke="#2a3542" />
          <path d="M7 22 L14 10 L18 17 L21 13 L25 22" fill="none" stroke="#3fb39a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-[0.18em] text-ink-100">CLEARPATH</div>
          <div className="hidden whitespace-nowrap text-[10.5px] text-ink-400 min-[1440px]:block">Agentic vision for school safety assessment</div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <ScenarioSelect scenarios={scenarios} value={scenarioId} onChange={onScenario} disabled={!scenarios.length} />
        <button
          type="button"
          onClick={onToggleInputs}
          className={cx('btn-ghost h-8', inputsOpen && 'border-info-soft text-[#a9c7ea]')}
          title="Scenario inputs: per-camera clip overrides and uploads"
        >
          <SlidersHorizontal size={14} />
          Inputs
          {overrideCount > 0 && <span className="tnum rounded bg-info-dim px-1 text-[10px] text-[#a9c7ea]">{overrideCount}</span>}
        </button>
        <button type="button" onClick={onRun} disabled={!scenarioId || starting} className="btn-primary h-8 px-3">
          {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {active ? 'Restart' : 'Run agent'}
        </button>
        <button type="button" onClick={onCancel} disabled={!active} className="btn-ghost h-8">
          <Square size={12} />
          Cancel
        </button>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Pill
          icon={<Cpu size={13} />}
          label="Vision"
          value={visionValue}
          extra={ocv ? `OpenCV ${ocv}` : undefined}
          state={!status ? (statusError ? 'warn' : 'off') : v?.reachable ? 'ok' : 'warn'}
        >
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">OpenCV vision service</div>
          <KV k="Mode" v={v?.mode} />
          <KV k="Endpoint" v={v?.endpoint} />
          <KV k="Reachable" v={yn(v?.reachable)} />
          <KV k="Latency" v={v?.latency_ms != null ? `${v.latency_ms} ms` : '—'} />
          <KV k="Machine" v={v?.machine} />
          <KV k="arm64 / Graviton" v={`${yn(v?.arm64)} / ${yn(v?.graviton)}`} />
          <KV k="On AWS" v={yn(v?.on_aws)} />
          <KV k="OpenCV" v={v?.opencv?.version_control ?? ocv} />
          <KV k="CPU dispatch" v={v?.opencv?.cpu_dispatched ? String(v.opencv.cpu_dispatched).split(' ').slice(-3).join(' ') : '—'} />
          <KV k="Detector" v={status?.detector.model} />
          <KV k="Weapon model" v={status?.detector.weapon_model ?? 'none (COCO weapon-like classes)'} />
          <KV k="Analyses / errors" v={v?.counters ? `${v.counters.analyses ?? 0} / ${v.counters.errors ?? 0}` : '—'} />
          {v?.error && <div className="mt-1.5 text-[#e6bd6e]">{v.error}</div>}
          {statusError && <div className="mt-1.5 text-[#e6bd6e]">Status endpoint: {statusError}</div>}
        </Pill>
        <Pill icon={<Cloud size={13} />} label="AWS" value={awsValue} state={!aws ? 'off' : aws.connected ? 'ok' : 'off'}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">AWS integration</div>
          <KV k="Connected" v={yn(aws?.connected)} />
          {!aws?.connected && <KV k="Reason" v={aws?.reason} />}
          <KV k="Region" v={aws?.region} />
          <KV k="S3 bucket" v={aws?.s3_bucket ?? 'not configured'} />
          <KV k="CloudWatch" v={yn(aws?.cloudwatch)} />
          <KV k="boto3" v={yn(aws?.boto3)} />
          <div className="mt-1.5 text-ink-400">Run archives are written to S3 only when connected.</div>
        </Pill>
        <Pill icon={<Zap size={13} />} label="COOL" value={coolState.replace(/_/g, ' ')} state={coolState === 'active' || coolState === 'in_use' ? 'ok' : 'off'}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">COOL acceleration</div>
          <KV k="State" v={coolState} />
          <KV k="Marker" v={v?.cool?.marker ?? '—'} />
          {v?.cool?.note && <div className="mt-1.5 leading-snug text-ink-300">{v.cool.note}</div>}
        </Pill>
        <div
          className="flex h-8 items-center gap-2 rounded-md border px-2.5 text-[11.5px]"
          style={ph ? { borderColor: ph.border, background: ph.bg } : { borderColor: '#1e2733' }}
        >
          <Workflow size={13} className="hidden text-ink-400 min-[1700px]:inline" />
          <span className="hidden font-medium text-ink-300 min-[1440px]:inline">Agent</span>
          {run ? (
            <>
              <span className="font-mono text-[11px] font-medium" style={{ color: ph?.fg }}>
                {run.phase}
              </span>
              <span className="text-ink-400">·</span>
              <span className={cx('text-ink-100', run.status === 'running' && 'pulse-soft')}>{run.status.replace(/_/g, ' ')}</span>
            </>
          ) : (
            <span className="text-ink-400">idle</span>
          )}
        </div>
      </div>
    </header>
  );
}
