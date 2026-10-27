// Landing / overview shown on every open or refresh. It never resumes a stale incident on its own:
// an existing backend run is offered explicitly ("Resume") next to starting a new analysis.
import { AlertTriangle, Camera, CheckCircle2, Loader2, MapPinned, Play, RefreshCw, ScanSearch, ShieldCheck, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import type { RunState } from '../types';
import { pendingObservations } from '../lib/observations';
import { procedureText } from '../lib/derive';
import { cx } from './ui';

export const WORKFLOW = [
  { key: 'select', label: 'Select footage', icon: Camera, text: 'Pick a scenario: a simulated report plus the clip each camera plays.' },
  { key: 'analyze', label: 'Analyze', icon: ScanSearch, text: 'The agent runs OpenCV on the cameras it judges most informative.' },
  { key: 'inspect', label: 'Inspect detections', icon: ShieldCheck, text: 'Open the footage: boxes, running tracks, key frame and timestamps.' },
  { key: 'review', label: 'Review events', icon: UserCheck, text: 'Confirm or dismiss each observation, then approve or reject the procedure.' },
  { key: 'impact', label: 'Campus impact', icon: MapPinned, text: 'See confirmed alerts, threat region and routes on the digital twin.' },
] as const;

/** Index of the current workflow step from real run state. */
export function workflowStep(run: RunState | null): number {
  if (!run) return 0;
  if (run.status === 'running' && !run.assessment) return 1;
  if (run.status === 'awaiting_review') return 3;
  if (run.status === 'complete') return 4;
  return run.assessment ? 3 : 1;
}

export function WorkflowSteps({ run, className }: { run: RunState | null; className?: string }) {
  const cur = workflowStep(run);
  return (
    <ol className={cx('grid gap-2 sm:grid-cols-5', className)} aria-label="Workflow">
      {WORKFLOW.map((s, i) => {
        const Icon = s.icon;
        const state = i < cur ? 'done' : i === cur ? 'current' : 'todo';
        return (
          <li key={s.key} aria-current={state === 'current' ? 'step' : undefined} className={cx('rounded-xl border p-3', state === 'current' ? 'border-accent bg-accent/10' : state === 'done' ? 'border-clear/30 bg-clear-dim/20' : 'border-white/10 bg-white/[0.02]')}>
            <div className="flex items-center gap-2">
              <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold', state === 'current' ? 'bg-accent text-ink-950' : state === 'done' ? 'bg-clear text-ink-950' : 'bg-ink-700 text-ink-300')}>
                {state === 'done' ? <CheckCircle2 size={13} /> : i + 1}
              </span>
              <Icon size={14} className="text-accent" />
              <span className="text-[12.5px] font-semibold text-ink-100">{s.label}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-400">{s.text}</p>
          </li>
        );
      })}
    </ol>
  );
}

const RUN_STATUS: Record<string, string> = {
  running: 'analysis in progress',
  awaiting_review: 'waiting for your review',
  complete: 'complete',
  cancelled: 'cancelled',
  error: 'stopped on an error',
};

export function StartPage({ staticError }: { staticError: string | null }) {
  const { building, scenarios, run, scenarioId, setScenarioId, startRun, starting, navigate, status, openReview } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const loading = !building || !scenarios.length;

  const start = async () => {
    setErr(null);
    const ok = await startRun(scenarioId);
    if (ok) navigate('operations');
    else setErr('The analysis could not be started. Check the message above and retry.');
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 p-4 lg:p-6">
      <section className="rounded-2xl border border-accent/15 bg-[rgba(5,14,27,0.66)] p-5">
        <h1 className="text-[22px] font-semibold tracking-wide text-ink-100">Start a CLEARPATH analysis</h1>
        <p className="mt-1.5 max-w-[820px] text-[13px] leading-relaxed text-ink-300">
          CLEARPATH analyses camera footage with OpenCV, turns it into observations and candidate events, and asks a human to confirm where they happened
          before anything is placed on the campus map. <span className="text-caution-bright">Simulation only. No real alert, notification or door command is ever sent.</span>
        </p>
        <div className="mt-3 grid gap-2 text-[12px] md:grid-cols-2">
          <div className="flex gap-2 rounded-lg border border-caution/30 bg-caution-dim/20 p-2.5 text-ink-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-caution" />
            <span>
              <b>No firearm detection.</b> The detector is YOLOX-S (COCO-80), which has no firearm class, and no weapon model is configured
              {status?.detector.weapon_model ? ` (configured: ${status.detector.weapon_model})` : ''}. Firearm claims come only from the simulated report.
            </span>
          </div>
          <div className="flex gap-2 rounded-lg border border-info/30 bg-info-dim/20 p-2.5 text-ink-200">
            <MapPinned size={15} className="mt-0.5 shrink-0 text-info" />
            <span>
              <b>Footage is not from this school.</b> Clips are recomposited from OpenCV’s outdoor sample video (vtest.avi). The location of what a camera sees is therefore
              shown as <i>unknown</i> until you confirm it.
            </span>
          </div>
        </div>
      </section>

      <WorkflowSteps run={null} />

      {run && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="Existing run">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-ink-400">Existing run on the server</div>
            <div className="mt-0.5 text-[13.5px] font-semibold text-ink-100">{run.scenario.title}</div>
            <div className="text-[12px] text-ink-300">
              {RUN_STATUS[run.status] ?? run.status} · started {new Date(run.started_at * 1000).toLocaleTimeString()}
              {run.assessment ? ` · recommendation ${procedureText(run.approved_option ?? run.assessment.recommended)}` : ''}
              {run.status === 'awaiting_review' && pendingObservations(run).length ? ` · ${pendingObservations(run).length} observations to review` : ''}
            </div>
          </div>
          <button type="button" className="btn-ghost py-2" onClick={() => navigate('operations')}>
            Open this run
          </button>
          {run.status === 'awaiting_review' && (
            <button type="button" className="btn-warn py-2" onClick={() => { navigate('operations'); openReview(null); }}>
              <UserCheck size={14} /> Resume review
            </button>
          )}
          <p className="w-full text-[11px] text-ink-500">Starting a new analysis below cancels a run that is still in progress or awaiting review. Completed runs stay available in Incident History.</p>
        </section>
      )}

      <section aria-label="Select footage" className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-[14px] font-semibold text-ink-100">1 · Select footage</h2>
        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-300">
            {staticError ? (
              <>
                <AlertTriangle size={14} className="text-threat" /> Backend unreachable ({staticError}). Retrying automatically every 3 s.
                <button type="button" className="btn-ghost ml-2 py-1" onClick={() => window.location.reload()}>
                  <RefreshCw size={13} /> Retry now
                </button>
              </>
            ) : (
              <>
                <Loader2 size={14} className="animate-spin" /> Loading scenarios and building model…
              </>
            )}
          </div>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {scenarios.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenarioId(s.id)}
                aria-pressed={s.id === scenarioId}
                className={cx('rounded-xl border p-3 text-left transition-colors', s.id === scenarioId ? 'border-accent bg-accent/10' : 'border-white/10 hover:border-white/25')}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-400">{s.id.split('-')[0]}</span>
                  <span className="text-[13px] font-semibold text-ink-100">{s.title}</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-ink-300">{s.summary}</p>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {s.trigger.source}: “{s.trigger.claim}” · {Object.keys(s.cameras).length} cameras
                </p>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-ink-500">
          To assign your own clips to cameras, use <button type="button" className="text-accent hover:text-accent-bright" onClick={() => navigate('lab')}>Scenario Lab</button> or the Inputs button in the top bar.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4" aria-label="Analyze">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ink-100">2 · Analyze</h2>
          <p className="text-[12px] text-ink-300">About 1 minute: the agent analyses cameras one by one, then pauses for your review. Nothing is executed automatically.</p>
        </div>
        <button type="button" className="btn-primary px-5 py-2.5 text-[14px]" disabled={loading || !scenarioId || starting} onClick={() => void start()}>
          {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          Start analysis
        </button>
        {err && <p role="alert" className="w-full text-[12px] text-[#fecaca]">{err}</p>}
      </section>
    </div>
  );
}
