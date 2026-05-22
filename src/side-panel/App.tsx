import { useEffect, useState, useCallback } from 'preact/hooks';
import type { RosterRow, SwResponse } from '../shared/types';
import { ActiveTabsRoster } from './ActiveTabsRoster';

async function send<T = unknown>(msg: unknown): Promise<T | null> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as SwResponse;
    if (res?.ok) return (res.data ?? null) as T | null;
    return null;
  } catch {
    return null;
  }
}

// Slim side panel — v1.3 "mission control."
// Two pieces of UI: global ON/OFF pill + active-tabs roster with click-to-switch.
// Scenario management lives in DevTools, not here. Permission management lives
// in chrome://extensions, not here.
export function SidePanelApp() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [globalEnabled, setGlobalEnabled] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    const [roster, enabled] = await Promise.all([
      send<RosterRow[]>({ kind: 'sw:list-roster' }),
      send<boolean>({ kind: 'sw:get-global-enabled' }),
    ]);
    setRows(roster ?? []);
    if (enabled != null) setGlobalEnabled(enabled);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // React to SW broadcasts that affect the roster.
  useEffect(() => {
    const listener = (msg: { kind?: string; enabled?: boolean }) => {
      if (!msg?.kind) return;
      if (
        msg.kind === 'panel:active-changed' ||
        msg.kind === 'panel:permissions-changed' ||
        msg.kind === 'panel:scenarios-updated' ||
        msg.kind === 'panel:rules-updated' ||
        msg.kind === 'panel:tab-closed'
      ) {
        void refresh();
      } else if (msg.kind === 'panel:global-toggled') {
        if (typeof msg.enabled === 'boolean') setGlobalEnabled(msg.enabled);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  // Re-poll the roster when tabs close (handles the case where the SW broadcast
  // arrived before the in-page listener mounted).
  useEffect(() => {
    const onRemoved = () => {
      void refresh();
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }, [refresh]);

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    await send({ kind: 'sw:set-global-enabled', enabled: next });
  };

  return (
    <>
      <header class="moxy-head">
        <div class="head-left">
          <label
            class="global-toggle"
            title={globalEnabled ? 'click to disable all mocking' : 'click to enable mocking'}
          >
            <input type="checkbox" checked={globalEnabled} onChange={toggleGlobal} />
            <span class={'pill' + (globalEnabled ? ' on' : ' off')}>
              {globalEnabled ? 'ON' : 'OFF'}
            </span>
          </label>
          <h1>moxy</h1>
        </div>
        <div class="head-right">
          <span class="badge">{rows.length} active</span>
        </div>
      </header>

      <main class="moxy-body">
        <section class="side-section">
          <h2 class="side-section-title">Active tabs</h2>
          <ActiveTabsRoster rows={rows} globalEnabled={globalEnabled} />
        </section>

        {!globalEnabled && (
          <div class="off-banner">
            moxy is off — toggle on in the header to resume mocking.
          </div>
        )}
      </main>
    </>
  );
}
