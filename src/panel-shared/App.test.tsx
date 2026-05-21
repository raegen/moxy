import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { App } from './App';
import { TabContext } from './TabContext';

describe('App smoke test', () => {
  it('renders the moxy header', () => {
    render(
      <TabContext.Provider value={1}>
        <App />
      </TabContext.Provider>
    );
    expect(screen.getByText('moxy')).toBeTruthy();
  });

  it('renders empty captures state when nothing captured', () => {
    render(
      <TabContext.Provider value={1}>
        <App />
      </TabContext.Provider>
    );
    expect(screen.getByText(/No captures yet/i)).toBeTruthy();
  });

  it('shows ON/OFF global toggle pill', () => {
    render(
      <TabContext.Provider value={1}>
        <App />
      </TabContext.Provider>
    );
    // Default state is ON until storage check resolves; either is acceptable for smoke.
    const pill = screen.getByText(/^(ON|OFF)$/);
    expect(pill).toBeTruthy();
  });

  it('shows captures and rules tab buttons', () => {
    render(
      <TabContext.Provider value={1}>
        <App />
      </TabContext.Provider>
    );
    expect(screen.getByRole('button', { name: /captures/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /rules/i })).toBeTruthy();
  });
});
