import { Camera as CameraIcon, Crosshair } from 'lucide-react';
import type { Analysis, Building, CameraState, Evidence, RunState } from '../types';
import { api } from '../api';
import { CameraPlayer } from './CameraPlayer';
import { Chip, Panel, Stat, cx, type Tone } from './ui';
import { effectiveCameraStatus, enhanceLabel, ms, num, pct } from '../lib/format';

export const ACTIVITY_TEXT: Record<string, { label: string; tone: Tone }> = {
  flight: { label: 'people fleeing', tone: 'threat' },
  agitated: { label: 'rapid movement', tone: 'caution' },
  calm: { label: 'calm', tone: 'clear' },
  empty: { label: 'clear (empty)', tone: 'clear' },
  congested: { label: 'congested', tone: 'caution' },
  unusable: { label: 'unusable', tone: 'muted' },
};

export const CAMERA_STATUS_TONE: Record<string, Tone> = {
  idle: 'muted',
  analyzing: 'info',
  analyzed: 'clear',
  pending_recheck: 'caution',
  fault: 'neutral',
};

function AnalysisMetrics({ a, ev }: { a: Analysis; ev?: Evidence }) {
  const m = a.motion;
  const p = a.persons;
  const q = a.quality;
  const t = a.timings ?? {};
  const svc = a.service ?? {};
  const consistency = ev?.consistency;
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 min-[1500px]:grid-cols-4">
        <Stat label="People" value={p ? `${num(p.count_median, 0)}` : '—'} sub={p ? `max ${p.count_max} · ${p.tracks} tracks` : undefined} />
        <Stat
          label="Speed BH/s"
          value={m?.speed_bh_s_median != null ? num(m.speed_bh_s_median) : '—'}
          sub={`flow ${num(m?.speed_bh_s_flow ?? null)}`}
          tone={m?.speed_bh_s_median != null && m.speed_bh_s_median >= 2 ? 'caution' : undefined}
        />
        <Stat label="Running" value={pct(m?.running_fraction)} tone={(m?.running_fraction ?? 0) >= 0.5 ? 'caution' : undefined} />
        <Stat label="Coherence" value={num(m?.coherence)} sub={m?.direction_image_deg != null ? `dir ${m.direction_image_deg.toFixed(0)}° img` : 'no direction'} />
        <Stat label="Reliability" value={num(q?.reliability)} tone={(q?.reliability ?? 1) < 0.5 ? 'caution' : 'clear'} />
        <Stat label="Total" value={ms(t.total_ms)} sub={`${a.frames_analyzed ?? a.frame_urls.length} frames`} />
        <Stat label="DNN" value={ms(t.detect_ms)} sub={`${a.detector?.inferences ?? '—'} inferences`} />
        <Stat label="Optical flow" value={ms(t.flow_ms)} sub={`bg-sub ${ms(t.bgsub_ms)}`} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(q?.issues.length ?? 0) === 0 ? (
          <Chip tone="clear">no quality issues</Chip>
        ) : (
          q!.issues.map((i) => (
            <Chip key={i} tone="caution">
              {i.replace(/_/g, ' ')}
            </Chip>
          ))
        )}
        {consistency?.checked && (
          <Chip
            tone={consistency.consistent ? 'clear' : 'caution'}
            title={`speed ratio ${consistency.speed_ratio}, direction gap ${consistency.direction_gap_deg ?? '—'}°`}
          >
            track vs flow {consistency.consistent ? 'consistent' : 'inconsistent'}
          </Chip>
        )}
        {(a.weapon_like?.length ?? 0) > 0 && <Chip tone="caution">{a.weapon_like!.length} weapon-like det.</Chip>}
      </div>
      <div className="grid grid-cols-2 gap-x-3 font-mono text-[10.5px] text-ink-400">
        <div className="truncate" title={a.footage_source}>
          enhance <span className="text-ink-200">{enhanceLabel(a.params?.enhance)}</span> · every{' '}
          <span className="text-ink-200">{a.params?.detect_every}</span> · conf <span className="text-ink-200">{a.params?.conf ?? '—'}</span>
        </div>
        <div className="truncate text-right" title={JSON.stringify(svc)}>
          ran on <span className="text-ink-200">{svc.machine ?? '?'}</span>
          {svc.on_aws ? ` · ${svc.instance_type ?? 'AWS'}` : ' · local'} · OpenCV <span className="text-ink-200">{svc.opencv_version ?? '?'}</span>
        </div>
        <div className="truncate">
          detector <span className="text-ink-200">{a.detector?.model ?? '—'}</span>
        </div>
        <div className="truncate text-right">
          COOL <span className="text-ink-200">{svc.cool ?? '—'}</span> · {a.analysis_id}
        </div>
      </div>
    </div>
  );
}

const SHORT_ACTIVITY: Record<string, string> = {
  flight: 'fleeing',
  agitated: 'rapid',
  calm: 'calm',
  empty: 'empty',
  congested: 'congested',
  unusable: 'unusable',
};

const TONE_TEXT: Record<string, string> = {
  threat: 'text-[#e3888c]',
  caution: 'text-[#e6bd6e]',
  clear: 'text-[#7fd3bd]',
  muted: 'text-ink-400',
  info: 'text-[#a9c7ea]',
  neutral: 'text-ink-300',
};

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-ink-500',
  analyzing: 'bg-info pulse-soft',
  analyzed: 'bg-clear',
  pending_recheck: 'bg-caution',
  fault: 'bg-ink-300',
};

