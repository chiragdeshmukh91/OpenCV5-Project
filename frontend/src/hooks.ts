import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { Building, FootageResponse, RunState, ScenariosResponse, Status } from './types';

export const ACTIVE_STATUSES = new Set(['running', 'awaiting_review']);

export interface RunHook {
  run: RunState | null;
  loaded: boolean;
  error: string | null;
  /** Wall-clock ms of the last successful poll. */
  updatedAt: number | null;
  /** Restart polling immediately (e.g. after starting a run or submitting a review). */
  refresh: () => void;
}

/**
 * Single polling hook for the agent run. Polls /api/runs/current every `intervalMs` while the run is
 * running or awaiting review; once it is complete / cancelled / errored, fast polling stops and only a
 * slow idle check (`idleIntervalMs`, 0 disables) runs so a run started from another client appears. Transport errors are
 * surfaced and polling continues with a gentle backoff so the UI recovers when the backend returns.
 */
export function useRun(intervalMs = 700, idleIntervalMs = 5000): RunHook {
  const [run, setRun] = useState<RunState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const failures = useRef(0);
  const generation = useRef(0);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async (gen: number) => {
    try {
      const { run: r } = await api.currentRun();
      if (gen !== generation.current) return;
      failures.current = 0;
      setError(null);
      setRun(r);
      setLoaded(true);
      setUpdatedAt(Date.now());
      if (r && ACTIVE_STATUSES.has(r.status)) {
        const delay = r.status === 'awaiting_review' ? intervalMs * 2 : intervalMs;
        timer.current = window.setTimeout(() => poll(gen), delay);
      } else if (idleIntervalMs > 0 && !document.hidden) {
        // Fast polling stops once the run is finished; a slow check picks up runs started elsewhere.
        timer.current = window.setTimeout(() => poll(gen), idleIntervalMs);
      } else if (idleIntervalMs > 0) {
        timer.current = window.setTimeout(() => poll(gen), idleIntervalMs * 4);
      }
    } catch (e) {
      if (gen !== generation.current) return;
      failures.current += 1;
      setLoaded(true);
      setError(e instanceof ApiError ? e.message : String(e));
      const delay = Math.min(10000, intervalMs * 2 ** Math.min(4, failures.current));
      timer.current = window.setTimeout(() => poll(gen), delay);
    }
  }, [intervalMs]);

  const refresh = useCallback(() => {
    clear();
    generation.current += 1;
    void poll(generation.current);
  }, [poll]);

  useEffect(() => {
    refresh();
    return () => {
      generation.current += 1;
      clear();
    };
  }, [refresh]);

  return { run, loaded, error, updatedAt, refresh };
}

export function useStatus(intervalMs = 10000) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let t: number | undefined;
    const tick = async () => {
      try {
        const s = await api.status();
        if (!alive) return;
        setStatus(s);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
      if (alive) t = window.setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [intervalMs]);
  return { status, error };
}

/** One-shot static data (building, scenarios, footage), retried every 3 s until the backend answers. */
export function useStaticData() {
  const [building, setBuilding] = useState<Building | null>(null);
  const [scenarios, setScenarios] = useState<ScenariosResponse | null>(null);
  const [footage, setFootage] = useState<FootageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadFootage = useCallback(async () => {
    try {
      setFootage(await api.footage());
    } catch {
      /* footage list is optional */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let t: number | undefined;
    const load = async () => {
      try {
        const [b, s] = await Promise.all([api.building(), api.scenarios()]);
        if (!alive) return;
        setBuilding(b);
        setScenarios(s);
        setError(null);
        void reloadFootage();
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        t = window.setTimeout(load, 3000);
      }
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [reloadFootage]);

  return { building, scenarios, footage, error, reloadFootage };
}

/** Re-render on an interval (for elapsed clocks). */
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

const SESSION_KEY = 'clearpath.sessionRuns';

function readSessionRuns(): { id: string; scenario: string; startedAt: number }[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Run ids started from this browser session (client-side only; the backend has no run listing). */
export function useSessionRuns() {
  const [runs, setRuns] = useState(readSessionRuns);
  const add = useCallback((id: string, scenario: string) => {
    setRuns((prev) => {
      if (prev.some((r) => r.id === id)) return prev;
      const next = [{ id, scenario, startedAt: Date.now() }, ...prev].slice(0, 50);
      try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep in memory */
      }
      return next;
    });
  }, []);
  return { runs, add };
}
