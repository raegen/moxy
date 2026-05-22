import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { DevToolsPanelHost } from './host';

// PermissionGate (v1.3) gates the App behind an async permission check.
// The test setup mocks chrome.permissions.contains → true, so the gate
// resolves to the granted state — but resolution is async, so the assertions
// use findBy* to wait for the App to render.
describe('DevToolsPanelHost smoke test', () => {
  it('renders the shared moxy UI with a given tab id', async () => {
    render(<DevToolsPanelHost tabId={42} />);
    expect(await screen.findByText('moxy')).toBeTruthy();
  });

  it('shows the captures + rules + scenarios tab buttons', async () => {
    render(<DevToolsPanelHost tabId={42} />);
    expect(await screen.findByRole('button', { name: /captures/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /rules/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /scenarios/i })).toBeTruthy();
  });

  it('passes the provided tab id through TabContext (shown in header badge)', async () => {
    render(<DevToolsPanelHost tabId={42} />);
    expect(await screen.findByText(/tab 42/i)).toBeTruthy();
  });
});
