import { useEffect, useState, useCallback, useMemo } from 'preact/hooks';
import type { Capture, Rule, Scenario, SwResponse } from '../../shared/types';
import { MutateDrawer } from './MutateDrawer';
import { ScenarioBar } from './ScenarioBar';
import { ScenariosTab } from './ScenariosTab';
import { useTabId } from './TabContext';

async function send<T = unknown>(msg: unknown): Promise<T | null> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as SwResponse;
    if (res?.ok) return (res.data ?? null) as T | null;
    return null;
  } catch {
    return null;
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function statusColor(status: number): string {
  if (status >= 500) return 'var(--error)';
  if (status >= 400) return 'var(--warn)';
  if (status >= 300) return 'var(--fg-dim)';
  return 'var(--accent)';
}

type Tab = 'captures' | 'rules' | 'scenarios';

export function App() {
  const tabId = useTabId();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [globalEnabled, setGlobalEnabled] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<Tab>('captures');
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const refresh = useCallback(async (tid: number | null) => {
    if (tid == null) return;
    const [caps, rls, ge, sc, ac] = await Promise.all([
      send<Capture[]>({ kind: 'sw:list-captures', tabId: tid }),
      send<Rule[]>({ kind: 'sw:list-rules', tabId: tid }),
      send<boolean>({ kind: 'sw:get-global-enabled' }),
      send<Scenario[]>({ kind: 'sw:list-scenarios' }),
      send<{ scenarioId: string | null }>({ kind: 'sw:get-active-scenario', tabId: tid }),
    ]);
    setCaptures(caps ?? []);
    setRules(rls ?? []);
    if (ge != null) setGlobalEnabled(ge);
    setScenarios(sc ?? []);
    setActiveScenarioId(ac?.scenarioId ?? null);
  }, []);

  // Re-fetch whenever the host changes the current tab. The side-panel host
  // updates on chrome.tabs.onActivated; the DevTools host (v1.1b) holds a
  // fixed tabId for the session, so this fires once at mount and stays.
  useEffect(() => {
    void refresh(tabId);
  }, [tabId, refresh]);

  useEffect(() => {
    const listener = (msg: {
      kind?: string;
      capture?: Capture;
      tabId?: number;
      enabled?: boolean;
    }) => {
      if (!msg?.kind) return;
      if (msg.kind === 'panel:capture-added') {
        if (msg.capture && msg.capture.tabId === tabId) {
          setCaptures((prev) => [...prev, msg.capture!]);
        }
      } else if (msg.kind === 'panel:captures-cleared') {
        if (msg.tabId == null || msg.tabId === tabId) setCaptures([]);
      } else if (msg.kind === 'panel:tab-closed' && msg.tabId === tabId) {
        setCaptures([]);
        setRules([]);
      } else if (msg.kind === 'panel:rules-updated') {
        void refresh(tabId);
      } else if (msg.kind === 'panel:global-toggled') {
        if (typeof msg.enabled === 'boolean') setGlobalEnabled(msg.enabled);
      } else if (msg.kind === 'panel:scenarios-updated' || msg.kind === 'panel:active-changed') {
        void refresh(tabId);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId, refresh]);

  const clear = async () => {
    if (tabId == null) return;
    await send({ kind: 'sw:clear-captures', tabId });
    setCaptures([]);
  };

  const toggleRule = async (rule: Rule) => {
    await send({ kind: 'sw:toggle-rule', ruleId: rule.id, enabled: !rule.enabled });
    void refresh(tabId);
  };

  const toggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    await send({ kind: 'sw:set-global-enabled', enabled: next });
  };

  const enabledRulesCount = rules.filter((r) => r.enabled).length;

  const captureToShowInDrawer = useMemo(() => {
    if (selectedCapture) return selectedCapture;
    if (editingRule) {
      // Build a stub capture from the rule's provenance so the drawer can render.
      const found = captures.find((c) => c.id === editingRule.fromCaptureId);
      if (found) return found;
      return {
        id: editingRule.fromCaptureId ?? editingRule.id,
        tabId: editingRule.tabId,
        ts: editingRule.createdAt,
        request: { method: editingRule.match.method, url: editingRule.match.pattern, headers: {} },
        response: { status: 200, statusText: 'OK', headers: {}, body: { kind: 'text', data: '' } },
        durationMs: 0,
      } as Capture;
    }
    return null;
  }, [selectedCapture, editingRule, captures]);

  return (
    <>
      <header class="moxy-head">
        <div class="head-left">
          <label class="global-toggle" title={globalEnabled ? 'click to disable all mocking' : 'click to enable mocking'}>
            <input type="checkbox" checked={globalEnabled} onChange={toggleGlobal} />
            <span class={'pill' + (globalEnabled ? ' on' : ' off')}>
              {globalEnabled ? 'ON' : 'OFF'}
            </span>
          </label>
          <h1>moxy</h1>
        </div>
        <div class="head-right">
          <span class="badge">
            {enabledRulesCount}/{rules.length} active
          </span>
          <span class="badge">{tabId !== null ? `tab ${tabId}` : 'no tab'}</span>
          <button class="btn-sm" onClick={clear} disabled={captures.length === 0}>
            clear
          </button>
        </div>
      </header>

      <ScenarioBar
        active={
          activeScenarioId ? scenarios.find((s) => s.id === activeScenarioId) ?? null : null
        }
        onUnload={async () => {
          if (tabId == null) return;
          await send({ kind: 'sw:unload-scenario', tabId });
          void refresh(tabId);
        }}
      />

      <nav class="tabs">
        <button
          class={'tab' + (activeTab === 'captures' ? ' active' : '')}
          onClick={() => setActiveTab('captures')}
        >
          captures <span class="count">{captures.length}</span>
        </button>
        <button
          class={'tab' + (activeTab === 'rules' ? ' active' : '')}
          onClick={() => setActiveTab('rules')}
        >
          rules <span class="count">{rules.length}</span>
        </button>
        <button
          class={'tab' + (activeTab === 'scenarios' ? ' active' : '')}
          onClick={() => setActiveTab('scenarios')}
        >
          scenarios <span class="count">{scenarios.length}</span>
        </button>
      </nav>

      <main class="moxy-body">
        {activeTab === 'captures' &&
          (captures.length === 0 ? (
            <div class="empty">
              No captures yet.
              <br />
              Open a page that uses fetch, then reload that page.
            </div>
          ) : (
            <ul class="capture-list">
              {captures
                .slice()
                .reverse()
                .map((c) => (
                  <li
                    key={c.id}
                    class={'capture-row' + (c.mocked ? ' mocked' : '')}
                    onClick={() => setSelectedCapture(c)}
                  >
                    <span class="cap-method">{c.request.method}</span>
                    <span
                      class="cap-status"
                      style={{ color: statusColor(c.response.status) }}
                    >
                      {c.response.status}
                    </span>
                    <span class="cap-url" title={c.request.url}>
                      {shortUrl(c.request.url)}
                    </span>
                    <span class="cap-dur">
                      {c.mocked ? 'MOCK ' : ''}
                      {c.durationMs}ms
                    </span>
                  </li>
                ))}
            </ul>
          ))}

        {activeTab === 'rules' &&
          (rules.length === 0 ? (
            <div class="empty">
              No rules yet.
              <br />
              Click a capture to create one.
            </div>
          ) : (
            <ul class="rule-list">
              {rules.map((r) => (
                <li key={r.id} class={'rule-row' + (r.enabled ? '' : ' disabled')}>
                  <label class="rule-toggle">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => void toggleRule(r)}
                    />
                  </label>
                  <span class="rule-method">{r.match.method}</span>
                  <span class="rule-glob" title={r.match.pattern}>
                    {r.match.pattern}
                  </span>
                  <span class="rule-status">→ {r.mutate.status ?? 'passthru'}</span>
                  {r.mutate.latencyMs ? (
                    <span class="rule-lat">+{r.mutate.latencyMs}ms</span>
                  ) : null}
                  <button class="btn-sm" onClick={() => setEditingRule(r)}>
                    edit
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {activeTab === 'scenarios' && tabId !== null && (
          <ScenariosTab
            scenarios={scenarios}
            activeScenarioId={activeScenarioId}
            tabId={tabId}
            onChanged={() => void refresh(tabId)}
          />
        )}
      </main>

      {captureToShowInDrawer && tabId !== null && (
        <MutateDrawer
          capture={captureToShowInDrawer}
          tabId={tabId}
          existingRule={editingRule ?? undefined}
          onClose={() => {
            setSelectedCapture(null);
            setEditingRule(null);
          }}
          onSaved={() => void refresh(tabId)}
        />
      )}
    </>
  );
}
