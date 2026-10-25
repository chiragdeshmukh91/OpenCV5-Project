import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import sample from '../../../docs/sample_run_state.json';
import { OptionsPanel } from '../components/OptionsPanel';
import type { RunState } from '../types';

const run = sample as unknown as RunState;

afterEach(cleanup);

describe('OptionsPanel', () => {
  it('renders every option with the recommended one first and expanded', () => {
    render(<OptionsPanel assessment={run.assessment} />);
    const a = run.assessment!;
    for (const o of a.options) expect(screen.getByTestId(`option-${o.id}`)).toBeTruthy();
    const rec = screen.getByTestId(`option-${a.recommended}`);
    expect(within(rec).getByText('recommended')).toBeTruthy();
    // recommended card is expanded: its preconditions are visible
    const recOpt = a.options.find((o) => o.id === a.recommended)!;
    for (const p of recOpt.preconditions) expect(within(rec).getByText(p.check)).toBeTruthy();
    // first card in DOM order is the recommended option
    const cards = screen.getAllByTestId(/^option-/);
    expect(cards[0].getAttribute('data-testid')).toBe(`option-${a.recommended}`);
    // uncertainty and why-not-full-evacuation are shown
    expect(screen.getByText(a.uncertainty[0])).toBeTruthy();
    for (const w of a.why_not_full_evacuation) expect(screen.getByText(w)).toBeTruthy();
  });

  it('expands a collapsed option on click', () => {
    render(<OptionsPanel assessment={run.assessment} />);
    const hold = screen.getByTestId('option-HOLD');
    expect(within(hold).queryByText('threat probability below hold threshold')).toBeNull();
    fireEvent.click(within(hold).getByRole('button'));
    expect(within(hold).getByText('threat probability below hold threshold')).toBeTruthy();
    expect(within(hold).getAllByText('not feasible').length).toBeGreaterThan(0);
  });

  it('shows an explanatory empty state without an assessment', () => {
    render(<OptionsPanel assessment={null} />);
    expect(screen.getByText(/Standard Response Protocol/)).toBeTruthy();
  });
});
