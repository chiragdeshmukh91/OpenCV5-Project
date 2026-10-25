import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, ChevronDown, Cloud, Loader2, Menu, Play, Settings, SlidersHorizontal, Square, UserRound, Zap } from 'lucide-react';
import type { RunState, Scenario, Status } from '../types';
import { cx } from './ui';
import { Dot } from './viz';

/** Click/keyboard popover that closes on outside click or Escape. */
export function Popover({
  button,
  children,
  label,
  align = 'right',
  width = 'w-80',
}: {
  button: (open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  label: string;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="block">
        {button(open)}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={cx(
            'fade-in absolute top-[calc(100%+8px)] z-[80] rounded-xl border border-accent/20 bg-ink-850/95 p-3 text-[11.5px] shadow-2xl shadow-black/70 backdrop-blur-xl',
            width,
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {typeof children === 'function' ? children(close) : children}
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
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const cur = scenarios.find((s) => s.id === value);
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      setActive(Math.max(0, scenarios.findIndex((s) => s.id === value)));
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(scenarios.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (scenarios[active]) onChange(scenarios[active].id);
      setOpen(false);
    }
  };
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        title={cur?.summary}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Scenario"
        className="flex h-9 w-[200px] max-w-full items-center gap-2 rounded-lg min-[1440px]:w-[250px] border border-ink-600 bg-ink-900/70 px-3 text-left text-[12.5px] text-ink-100 transition-colors hover:border-accent/50 disabled:opacity-50 min-[1700px]:w-[330px]"
      >
        <span className="hidden shrink-0 text-ink-400 min-[1440px]:inline">Scenario:</span>
        <span className="truncate">{cur?.title ?? 'Select scenario'}</span>
        <ChevronDown size={14} className="ml-auto shrink-0 text-ink-400" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Scenarios" className="fade-in absolute left-0 top-[calc(100%+8px)] z-[80] w-[440px] max-w-[90vw] overflow-hidden rounded-xl border border-accent/20 bg-ink-850/95 py-1 shadow-2xl shadow-black/70 backdrop-blur-xl">
          {scenarios.map((s, i) => (
            <li key={s.id} role="option" aria-selected={s.id === value}>
              <button
                type="button"
                title={s.summary}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
                className={cx('block w-full px-3 py-2 text-left transition-colors', i === active ? 'bg-accent/10' : '', s.id === value && 'border-l-2 border-accent')}
              >
                <div className="font-mono text-[10px] text-ink-400">{s.id}</div>
                <div className="text-[12.5px] font-medium text-ink-100">{s.title}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-ink-300">{s.summary}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SystemDetails({ status, statusError }: { status: Status | null; statusError: string | null }) {
  const v = status?.vision;
  const aws = status?.aws;
  return (
    <div className="space-y-2.5">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">OpenCV vision service</div>
        <KV k="Mode" v={v?.mode} />
        <KV k="Endpoint" v={v?.endpoint} />
        <KV k="Reachable" v={yn(v?.reachable)} />
        <KV k="Latency" v={v?.latency_ms != null ? `${v.latency_ms} ms` : '—'} />
        <KV k="Machine" v={v?.machine} />
        <KV k="arm64 / Graviton" v={`${yn(v?.arm64)} / ${yn(v?.graviton)}`} />
        <KV k="On AWS" v={yn(v?.on_aws)} />
        <KV k="OpenCV" v={v?.opencv?.version_control ?? v?.opencv?.version} />
        <KV k="Detector" v={status?.detector.model} />
        <KV k="Weapon model" v={status?.detector.weapon_model ?? 'none (COCO weapon-like)'} />
        <KV k="Analyses / errors" v={v?.counters ? `${v.counters.analyses ?? 0} / ${v.counters.errors ?? 0}` : '—'} />
        {v?.error && <div className="mt-1 text-caution-bright">{v.error}</div>}
        {statusError && <div className="mt-1 text-caution-bright">Status endpoint: {statusError}</div>}
      </div>
      <div className="border-t border-ink-700 pt-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">AWS</div>
        <KV k="Connected" v={yn(aws?.connected)} />
        {!aws?.connected && <KV k="Reason" v={aws?.reason} />}
        <KV k="Region" v={aws?.region} />
        <KV k="S3 bucket" v={aws?.s3_bucket ?? 'not configured'} />
        <KV k="CloudWatch" v={yn(aws?.cloudwatch)} />
      </div>
      <div className="border-t border-ink-700 pt-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">COOL acceleration</div>
        <KV k="State" v={v?.cool?.state} />
        {v?.cool?.note && <div className="mt-1 leading-snug text-ink-300">{v.cool.note}</div>}
      </div>
    </div>
  );
}

function Indicator({ icon, label, value, tone, detail }: { icon: ReactNode; label: string; value: string; tone: 'clear' | 'caution' | 'muted' | 'info'; detail: ReactNode }) {
  return (
    <div className="group relative">
      <div tabIndex={0} className="flex h-8 cursor-default items-center gap-1.5 rounded-lg px-2 text-[12px] outline-none transition-colors hover:bg-ink-800/70 focus-visible:bg-ink-800/70">
        <Dot tone={tone} />
        <span className="hidden text-ink-400 min-[1700px]:inline">{icon}</span>
        <span className="text-ink-300">{label}</span>
        {value && <span className="hidden text-ink-100 min-[1440px]:inline">{value}</span>}
      </div>
      <div className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-[80] w-72 rounded-xl border border-accent/20 bg-ink-850/95 p-3 text-[11.5px] opacity-0 shadow-2xl backdrop-blur-xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        {detail}
      </div>
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
  onMenu,
  onOpenEvidence,
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
  onMenu: () => void;
  onOpenEvidence: () => void;
}) {
  const active = !!run && (run.status === 'running' || run.status === 'awaiting_review');
  const v = status?.vision;
  const aws = status?.aws;
  const online = !!status && !!v?.reachable;
  const coolState = v?.cool?.state ?? (status ? 'unknown' : '…');
  const tasks = run?.verification_tasks ?? [];
  const gaps = run?.gaps ?? [];
  const alertCount = tasks.length + gaps.filter((g) => !tasks.some((t) => t.camera_id === g.camera_id)).length;

  return (
    <header className="relative z-40 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-accent/10 bg-[rgba(4,11,22,0.82)] px-4 py-2.5 backdrop-blur-xl">
      <button type="button" onClick={onMenu} aria-label="Toggle navigation" className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100 wide:hidden">
        <Menu size={18} />
      </button>
      <div className="flex items-center gap-3 pr-1">
        <svg width="34" height="36" viewBox="0 0 32 34" aria-hidden className="drop-shadow-[0_0_8px_rgba(34,211,238,0.55)]">
          <path d="M16 1.5 29 6v9.4c0 8-5.3 14.2-13 16.9C8.3 29.6 3 23.4 3 15.4V6z" fill="#061626" stroke="#22d3ee" strokeWidth="1.8" />
          <path d="M16 6.5 25 9.6v6c0 5.4-3.6 9.7-9 11.7-5.4-2-9-6.3-9-11.7v-6z" fill="none" stroke="#22d3ee" strokeOpacity=".35" />
          <path d="M11 16.5l3.4 3.4 6.6-7.2" fill="none" stroke="#5eead4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="leading-tight">
          <div className="text-[18px] font-bold tracking-[0.2em] text-ink-100">CLEARPATH</div>
          <div className="whitespace-nowrap text-[11px] text-ink-300">AI-Powered School Safety</div>
        </div>
      </div>

      <div
        className="ml-2 flex h-9 items-center gap-2 rounded-full border border-clear/50 bg-clear-dim/80 px-3 text-[12.5px] font-medium text-clear-bright shadow-glow-green"
        title="Simulation — synthetic footage, simulated reports, no real alerts are sent"
        role="status"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-clear/90 text-[9px] font-bold text-ink-950">S</span>
        <span className="hidden min-[1366px]:inline">Simulation Mode</span>
        <span className="min-[1366px]:hidden">Simulation</span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <ScenarioSelect scenarios={scenarios} value={scenarioId} onChange={onScenario} disabled={!scenarios.length} />
        <button type="button" onClick={onRun} disabled={!scenarioId || starting} className="btn-primary h-9 px-3">
          {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {active ? 'Restart' : 'Run'}
        </button>
        <button type="button" onClick={onCancel} disabled={!active} className="btn-ghost h-9" aria-label="Cancel run">
          <Square size={12} />
          <span className="hidden min-[1440px]:inline">Cancel</span>
        </button>
        <button
          type="button"
          onClick={onToggleInputs}
          aria-pressed={inputsOpen}
          className={cx('btn-ghost h-9', inputsOpen && 'border-accent/60 text-accent-bright')}
          title="Scenario inputs: per-camera clip overrides and uploads"
          aria-label="Scenario inputs"
        >
          <SlidersHorizontal size={14} />
          <span className="hidden min-[1440px]:inline">Inputs</span>
          {overrideCount > 0 && <span className="tnum rounded bg-accent/20 px-1 text-[10px] text-accent-bright">{overrideCount}</span>}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Indicator
          icon={null}
          label="System"
          value={online ? 'Online' : status ? 'Vision offline' : statusError ? 'Unreachable' : 'Connecting'}
          tone={online ? 'clear' : status ? 'caution' : 'muted'}
          detail={<SystemDetails status={status} statusError={statusError} />}
        />
        <Indicator
          icon={<Cloud size={13} />}
          label="AWS"
          value={!aws ? '…' : aws.connected ? 'connected' : 'offline'}
          tone={aws?.connected ? 'clear' : 'muted'}
          detail={
            <div>
              <KV k="Connected" v={yn(aws?.connected)} />
              {!aws?.connected && <KV k="Reason" v={aws?.reason} />}
              <KV k="Region" v={aws?.region} />
              <KV k="S3 bucket" v={aws?.s3_bucket ?? 'not configured'} />
              <KV k="CloudWatch" v={yn(aws?.cloudwatch)} />
            </div>
          }
        />
        <Indicator
          icon={<Zap size={13} />}
          label="COOL"
          value={coolState.replace(/_/g, ' ')}
          tone={coolState === 'active' || coolState === 'in_use' ? 'clear' : 'muted'}
          detail={
            <div>
              <KV k="State" v={coolState} />
              {v?.cool?.note && <div className="mt-1 leading-snug text-ink-300">{v.cool.note}</div>}
            </div>
          }
        />
        <span className="mx-1 h-6 w-px bg-ink-700" aria-hidden />
        <Popover
          label={`Verification tasks and coverage gaps (${alertCount})`}
          button={(open) => (
            <span className={cx('relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100', open && 'bg-ink-800 text-ink-100')}>
              <Bell size={17} />
              {alertCount > 0 && (
                <span className="tnum absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-threat px-1 text-[9.5px] font-bold text-white shadow-glow-red">{alertCount}</span>
              )}
            </span>
          )}
        >
          {(close) => (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">Verification tasks & coverage gaps</div>
              {!run && <div className="text-ink-400">No run yet.</div>}
              {run && tasks.length === 0 && gaps.length === 0 && <div className="text-ink-400">No open tasks or gaps in this run.</div>}
              <ul className="space-y-1.5">
                {tasks.map((t, i) => (
                  <li key={`t${i}`} className="flex gap-2">
                    <span className={cx('tag', t.priority === 'high' ? 'border-threat/50 text-threat-bright' : 'border-caution/50 text-caution-bright')}>{t.priority}</span>
                    <span className="text-ink-200">{t.task}</span>
                  </li>
                ))}
                {gaps.map((g, i) => (
                  <li key={`g${i}`} className="flex gap-2">
                    <span className="tag border-ink-500 text-ink-300">gap</span>
                    <span className="text-ink-200">
                      {g.camera_id} / {g.zone}: {g.issues.map((x) => x.replace(/_/g, ' ')).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
              {run && (tasks.length > 0 || gaps.length > 0) && (
                <button
                  type="button"
                  className="btn-ghost mt-2.5 w-full"
                  onClick={() => {
                    close();
                    onOpenEvidence();
                  }}
                >
                  Open Evidence
                </button>
              )}
            </div>
          )}
        </Popover>
        <Popover
          label="System status details"
          button={(open) => (
            <span className={cx('flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100', open && 'bg-ink-800 text-ink-100')}>
              <Settings size={17} />
            </span>
          )}
        >
          <SystemDetails status={status} statusError={statusError} />
        </Popover>
        <span className="mx-1 h-6 w-px bg-ink-700" aria-hidden />
        <div className="hidden items-center gap-2 pl-1 min-[1440px]:flex" title="No authentication in this demo; all actions are simulated">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 bg-accent-dim text-accent-bright">
            <UserRound size={15} />
          </span>
          <div className="leading-tight">
            <div className="text-[12px] text-ink-100">Operator</div>
            <div className="text-[10.5px] text-ink-400">Simulation</div>
          </div>
        </div>
      </div>
    </header>
  );
}
