import { Activity, Boxes, BrainCircuit, Camera, ChevronsLeft, ChevronsRight, FlaskConical, History, LayoutDashboard, Clock, ScanEye, UserCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RunState } from '../types';
import { cameraCoverage } from '../lib/derive';
import { cx } from './ui';
import { Dot } from './viz';

export type PageId = 'operations' | 'twin' | 'evidence' | 'intel' | 'lab' | 'history';

export const NAV: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'operations', label: 'Operations', icon: <LayoutDashboard size={18} /> },
  { id: 'twin', label: 'Digital Twin', icon: <Boxes size={18} /> },
  { id: 'evidence', label: 'Evidence', icon: <ScanEye size={18} /> },
  { id: 'intel', label: 'Agent Intelligence', icon: <BrainCircuit size={18} /> },
  { id: 'lab', label: 'Scenario Lab', icon: <FlaskConical size={18} /> },
  { id: 'history', label: 'Incident History', icon: <History size={18} /> },
];

export function Sidebar({
  page,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/60 wide:hidden" onClick={onCloseMobile} aria-hidden />}
      <nav
        aria-label="Primary"
        className={cx(
          'no-print z-50 flex shrink-0 flex-col border-r border-accent/10 bg-[rgba(4,11,22,0.86)] backdrop-blur-xl transition-[width,transform] duration-200',
          'fixed bottom-0 left-0 top-0 w-[220px] wide:static wide:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'wide:w-[60px]' : 'wide:w-[200px] xwide:w-[212px]',
        )}
      >
        <ul className="flex flex-col gap-1 px-2 pt-3">
          {NAV.map((n) => {
            const active = n.id === page;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(n.id);
                    onCloseMobile();
                  }}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? n.label : undefined}
                  className={cx(
                    'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-all',
                    active
                      ? 'bg-gradient-to-r from-accent/25 via-accent/10 to-transparent font-semibold text-ink-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]'
                      : 'text-ink-300 hover:bg-ink-800/70 hover:text-ink-100',
                    collapsed && 'wide:justify-center wide:px-0',
                  )}
                >
                  {active && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-accent shadow-glow-cyan" aria-hidden />}
                  <span className={cx('shrink-0', active ? 'text-accent-bright' : 'text-ink-400 group-hover:text-accent')}>{n.icon}</span>
                  <span className={cx('truncate', collapsed && 'wide:sr-only')}>{n.label}</span>
                  {collapsed && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-accent/25 bg-ink-900/95 px-2.5 py-1 text-[12px] font-medium text-ink-100 opacity-0 shadow-xl backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 wide:block"
                    >
                      {n.label}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto px-4 pb-4">
          <div className={cx('mb-3 text-[13px] leading-snug text-ink-200', collapsed && 'wide:hidden')}>
            Safer Schools.
            <br />
            Smarter Decisions.
          </div>
          <div className={cx('flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-accent', collapsed && 'wide:justify-center')}>
            <svg width="14" height="15" viewBox="0 0 32 34" aria-hidden>
              <path d="M16 1.5 29 6v9.4c0 8-5.3 14.2-13 16.9C8.3 29.6 3 23.4 3 15.4V6z" fill="none" stroke="#22d3ee" strokeWidth="3" />
            </svg>
            <span className={cx(collapsed && 'wide:hidden')}>CLEARPATH</span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="mt-3 hidden w-full items-center justify-center rounded-lg border border-ink-700 py-1 text-ink-400 hover:border-accent/40 hover:text-ink-100 wide:flex"
          >
            {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>
        </div>
      </nav>
    </>
  );
}

function Pill({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="flex h-6 items-center gap-1.5 rounded-full border border-ink-600/80 bg-ink-850/80 px-2.5 text-[11px] text-ink-200">
      {children}
    </span>
  );
}

export function StatusBar({ run, totalCameras, updatedAt, error }: { run: RunState | null; totalCameras: number; updatedAt: number | null; error: string | null }) {
  const cov = cameraCoverage(run, totalCameras);
  const running = run?.status === 'running';
  const active = run && (run.status === 'running' || run.status === 'awaiting_review');
  return (
    <footer className="no-print flex flex-wrap items-center gap-2 border-t border-accent/10 bg-[rgba(4,11,22,0.86)] px-4 py-1.5 backdrop-blur-xl">
      <Pill title="Cameras analysed in the current run">
        <Camera size={12} className="text-accent" />
        Cameras <span className="tnum font-semibold text-ink-100">{cov.analysed}/{cov.total}</span>
      </Pill>
      <Pill title="OpenCV analysis in progress">
        <Activity size={12} className={running ? 'text-accent' : 'text-ink-500'} />
        {running ? (cov.analysing ? `Analyzing ${cov.analysing}` : 'Analyzing') : 'Not analyzing'}
        {running && <Dot tone="info" pulse />}
      </Pill>
      <Pill title="Agent state">
        <UserCheck size={12} className={active ? 'text-clear' : 'text-ink-500'} />
        {run?.status === 'awaiting_review' ? 'Agent paused · awaiting review' : active ? 'Agent Active' : 'Agent Idle'}
      </Pill>
      <span className="hidden text-[11px] text-caution-bright/80 md:inline">SIMULATION — synthetic footage, simulated reports, no real alerts are sent</span>
      <span className={cx('ml-auto flex items-center gap-1.5 text-[11px]', error ? 'text-caution-bright' : 'text-ink-300')}>
        <Clock size={12} className="text-accent" />
        {error ? `Backend unreachable — retrying (${error})` : updatedAt ? `Last Updated: ${new Date(updatedAt).toLocaleTimeString()}` : 'Connecting…'}
      </span>
    </footer>
  );
}
