import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { SidePanelApp } from './App';
import type { RosterRow } from '../shared/types';

const c = () => (globalThis as unknown as { chrome: typeof chrome }).chrome;

function mockSwResponses(handler: (msg: { kind: string }) => unknown) {
  (c().runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (msg: unknown) => {
    const data = handler(msg as { kind: string });
    return { ok: true, data };
  });
}

describe('SidePanelApp', () => {
  beforeEach(() => {
    mockSwResponses((msg) => {
      if (msg.kind === 'sw:list-roster') return [];
      if (msg.kind === 'sw:get-global-enabled') return true;
      return null;
    });
  });

  it('renders the moxy header with ON/OFF pill', async () => {
    render(<SidePanelApp />);
    expect(await screen.findByText('moxy')).toBeTruthy();
    expect(await screen.findByText('ON')).toBeTruthy();
  });

  it('renders the empty roster state when no tabs are mocking', async () => {
    render(<SidePanelApp />);
    expect(await screen.findByText(/No tabs currently mocking/i)).toBeTruthy();
  });

  it('renders roster rows when the SW returns active tabs', async () => {
    const rows: RosterRow[] = [
      {
        tabId: 47,
        windowId: 1,
        origin: 'http://localhost:3000',
        scenarioId: 's1',
        scenarioName: 'Checkout 500',
        ruleCount: 2,
        enabledRuleCount: 2,
      },
    ];
    mockSwResponses((msg) => {
      if (msg.kind === 'sw:list-roster') return rows;
      if (msg.kind === 'sw:get-global-enabled') return true;
      return null;
    });

    render(<SidePanelApp />);
    expect(await screen.findByText('Checkout 500')).toBeTruthy();
    expect(await screen.findByText('localhost:3000')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /switch/i })).toBeTruthy();
  });

  it('shows OFF when global toggle is disabled and surfaces the off banner', async () => {
    mockSwResponses((msg) => {
      if (msg.kind === 'sw:list-roster') return [];
      if (msg.kind === 'sw:get-global-enabled') return false;
      return null;
    });

    render(<SidePanelApp />);
    expect(await screen.findByText('OFF')).toBeTruthy();
    expect(
      await screen.findByText(/moxy is off — toggle on in the header to resume mocking/i)
    ).toBeTruthy();
  });
});
