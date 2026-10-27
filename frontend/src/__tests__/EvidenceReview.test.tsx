// Human-in-the-loop decisions: consequences are explained before acting, the request goes to the backend,
// and success is only reported when the backend accepted it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import building from '../../../docs/sample_building.json';
import fixture from './fixtures_run_s2_unverified.json';
import { api } from '../api';
import { AppContext, type AppCtx } from '../context';
import { EvidenceReview } from '../components/EvidenceReview';
import { StartPage } from '../components/StartPage';
import type { Building, RunState } from '../types';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const run = fixture as unknown as RunState;

function ctx(over: Partial<AppCtx> = {}): AppCtx {
  return {
    building: building as unknown as Building,
    run,
    scenarios: [],
    footage: null,
    status: null,
    now: Date.now(),
    scenarioId: run.scenario.id,
    setScenarioId: () => {},
    overrides: {},
    setOverrides: () => {},
    reloadFootage: () => {},
    startRun: async () => true,
    cancelRun: async () => {},
    starting: false,
    refresh: vi.fn(),
    navigate: vi.fn(),
    selectedCamera: null,
    selectedAnalysis: null,
    selectCamera: () => {},
    openAnalysis: () => {},
    follow: false,
    setFollow: () => {},
    selectedZone: null,
    setSelectedZone: () => {},
    sessionRuns: [],
    historyRunId: null,
    openHistory: () => {},
    reviewOpen: true,
    reviewCamera: 'CAM-03',
    openReview: vi.fn(),
    closeReview: () => {},
    goToStart: () => {},
    ...over,
  };
}

function renderReview(c = ctx()) {
  return render(
    <AppContext.Provider value={c}>
      <EvidenceReview initialCamera="CAM-03" onClose={() => {}} />
    </AppContext.Provider>,
  );
}

describe('EvidenceReview', () => {
  it('shows location unknown, the reason, the firearm limitation and the consequences', () => {
    renderReview();
    expect(screen.getByText('Unknown (camera mounted in C3)')).toBeTruthy();
    expect(screen.getByText(/Why it was flagged/)).toBeTruthy();
    expect(screen.getByText(/No firearm detector is configured/)).toBeTruthy();
    expect(screen.getByText(/applied to the threat map and the recommendation is recomputed/)).toBeTruthy();
    expect(screen.getByText(/Dismissing does not stop or resolve anything in the real world/)).toBeTruthy();
    expect(screen.getByText(/Based on the report only/)).toBeTruthy();
  });

  it('confirm sends the observation decision and reports it only after the backend accepts', async () => {
    const spy = vi.spyOn(api, 'review').mockResolvedValue({ ok: true });
    const c = ctx();
    renderReview(c);
    fireEvent.click(screen.getByRole('button', { name: /Confirm: this happened in C3/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toMatchObject({ action: 'confirm_observation', camera_id: 'CAM-03', reviewer: 'Safety lead' });
    await screen.findByText(/Recorded: CAM-03 confirmed in C3/);
    expect(c.refresh).toHaveBeenCalled();
  });

  it('dismiss sends the selected reason', async () => {
    const spy = vi.spyOn(api, 'review').mockResolvedValue({ ok: true });
    renderReview();
    fireEvent.change(screen.getByLabelText('Dismiss reason'), { target: { value: 'Detection or tracking error' } });
    fireEvent.click(screen.getByRole('button', { name: /Dismiss observation/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toMatchObject({ action: 'dismiss_observation', camera_id: 'CAM-03', note: 'Detection or tracking error' });
  });

  it('does not simulate success when the backend refuses', async () => {
    vi.spyOn(api, 'review').mockRejectedValue(new Error('observation CAM-03 is not pending review (already confirmed)'));
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: /Confirm: this happened in C3/ }));
    await screen.findByText(/not pending review/);
    expect(screen.queryByText(/^Recorded:/)).toBeNull();
  });

  it('approve / reject send the recommended option', async () => {
    const spy = vi.spyOn(api, 'review').mockResolvedValue({ ok: true });
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: /^Reject$/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toMatchObject({ action: 'reject', option_id: run.review!.recommended });
  });
});

describe('no feasible alternative', () => {
  it('tells the reviewer when the rejected option is the only one left', () => {
    const r = JSON.parse(JSON.stringify(run)) as RunState;
    r.assessment!.no_feasible_alternative = true;
    r.assessment!.uncertainty = ['No other procedure\'s preconditions hold; LOCKDOWN remains the only evidence-supported option although the reviewer rejected it.', ...r.assessment!.uncertainty];
    render(
      <AppContext.Provider value={ctx({ run: r })}>
        <EvidenceReview initialCamera="CAM-03" onClose={() => {}} />
      </AppContext.Provider>,
    );
    expect(screen.getByText(/remains the only evidence-supported option/)).toBeTruthy();
  });
});

describe('completed run', () => {
  it('shows the simulated action log after approval', () => {
    const r = JSON.parse(JSON.stringify(run)) as RunState;
    r.status = 'complete';
    r.review = null;
    r.action_log = ['SIMULATED — would initiate LOCKDOWN: Clear hallways', 'SIMULATED — no real alert, notification, or door control was triggered.'];
    render(
      <AppContext.Provider value={ctx({ run: r })}>
        <EvidenceReview initialCamera="CAM-03" onClose={() => {}} />
      </AppContext.Provider>,
    );
    expect(screen.getByText(/every entry is SIMULATED/)).toBeTruthy();
    expect(screen.getByText(/no real alert, notification, or door control/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
  });
});

describe('StartPage', () => {
  it('offers an explicit resume instead of jumping into the stale run, and starts a new analysis', async () => {
    const startRun = vi.fn(async () => true);
    const navigate = vi.fn();
    const scen = { id: 'S2-corroborated-east', title: 'Corroborated incident', summary: 's', trigger: run.scenario.trigger, cameras: run.camera_clips };
    render(
      <AppContext.Provider value={ctx({ startRun, navigate, scenarios: [scen as never] })}>
        <StartPage staticError={null} />
      </AppContext.Provider>,
    );
    expect(screen.getByText('Existing run on the server')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resume review/ })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Start analysis/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith('S2-corroborated-east'));
    expect(navigate).toHaveBeenCalledWith('operations');
  });

  it('stays on the start page and shows an error when the run cannot be started', async () => {
    const navigate = vi.fn();
    const scen = { id: 'S2-corroborated-east', title: 'T', summary: 's', trigger: run.scenario.trigger, cameras: run.camera_clips };
    render(
      <AppContext.Provider value={ctx({ startRun: async () => false, navigate, run: null, scenarios: [scen as never] })}>
        <StartPage staticError={null} />
      </AppContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Start analysis/ }));
    await screen.findByText(/could not be started/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the loading / unreachable state', () => {
    render(
      <AppContext.Provider value={ctx({ building: null, run: null })}>
        <StartPage staticError="Backend unreachable" />
      </AppContext.Provider>,
    );
    expect(screen.getByText(/Retrying automatically/)).toBeTruthy();
  });
});
