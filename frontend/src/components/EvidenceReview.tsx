// Full-screen evidence review: large footage with the real detections that triggered each observation,
// its location status, and the human decisions (confirm / dismiss an observation, approve / reject the
// recommended procedure). Every decision is sent to the backend and only shown once the backend reports it.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  MapPin,
  Pause,
  Play,
  ShieldAlert,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context';
import type { Analysis, Observation, ReviewAction, RunState } from '../types';
import { DET_COLORS, detectionFrames, frameTime, nextDetectionFrame } from '../lib/evidence';
import { LOCATION_LABEL, lifecycleLabel, locationText, observationsForReview, pendingObservations, weaponStatusText } from '../lib/observations';
import { clockTime, procedureText } from '../lib/derive';
import { enhanceLabel } from '../lib/format';
import { EvidenceCanvas } from './EvidenceCanvas';
import { Chip, cx } from './ui';

const DISMISS_REASONS = [
  'Footage is not from this camera or location',
  'Not an incident (drill, sports, normal rush)',
  'Detection or tracking error',
  'Other (see note)',
];

const CAMERA_ACTIVITY: Record<string, string> = {
  flight: 'People running in one direction',
  agitated: 'Rapid, incoherent movement',
  calm: 'Ordinary walking',
  congested: 'Dense crowd',
  empty: 'No people',
  unusable: 'Feed unusable',
};

function analysesFor(run: RunState, cid: string): Analysis[] {
  return Object.values(run.analyses).filter((a) => a.camera_id === cid);
}