function CameraTile({
  id,
  name,
  state,
  status,
  thumb,
  selected,
  onClick,
}: {
  id: string;
  name: string;
  status: string;
  state?: CameraState;
  thumb: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const st = status;
  const act = state?.activity ? ACTIVITY_TEXT[state.activity] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${id} · ${name} — ${st.replace('_', ' ')}${act ? ` · ${act.label}` : ''}`}
      className={cx(
        'group flex min-w-0 flex-col overflow-hidden rounded-md border bg-ink-850 text-left transition-colors',
        selected ? 'border-info-soft ring-1 ring-info-soft/50' : 'border-ink-700 hover:border-ink-500',
      )}
    >
      <div className="relative aspect-[4/3] w-full bg-black">
        {thumb && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className={cx('h-full w-full object-cover transition-opacity', st === 'idle' ? 'opacity-50' : 'opacity-90', st === 'fault' && 'grayscale')}
          />
        )}
        {st === 'analyzing' && <span className="pulse-soft absolute inset-0 border-2 border-info/70" />}
        {st === 'pending_recheck' && <span className="absolute inset-0 border-2 border-caution/70" />}
      </div>
      <div className="flex min-w-0 flex-col px-1 py-0.5">
        <div className="flex items-center gap-1">
          <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[st])} />
          <span className="font-mono text-[10px] font-semibold text-ink-100">{id.replace('CAM-', 'C')}</span>
        </div>
        <div className={cx('truncate text-[9.5px] leading-3', act ? TONE_TEXT[act.tone] : 'text-ink-500')}>
          {state?.activity ? SHORT_ACTIVITY[state.activity] : st === 'fault' ? 'fault' : st === 'analyzing' ? 'analyzing' : '—'}
        </div>
      </div>
    </button>
  );
}

export function CameraWall({
  building,
  run,
  scenarioClips,
  selectedCamera,
  selectedAnalysis,
  onSelectCamera,
  onSelectAnalysis,
  follow,
  onToggleFollow,
}: {
  building: Building | null;
  run: RunState | null;
  scenarioClips: Record<string, string>;
  selectedCamera: string | null;
  selectedAnalysis: string | null;
  onSelectCamera: (cid: string) => void;
  onSelectAnalysis: (aid: string) => void;
  follow: boolean;
  onToggleFollow: () => void;
}) {
  const cams = building?.cameras ?? [];
  const cam = cams.find((c) => c.id === selectedCamera) ?? cams[0];
  const analyses = run ? Object.values(run.analyses).filter((a) => a.camera_id === cam?.id) : [];
  const analysis = analyses.find((a) => a.analysis_id === selectedAnalysis) ?? analyses[analyses.length - 1] ?? null;
  const state = cam && run ? run.cameras[cam.id] : undefined;
  const clipFor = (cid: string) => run?.camera_clips[cid] ?? scenarioClips[cid] ?? null;
  const clip = cam ? clipFor(cam.id) : null;

  const thumbFor = (cid: string): string | null => {
    if (run) {
      const as = Object.values(run.analyses).filter((a) => a.camera_id === cid);
      const last = as[as.length - 1];
      if (last && last.frame_urls.length) return last.frame_urls[last.frame_urls.length - 1];
    }
    const c = clipFor(cid);
    return c ? api.previewUrl(c) : null;
  };

  return (
    <Panel
      title="Camera wall"
      icon={<CameraIcon size={13} />}
      className="h-full"
      bodyClassName="flex-1 overflow-y-auto scroll-thin"
      right={
        <button
          type="button"
          onClick={onToggleFollow}
          title="Automatically show the camera the agent is analysing"
          className={cx('flex items-center gap-1 rounded border px-1.5 py-[1px] text-[10.5px]', follow ? 'border-info-soft/60 text-[#a9c7ea]' : 'border-ink-600 text-ink-400')}
        >
          <Crosshair size={11} />
          Follow agent
        </button>
      }
    >
      <div className="space-y-3 p-3">
        <CameraPlayer
          camera={cam}
          state={state && { ...state, status: effectiveCameraStatus(run, state.id) as CameraState['status'] }}
          analyses={analyses}
          analysis={analysis}
          onSelectAnalysis={onSelectAnalysis}
          previewUrl={clip ? api.previewUrl(clip) : null}
        />
        <div>
          <div className="label mb-1 flex items-center justify-between">
            <span>All cameras</span>
            <span className="hidden items-center gap-2 normal-case tracking-normal text-ink-500 min-[1500px]:flex">
              {(['idle', 'analyzing', 'analyzed', 'pending_recheck', 'fault'] as const).map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[k].replace(' pulse-soft', ''))} />
                  {k === 'pending_recheck' ? 'recheck' : k}
                </span>
              ))}
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cams.map((c) => (
              <CameraTile
                key={c.id}
                id={c.id}
                name={c.name}
                state={run?.cameras[c.id]}
                status={effectiveCameraStatus(run, c.id)}
                thumb={thumbFor(c.id)}
                selected={c.id === cam?.id}
                onClick={() => onSelectCamera(c.id)}
              />
            ))}
          </div>
        </div>
        {analysis ? (
          <AnalysisMetrics a={analysis} ev={state?.evidence?.analysis_id === analysis.analysis_id ? state.evidence : undefined} />
        ) : (
          <div className="rounded-md border border-dashed border-ink-700 px-3 py-2 text-[11.5px] text-ink-400">
            Measured metrics appear here once the agent analyses this camera with OpenCV.
          </div>
        )}
        {state?.evidence && (
          <div className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-[11.5px]">
            <div className="label mb-0.5">Agent interpretation</div>
            <div className="text-ink-100">{state.evidence.activity_label ?? state.evidence.activity}</div>
            {state.evidence.flight_heading_deg != null && (
              <div className="tnum mt-0.5 text-ink-300">
                Flight heading {state.evidence.flight_heading_deg.toFixed(0)}° (map) → hazard toward {state.evidence.source_heading_deg?.toFixed(0)}°
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
