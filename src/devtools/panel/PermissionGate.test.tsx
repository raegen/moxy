import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { PermissionGate } from './PermissionGate';

// The chrome stub in test/setup.ts defaults to:
//   permissions.contains  → true   (gate resolves to granted)
//   permissions.request   → true   (auto-grant succeeds if attempted)
//   tabs.get              → { id: 42, url: 'https://example.com/' }
// Individual tests override these via the global `chrome` mock to exercise
// the denied / no-origin / freshly-granted branches.

const c = () => (globalThis as unknown as { chrome: typeof chrome }).chrome;

describe('PermissionGate', () => {
  beforeEach(() => {
    (c().tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 42,
      url: 'https://example.com/',
      windowId: 1,
    });
    (c().permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (c().permissions.request as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('renders children when permission is already granted', async () => {
    render(
      <PermissionGate tabId={42}>
        <span>app content</span>
      </PermissionGate>
    );
    expect(await screen.findByText('app content')).toBeTruthy();
  });

  it('shows the grant banner when permission is missing and auto-request is denied', async () => {
    (c().permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (c().permissions.request as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    render(
      <PermissionGate tabId={42}>
        <span>app content</span>
      </PermissionGate>
    );

    expect(
      await screen.findByRole('button', { name: /Grant access to example\.com/i })
    ).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
  });

  it('shows no-origin message for non-http(s) URLs', async () => {
    (c().tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 42,
      url: 'chrome://extensions',
      windowId: 1,
    });

    render(
      <PermissionGate tabId={42}>
        <span>app content</span>
      </PermissionGate>
    );

    expect(
      await screen.findByText(/Navigate the inspected tab to a regular web page/i)
    ).toBeTruthy();
  });

  it('renders children after a fresh grant', async () => {
    let granted = false;
    (c().permissions.contains as ReturnType<typeof vi.fn>).mockImplementation(async () => granted);
    (c().permissions.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      granted = true;
      return true;
    });

    render(
      <PermissionGate tabId={42}>
        <span>app content</span>
      </PermissionGate>
    );

    // Auto-request fires on mount; the gate transitions to granted and shows
    // both the App and the freshly-granted reload hint.
    await waitFor(() => {
      expect(screen.queryByText('app content')).toBeTruthy();
    });
    expect(
      screen.queryByText(/Reload example\.com to mock requests fired during page load/i)
    ).toBeTruthy();
  });
});
