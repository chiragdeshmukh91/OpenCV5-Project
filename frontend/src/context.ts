import { createContext, useContext } from 'react';
import type { Building, FootageResponse, RunState, Scenario, Status } from './types';
import type { PageId } from './components/Shell';

export interface AppCtx {
  building: Building | null;
  run: RunState | null;
  scenarios: Scenario[];
  footage: FootageResponse | null;
  status: Status | null;
  now: number;
  scenarioId: string;
  setScenarioId: (id: string) => void;
  overrides: Record<string, string>;
  setOverrides: (o: Record<string, string>) => void;
  reloadFootage: () => void;
  startRun: (scenarioId?: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  starting: boolean;
  refresh: () => void;
  navigate: (p: PageId) => void;
  selectedCamera: string | null;
  selectedAnalysis: string | null;
  selectCamera: (cid: string) => void;
  openAnalysis: (cid: string, aid: string) => void;
  follow: boolean;
  setFollow: (f: boolean | ((f: boolean) => boolean)) => void;
  selectedZone: string | null;
  setSelectedZone: (z: string | null) => void;
  sessionRuns: { id: string; scenario: string; startedAt: number }[];
  historyRunId: string | null;
  openHistory: (runId: string | null) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext missing');
  return v;
}