export function EvidenceReview({ initialCamera, onClose }: { initialCamera: string | null; onClose: () => void }) {
  const { run, refresh, building } = useApp();
  const list = useMemo(() => observationsForReview(run), [run]);
  const [cid, setCid] = useState<string | null>(initialCamera ?? list[0]?.camera_id ?? null);
  const [aid, setAid] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlays, setOverlays] = useState(true);
  const [runningOnly, setRunningOnly] = useState(false);
  const [track, setTrack] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState('Safety lead');
  const [reason, setReason] = useState(DISMISS_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!cid && list.length) setCid(list[0].camera_id);
  }, [cid, list]);

  const obs: Observation | undefined = cid && run?.observations ? run.observations[cid] : undefined;
  const camAnalyses = run && cid ? analysesFor(run, cid) : [];
  const analysis = (aid && run?.analyses[aid]) || (obs?.analysis_id && run?.analyses[obs.analysis_id]) || camAnalyses[camAnalyses.length - 1] || null;
  const nFrames = analysis?.frame_urls.length ?? 0;
  const keyFrame = analysis?.key_frame ?? (obs?.key_frame ?? null);

  // Open each observation paused on its key frame so the triggering detections are visible immediately.
  useEffect(() => {
    setFrame(keyFrame ?? 0);
    setPlaying(false);
    setTrack(null);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.analysis_id]);

  useEffect(() => {
    if (!playing || nFrames < 2) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % nFrames), 1000 / (analysis?.fps || 10));
    return () => window.clearInterval(id);
  }, [playing, nFrames, analysis?.fps]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setFrame((f) => Math.min(nFrames - 1, f + 1));
      if (e.key === 'ArrowLeft') setFrame((f) => Math.max(0, f - 1));
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [nFrames, onClose]);

  if (!run) return null;
  const awaiting = run.status === 'awaiting_review' && !!run.review;
  const reassessing = run.status === 'running' && !!run.assessment;
  const pending = pendingObservations(run);
  const pendingRoutine = pending.filter((o) => o.kind !== 'candidate_event');
  const recId = run.review?.recommended ?? run.assessment?.recommended ?? null;
  const camera = building?.cameras.find((c) => c.id === cid);
  const zoneName = (z: string | null | undefined) => (z ? building?.zones.find((x) => x.id === z)?.name ?? z : '');
  const det = detectionFrames(analysis?.per_frame);
  const tracks = [...(analysis?.motion?.tracks_detail ?? [])].sort((a, b) => Number(b.running) - Number(a.running) || b.speed_bh_s - a.speed_bh_s);
  const entry = analysis ? run.trace.find((e) => e.data?.analysis_id === analysis.analysis_id) : undefined;

  const submit = async (action: ReviewAction, extra: { camera_id?: string; camera_ids?: string[]; option_id?: string; note?: string }, done: string) => {
    setBusy(action + (extra.camera_id ?? ''));
    setErr(null);
    setNotice(null);
    try {
      await api.review(run.run_id, { action, note: extra.note ?? '', reviewer: reviewer.trim() || 'Safety lead', ...extra });
      setNotice(done);
      setNote('');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const life = obs ? lifecycleLabel(obs) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Evidence review" className="fixed inset-0 z-[90] flex flex-col bg-[#02060c]/[0.97] text-ink-100 backdrop-blur">
      {/* header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <ShieldAlert size={18} className="text-caution" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Evidence review</h2>
          <p className="truncate text-[11.5px] text-ink-400">
            {run.scenario.trigger.source}: “{run.scenario.trigger.claim}” · reported zone {run.scenario.trigger.zone} (unverified report)
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-300">
            Reviewer
            <input className="input w-[150px]" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer name" />
          </label>
          <button type="button" onClick={onClose} className="btn-ghost px-2.5 py-1.5" aria-label="Close evidence review">
            <X size={15} /> Close
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[250px_minmax(0,1fr)_360px] lg:overflow-hidden">
        {/* observation list */}
        <nav aria-label="Observations" className="h-[190px] shrink-0 overflow-y-auto border-r border-white/10 p-2 scroll-thin lg:h-auto lg:min-h-0">
          <div className="mb-2 px-1 text-[10.5px] uppercase tracking-wider text-ink-400">
            Observations · {pending.length} awaiting review
          </div>
          {list.length === 0 && <p className="px-1 text-[12px] text-ink-400">No camera has been analysed yet.</p>}
          <ul className="space-y-1.5">
            {list.map((o) => {
              const a = o.analysis_id ? run.analyses[o.analysis_id] : undefined;
              const thumb = a?.frame_urls[Math.min((a.key_frame ?? 0), a.frame_urls.length - 1)];
              const l = lifecycleLabel(o);
              return (
                <li key={o.camera_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCid(o.camera_id);
                      setAid(null);
                    }}
                    aria-current={o.camera_id === cid}
                    className={cx('flex w-full gap-2 rounded-lg border p-1.5 text-left transition-colors', o.camera_id === cid ? 'border-accent bg-accent/10' : 'border-white/5 hover:border-white/20')}
                  >
                    <span className="relative h-[52px] w-[70px] shrink-0 overflow-hidden rounded bg-black">
                      {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-mono text-[11.5px] font-semibold">{o.camera_id}</span>
                      <span className="block truncate text-[11px] text-ink-300">{CAMERA_ACTIVITY[o.activity] ?? o.activity}</span>
                      <Chip tone={l.tone === 'muted' ? 'muted' : l.tone} className="mt-0.5 !whitespace-normal !text-[9.5px]">{l.label}</Chip>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* footage */}
        <section aria-label="Footage" className="flex min-h-[78vw] min-w-0 flex-col p-3 lg:min-h-[320px]">
          {analysis ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-mono font-semibold">{analysis.camera_id}</span>
                <span className="text-ink-300">{camera?.name}</span>
                {analysis.synthetic && <Chip tone="caution">SYNTHETIC FOOTAGE</Chip>}
                <span className="font-mono text-[11px] text-ink-400">clip {analysis.clip_id} · {analysis.frame_size?.join('×')} px</span>
                {camAnalyses.length > 1 && (
                  <span className="ml-auto flex overflow-hidden rounded-md border border-ink-600">
                    {camAnalyses.map((a) => (
                      <button key={a.analysis_id} type="button" onClick={() => setAid(a.analysis_id)} className={cx('px-2 py-0.5 text-[11px]', a.analysis_id === analysis.analysis_id ? 'bg-accent/25 text-accent-bright' : 'text-ink-400 hover:text-ink-200')}>
                        {enhanceLabel(a.params?.enhance)} {a.analysis_id.slice(-2)}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black">
                <EvidenceCanvas analysis={analysis} frame={frame} overlays={overlays} runningOnly={runningOnly} selectedTrack={track} className="flex h-full w-full items-center justify-center" />
                <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 font-mono text-[12px]">
                  frame {frame + 1}/{nFrames} · {frameTime(frame, analysis.fps)}
                  {frame === keyFrame && <span className="ml-2 font-sans font-semibold text-caution-bright">KEY FRAME</span>}
                  {!analysis.per_frame?.[frame]?.detected && <span className="ml-2 font-sans text-ink-400">(boxes held from last DNN frame)</span>}
                </div>
                {!overlays && <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/75 px-2 py-0.5 text-[12px] font-semibold">ORIGINAL FOOTAGE — no overlays</div>}
              </div>
              {/* transport */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setFrame(nextDetectionFrame(analysis.per_frame, frame, -1))} title="Previous DNN frame" aria-label="Previous detection frame">
                  <SkipBack size={14} />
                </button>
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setFrame((f) => Math.max(0, f - 1))} aria-label="Previous frame">
                  <ChevronLeft size={14} />
                </button>
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setFrame((f) => Math.min(nFrames - 1, f + 1))} aria-label="Next frame">
                  <ChevronRight size={14} />
                </button>
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => setFrame(nextDetectionFrame(analysis.per_frame, frame, 1))} title="Next DNN frame" aria-label="Next detection frame">
                  <SkipForward size={14} />
                </button>
                {keyFrame != null && (
                  <button type="button" className="btn-warn px-2 py-1 text-[11.5px]" onClick={() => { setPlaying(false); setFrame(keyFrame); }}>
                    <Crosshair size={13} /> Key frame
                  </button>
                )}
                <div className="relative mx-1 min-w-[140px] flex-1">
                  <input type="range" min={0} max={Math.max(0, nFrames - 1)} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} className="w-full cursor-pointer accent-[#22d3ee]" aria-label="Frame" />
                  <div className="pointer-events-none relative h-1.5">
                    {det.map((d) => (
                      <span key={d} className="absolute top-0 h-1.5 w-[2px] bg-info/70" style={{ left: `${(d / Math.max(1, nFrames - 1)) * 100}%` }} />
                    ))}
                    {keyFrame != null && <span className="absolute -top-0.5 h-2.5 w-[3px] bg-caution" style={{ left: `${(keyFrame / Math.max(1, nFrames - 1)) * 100}%` }} />}
                  </div>
                </div>
                <button type="button" className={cx('btn-ghost px-2 py-1 text-[11.5px]', overlays && 'text-accent-bright')} onClick={() => setOverlays((o) => !o)} aria-pressed={overlays}>
                  {overlays ? <Eye size={13} /> : <EyeOff size={13} />} {overlays ? 'Overlays on' : 'Original'}
                </button>
                <button type="button" className={cx('btn-ghost px-2 py-1 text-[11.5px]', runningOnly && 'text-threat-bright')} onClick={() => setRunningOnly((o) => !o)} aria-pressed={runningOnly} disabled={!overlays}>
                  Running only
                </button>
                <a className="btn-ghost px-2 py-1 text-[11.5px]" href={analysis.frame_urls[frame]} target="_blank" rel="noreferrer" title="Open this frame without overlays in a new tab">
                  <ExternalLink size={13} /> Frame
                </a>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-300">
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: DET_COLORS.running }} /> running track (counted toward “people fleeing”)</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: DET_COLORS.person }} /> person (YOLOX-S)</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: DET_COLORS.weapon }} /> weapon-like COCO object (never a firearm detection)</span>
                <span className="text-ink-500">← → step · space play · Esc close</span>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[13px] text-ink-400">Select an observation to inspect its footage.</div>
          )}
        </section>

        {/* details & decision */}
        <aside aria-label="Observation details" className="min-h-0 space-y-3 overflow-y-auto border-l border-white/10 p-3 text-[12px] scroll-thin">
          {obs && life ? (
            <>
              <div>
                <Chip tone={life.tone === 'muted' ? 'muted' : life.tone} className="!text-[11px]">{life.label}</Chip>
                <h3 className="mt-1.5 text-[15px] font-semibold">{CAMERA_ACTIVITY[obs.activity] ?? obs.activity_label}</h3>
                <p className="mt-1 leading-relaxed text-ink-200"><span className="text-ink-400">{obs.kind === 'candidate_event' ? 'Why it was flagged: ' : 'Measured: '}</span>{obs.reason}.</p>
              </div>

              <div className={cx('rounded-lg border p-2.5', obs.location.zone ? 'border-clear/40 bg-clear-dim/30' : 'border-caution/40 bg-caution-dim/25')}>
                <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-ink-400"><MapPin size={12} /> Location</div>
                <div className="mt-0.5 text-[14px] font-semibold">{locationText(obs.location)}</div>
                <div className="text-[11px] text-ink-300">
                  Status: {LOCATION_LABEL[obs.location.status]} · confidence {Math.round(obs.location.confidence * 100)}% · camera mounted in {obs.camera_zone} {zoneName(obs.camera_zone)}
                </div>
                {obs.location.reasons.length > 0 && obs.location.status !== 'unverified' && <div className="mt-1.5 text-[10.5px] text-ink-400">Why it was unverified before review:</div>}
                {obs.location.reasons.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-ink-300">
                    {obs.location.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
                <div className="mt-1 text-[11px] text-ink-400">{obs.location.basis}</div>
              </div>

              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11.5px]">
                <dt className="text-ink-400">Analysed at</dt>
                <dd className="tnum">{clockTime(entry ? run.started_at + entry.t : obs.recorded_at)} (no capture time: replayed clip)</dd>
                <dt className="text-ink-400">Selected frame</dt>
                <dd className="tnum">{frame + 1}/{nFrames} · {frameTime(frame, analysis?.fps)}{keyFrame != null ? ` · key frame ${keyFrame + 1}` : ''}</dd>
                <dt className="text-ink-400">People</dt>
                <dd className="tnum">{analysis?.persons ? `${analysis.persons.count_median} median, ${analysis.persons.count_max} max, ${analysis.persons.tracks} tracks` : '—'}</dd>
                <dt className="text-ink-400">Reliability</dt>
                <dd className="tnum">{analysis?.quality ? `${analysis.quality.reliability.toFixed(2)}${analysis.quality.issues.length ? ` · ${analysis.quality.issues.join(', ').replace(/_/g, ' ')}` : ''}` : '—'}</dd>
                <dt className="text-ink-400">Firearm</dt>
                <dd className="text-caution-bright">{weaponStatusText(obs.weapon.firearm_detector, obs.weapon.weapon_like.length)}</dd>
              </dl>

              {tracks.length > 0 && (
                <div>
                  <div className="label mb-1">Tracked people ({tracks.filter((t) => t.running).length} running)</div>
                  <ul className="max-h-[170px] space-y-0.5 overflow-y-auto pr-1 scroll-thin">
                    {tracks.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => { setTrack(track === t.id ? null : t.id); setPlaying(false); setFrame(Math.min(nFrames - 1, t.first_frame)); }}
                          className={cx('flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[11px]', track === t.id ? 'bg-white/15' : 'hover:bg-white/5')}
                        >
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: t.running ? DET_COLORS.running : DET_COLORS.person }} />
                          #{t.id}
                          <span className="tnum">{t.speed_bh_s.toFixed(2)} BH/s</span>
                          <span className={t.running ? 'text-threat-bright' : 'text-ink-400'}>{t.running ? 'running' : 'walking'}</span>
                          <span className="ml-auto text-ink-500">f{t.first_frame + 1}–{t.last_frame + 1}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10.5px] text-ink-500">Running = measured track speed above 2.0 body-heights/s. Click a track to highlight it.</p>
                </div>
              )}

              {/* decision */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="label mb-1">Human decision</div>
                {obs.review.status === 'pending' ? (
                  awaiting ? (
                    <div className="space-y-2.5">
                      <div>
                        <button type="button" className="btn-primary w-full py-2" disabled={!!busy || reassessing} onClick={() => submit('confirm_observation', { camera_id: obs.camera_id, note }, `Recorded: ${obs.camera_id} confirmed in ${obs.camera_zone}. The agent re-assessed with this observation.`)}>
                          {busy === `confirm_observation${obs.camera_id}` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          Confirm: this happened in {obs.camera_zone}
                        </button>
                        <p className="mt-1 text-[11px] leading-snug text-ink-400">
                          You assert the footage shows {obs.camera_zone} {zoneName(obs.camera_zone)}. The observation is then applied to the threat map and the recommendation is recomputed. Recorded in the timeline under your name.
                        </p>
                      </div>
                      <div className="space-y-1.5 border-t border-white/10 pt-2">
                        <select className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Dismiss reason">
                          {DISMISS_REASONS.map((r) => <option key={r}>{r}</option>)}
                        </select>
                        <input className="input w-full" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
                        <button type="button" className="btn-danger w-full py-1.5" disabled={!!busy || reassessing} onClick={() => submit('dismiss_observation', { camera_id: obs.camera_id, note: note ? `${reason} — ${note}` : reason }, `Recorded: ${obs.camera_id} dismissed (${reason}).`)}>
                          {busy === `dismiss_observation${obs.camera_id}` ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                          Dismiss observation
                        </button>
                        <p className="text-[11px] leading-snug text-ink-400">
                          Excludes this observation from the assessment, with your reason. The footage and analysis are kept. Dismissing does not stop or resolve anything in the real world.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-ink-400">{reassessing ? 'Agent re-assessing…' : 'Decisions are possible once the agent pauses for review.'}</p>
                  )
                ) : obs.review.status === 'not_required' ? (
                  <p className="text-[11.5px] text-ink-300">{obs.kind === 'fault' ? 'Camera fault: recorded as a coverage gap; nothing to confirm.' : 'Location verified from the footage metadata; applied automatically.'}</p>
                ) : (
                  <p className="text-[11.5px]">
                    <span className={obs.review.status === 'confirmed' ? 'font-semibold text-clear-bright' : 'font-semibold text-ink-200'}>{obs.review.status === 'confirmed' ? 'Confirmed' : 'Dismissed'}</span> by {obs.review.reviewer}
                    {obs.review.at ? ` at ${clockTime(obs.review.at)}` : ''}
                    {obs.review.note ? <span className="block text-ink-400">“{obs.review.note}”</span> : null}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-ink-400">No observation selected.</p>
          )}
          {notice && <div role="status" className="rounded-md border border-clear/40 bg-clear-dim/40 px-2 py-1.5 text-[11.5px] text-clear-bright">{notice}</div>}
          {err && <div role="alert" className="rounded-md border border-threat/40 bg-threat-dim/40 px-2 py-1.5 text-[11.5px] text-[#fecaca]">{err}</div>}
        </aside>
      </div>

      {/* recommendation bar */}
      <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-2.5 text-[12px]">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-400">{run.approved_option ? 'Approved (simulated)' : 'Recommended procedure'}</div>
          <div className="font-mono text-[14px] font-semibold text-accent-bright">{procedureText(run.approved_option ?? recId) || '—'}</div>
        </div>
        <div className="min-w-0 flex-1 text-[11.5px] text-ink-300">
          {(() => {
            const applied = Object.values(run.observations ?? {}).filter((o) => o.applied).length;
            if (run.belief?.localized) return `Based on the report and ${applied} applied camera observation(s); threat region ${run.belief.region.join(', ')}.`;
            if (!applied) return 'Based on the report only — no camera observation with a known location has been applied yet.';
            return `Based on the report and ${applied} applied camera observation(s); the threat is not localised.`;
          })()}
          {pending.length > 0 && <span className="ml-1 text-caution-bright">{pending.length} observation(s) still unreviewed and not used.</span>}
          {run.assessment?.no_feasible_alternative && <span className="ml-1 text-caution-bright">{run.assessment.uncertainty[0]}</span>}
        </div>
        {awaiting && pendingRoutine.length > 1 && (
          <button
            type="button"
            className="btn-ghost py-1.5 text-[11.5px]"
            disabled={!!busy || reassessing}
            title="Confirm the location of every pending routine (non-event) observation in one decision"
            onClick={() => submit('confirm_observation', { camera_ids: pendingRoutine.map((o) => o.camera_id) }, `Recorded: ${pendingRoutine.length} routine observations confirmed.`)}
          >
            <CheckCircle2 size={13} /> Confirm {pendingRoutine.length} routine observations
          </button>
        )}
        {awaiting && recId && (
          <div className="flex items-center gap-2">
            <div className="max-w-[300px] text-right text-[10.5px] leading-snug text-ink-400">
              Approve records your decision and ends the run; actions are logged as SIMULATED, nothing is sent. Reject excludes this option and the agent proposes the next one.
            </div>
            <button type="button" className="btn-primary py-2" disabled={!!busy || reassessing} onClick={() => submit('approve', { option_id: recId }, `Recorded: ${procedureText(recId)} approved (simulated).`)}>
              {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve
            </button>
            <button type="button" className="btn-danger py-2" disabled={!!busy || reassessing} onClick={() => submit('reject', { option_id: recId }, `Recorded: ${procedureText(recId)} rejected; agent re-assessing.`)}>
              {busy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Reject
            </button>
          </div>
        )}
        {reassessing && <span className="flex items-center gap-1.5 text-info-bright"><Loader2 size={13} className="animate-spin" /> Agent re-assessing…</span>}
        {run.status === 'complete' && <Chip tone="clear">Run complete · decision recorded</Chip>}
        {!awaiting && !reassessing && run.status === 'running' && <span className="flex items-center gap-1.5 text-ink-300"><AlertTriangle size={13} /> Agent still gathering evidence</span>}
        {run.action_log.length > 0 && (
          <div className="w-full" aria-label="Simulated action log">
            <div className="label mb-1">Action log — every entry is SIMULATED; nothing was sent</div>
            <ul className="max-h-[120px] space-y-0.5 overflow-y-auto rounded-md border border-ink-700 bg-ink-950/80 p-2 font-mono text-[11px] leading-relaxed text-ink-300 scroll-thin">
              {run.action_log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </footer>
    </div>
  );
}
