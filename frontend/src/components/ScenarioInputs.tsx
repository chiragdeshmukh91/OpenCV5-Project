import { useRef, useState } from 'react';
import { Loader2, RotateCcw, Upload } from 'lucide-react';
import type { Building, FootageResponse, Scenario } from '../types';
import { api } from '../api';
import { Chip, cx } from './ui';

export function ScenarioInputs({
  building,
  scenario,
  footage,
  overrides,
  onChange,
  onUploaded,
}: {
  building: Building | null;
  scenario: Scenario | undefined;
  footage: FootageResponse | null;
  overrides: Record<string, string>;
  onChange: (o: Record<string, string>) => void;
  onUploaded: () => void;
}) {
  const [uploadCam, setUploadCam] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const clipIds = [...Object.keys(footage?.clips ?? {}).sort(), ...(footage?.uploads ?? [])];
  const cams = building?.cameras ?? [];

  const setClip = (cid: string, clip: string) => {
    const next = { ...overrides };
    if (!clip || clip === scenario?.cameras[cid]) delete next[cid];
    else next[cid] = clip;
    onChange(next);
  };

  const doUpload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const { clip_id } = await api.upload(file);
      onUploaded();
      if (uploadCam) setClip(uploadCam, clip_id);
      setMsg(`Uploaded as ${clip_id}${uploadCam ? ` → ${uploadCam}` : ''}. User footage is analysed exactly like synthetic clips.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fade-in border-b border-ink-700/80 bg-ink-900/95 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">Scenario inputs</div>
        <div className="text-[11.5px] text-ink-400">
          Feed different footage to any camera for the next run. Defaults come from {scenario ? <span className="font-mono">{scenario.id}</span> : 'the scenario'}.
        </div>
        <button type="button" className="btn-ghost ml-auto py-1" onClick={() => onChange({})} disabled={!Object.keys(overrides).length}>
          <RotateCcw size={12} /> Reset to scenario
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {cams.map((c) => {
          const def = scenario?.cameras[c.id] ?? '';
          const val = overrides[c.id] ?? def;
          const changed = c.id in overrides;
          return (
            <div key={c.id} className={cx('rounded-md border bg-ink-850 p-2', changed ? 'border-info-soft/60' : 'border-ink-700')}>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[11px] font-semibold text-ink-100">{c.id}</span>
                <span className="truncate text-[10.5px] text-ink-400">{c.name}</span>
                {changed && <Chip tone="info" className="ml-auto !px-1 !text-[9px]">override</Chip>}
              </div>
              <select className="input w-full py-1 font-mono text-[11px]" value={val} onChange={(e) => setClip(c.id, e.target.value)}>
                {clipIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                    {id === def ? ' (scenario)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="text-ink-400">Upload a video clip</span>
        <select className="input py-1" value={uploadCam} onChange={(e) => setUploadCam(e.target.value)} aria-label="Assign upload to camera">
          <option value="">(don’t assign)</option>
          {cams.map((c) => (
            <option key={c.id} value={c.id}>
              assign to {c.id}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.avi,.mp4,.mov,.mkv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doUpload(f);
          }}
        />
        <button type="button" className="btn-ghost py-1" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Choose file…
        </button>
        {msg && <span className="text-ink-300">{msg}</span>}
      </div>
    </div>
  );
}
