import type { RosterRow } from '../shared/types';

// Lists tabs where moxy is actively mocking. Click row → focus that tab.
// Data joined SW-side via sw:list-roster — the side panel just renders.
export function ActiveTabsRoster({
  rows,
  globalEnabled,
}: {
  rows: RosterRow[];
  globalEnabled: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div class="empty">
        No tabs currently mocking.
        <br />
        Open DevTools on a site to start.
      </div>
    );
  }

  const switchToTab = async (row: RosterRow) => {
    try {
      await chrome.tabs.update(row.tabId, { active: true });
      await chrome.windows.update(row.windowId, { focused: true });
    } catch (e) {
      console.warn('[moxy] tab switch failed', e);
    }
  };

  return (
    <ul class={'roster' + (globalEnabled ? '' : ' muted')}>
      {rows.map((row) => (
        <li key={row.tabId} class="roster-row">
          <div class="roster-main">
            <span class="roster-origin" title={row.origin}>
              <span class="roster-dot" /> {hostOf(row.origin)}
            </span>
            <span class="roster-scenario" title={row.scenarioName}>
              {row.scenarioName}
            </span>
            <span class="roster-meta">
              {row.enabledRuleCount}/{row.ruleCount} rules · tab {row.tabId}
            </span>
          </div>
          <button
            class="btn-sm"
            onClick={() => void switchToTab(row)}
            title={`switch to ${hostOf(row.origin)}`}
          >
            switch ▸
          </button>
        </li>
      ))}
    </ul>
  );
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
