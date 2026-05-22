import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { DevToolsPanelHost } from './host';

describe('DevToolsPanelHost smoke test', () => {
  it('renders the shared moxy UI with a given tab id', () => {
    render(<DevToolsPanelHost tabId={42} />);
    expect(screen.getByText('moxy')).toBeTruthy();
  });

  it('shows the captures + rules + scenarios tab buttons', () => {
    render(<DevToolsPanelHost tabId={42} />);
    expect(screen.getByRole('button', { name: /captures/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /rules/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /scenarios/i })).toBeTruthy();
  });

  it('passes the provided tab id through TabContext (shown in header badge)', () => {
    render(<DevToolsPanelHost tabId={42} />);
    expect(screen.getByText(/tab 42/i)).toBeTruthy();
  });
});
