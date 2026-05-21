// moxy service worker — rule storage, capture buffer, scenarios, broadcasts.
//
// Boot order matters: migration runs first (reads moxy:formatVersion flag),
// then patch.js registration, then existing-tab injection (the v1.0.1 cold-
// start fix). All storage writes go through withWriteLock to serialize
// concurrent saves across the side panel + DevTools panel + capture stream.

import type { Capture, Scenario, SwMessage, SwResponse } from './shared/types';
import { migrateV1ToV11, chromeStorageAdapter } from './shared/migrate';
import { withWriteLock } from './shared/storage';
import {
  STORAGE_KEY_SCENARIOS,
  STORAGE_KEY_ACTIVE,
  listScenarios,
  getScenario,
  saveScenario,
  deleteScenario as deleteScenarioFromStore,
  uniqueNameFor,
  getActiveScenarioIdForTab,
  setActiveScenarioForTab,
  clearTabFromActive,
  clearAllActive,
  getRulesForTab,
  saveRuleInActiveScenario,
  deleteRuleInActiveScenario,
  toggleRuleInActiveScenario,
  gcEphemeralScenarios,
} from './shared/scenario-store';

const PATCH_SCRIPT_ID = 'moxy-patch';
const STORAGE_KEY_CAPTURES = 'moxy:captures';
const STORAGE_KEY_GLOBAL_ENABLED = 'moxy:enabled';
const CAPTURE_BUFFER_LIMIT_PER_TAB = 500;

const storageAdapter = chromeStorageAdapter();

// ---------- registration ----------

let registerPromise: Promise<void> | null = null;

function registerPatchScript(): Promise<void> {
  if (registerPromise) return registerPromise;
  registerPromise = (async () => {
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts({
        ids: [PATCH_SCRIPT_ID],
      });
      if (existing.length > 0) return;

      await chrome.scripting.registerContentScripts([
        {
          id: PATCH_SCRIPT_ID,
          matches: ['<all_urls>'],
          js: ['patch.js'],
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: false,
          persistAcrossSessions: true,
        },
      ]);
      console.log('[moxy] patch script registered');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Duplicate script ID')) {
        console.log('[moxy] patch script already registered');
        return;
      }
      console.error('[moxy] register failed', e);
      throw e;
    }
  })();
  return registerPromise;
}

async function injectIntoExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const manifest = chrome.runtime.getManifest();
  const bridgeFiles =
    manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return;
      if (!/^https?:/i.test(tab.url)) return;
      if (tab.incognito) {
        try {
          const allowed = await chrome.extension.isAllowedIncognitoAccess();
          if (!allowed) return;
        } catch {
          return;
        }
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['patch.js'],
          world: 'MAIN',
          injectImmediately: true,
        });
      } catch (e) {
        console.warn(`[moxy] patch inject failed for ${tab.url} — ${e instanceof Error ? e.message : String(e)}`);
      }
      if (bridgeFiles.length > 0) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: bridgeFiles,
          });
        } catch (e) {
          console.warn(`[moxy] bridge inject failed for ${tab.url} — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })
  );
}

// Migration runs through the same write lock as everything else writing to
// scenarios / active, so concurrent message handlers can't interleave with it.
async function runMigration(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const openTabIds = tabs.map((t) => t.id).filter((id): id is number => typeof id === 'number');
  await withWriteLock('moxy:migration', async () => {
    const result = await migrateV1ToV11(storageAdapter, openTabIds);
    if (result.ran && result.reason === 'completed') {
      console.log('[moxy] migration: v1 rules wrapped into scenario', result.scenarioCreated?.id);
    }
    for (const w of result.warnings) console.warn('[moxy] migration:', w);
  });
}

async function bootSequence(): Promise<void> {
  await runMigration();
  await registerPatchScript();
  await injectIntoExistingTabs();
}

chrome.runtime.onInstalled.addListener(() => void bootSequence());
chrome.runtime.onStartup.addListener(async () => {
  // Tab IDs recycle across browser restarts. Auto-attaching a scenario to
  // whatever inherits a recycled tabId would be surprising — clear active
  // state and let users reload scenarios explicitly. Also GC any ephemeral
  // "Untitled (DevTools)" scenarios left over from last session.
  await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
    await clearAllActive(storageAdapter);
  });
  await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
    const removed = await gcEphemeralScenarios(storageAdapter);
    if (removed > 0) console.log(`[moxy] gc'd ${removed} ephemeral scenarios from prior session`);
  });
  await bootSequence();
});
void bootSequence();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('[moxy] sidePanel behavior', e));

// ---------- captures + global toggle ----------

async function loadCaptures(): Promise<Capture[]> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_CAPTURES);
  return (obj[STORAGE_KEY_CAPTURES] as Capture[] | undefined) ?? [];
}

async function saveCaptures(captures: Capture[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_CAPTURES]: captures });
}

async function loadGlobalEnabled(): Promise<boolean> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_GLOBAL_ENABLED);
  return (obj[STORAGE_KEY_GLOBAL_ENABLED] as boolean | undefined) ?? true;
}

async function saveGlobalEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_GLOBAL_ENABLED]: enabled });
}

async function appendCapture(cap: Capture): Promise<void> {
  await withWriteLock(STORAGE_KEY_CAPTURES, async () => {
    const all = await loadCaptures();
    all.push(cap);
    const byTab = new Map<number, Capture[]>();
    for (const c of all) {
      const arr = byTab.get(c.tabId) ?? [];
      arr.push(c);
      byTab.set(c.tabId, arr);
    }
    const trimmed: Capture[] = [];
    for (const arr of byTab.values()) {
      const start = Math.max(0, arr.length - CAPTURE_BUFFER_LIMIT_PER_TAB);
      for (let i = start; i < arr.length; i++) trimmed.push(arr[i]);
    }
    trimmed.sort((a, b) => a.ts - b.ts);
    await saveCaptures(trimmed);
  });
  notifyPanel({ kind: 'panel:capture-added', capture: cap });
}

// ---------- broadcasts ----------

function notifyPanel(msg: unknown): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function broadcastRulesToTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'broadcast:rules-updated' });
  } catch {
    /* tab has no bridge yet */
  }
}

async function broadcastRulesToAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => (t.id ? broadcastRulesToTab(t.id) : Promise.resolve())));
}

// ---------- tab lifecycle ----------

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
    await clearTabFromActive(storageAdapter, tabId);
  });
  await withWriteLock(STORAGE_KEY_CAPTURES, async () => {
    const caps = await loadCaptures();
    const remaining = caps.filter((c) => c.tabId !== tabId);
    if (remaining.length !== caps.length) await saveCaptures(remaining);
  });
  notifyPanel({ kind: 'panel:tab-closed', tabId });
});

// ---------- message router ----------

chrome.runtime.onMessage.addListener((msg: SwMessage & { kind: string }, sender, sendResponse) => {
  void handleMessage(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e) } satisfies SwResponse));
  return true; // async response
});

async function handleMessage(
  msg: SwMessage & { kind: string },
  sender: chrome.runtime.MessageSender
): Promise<SwResponse> {
  const senderTabId = sender.tab?.id;

  switch (msg.kind) {
    // ---- captures / global ----
    case 'sw:capture': {
      if (senderTabId == null) return { ok: false, error: 'no tab id on sender' };
      const cap: Capture = { ...msg.capture, tabId: senderTabId };
      await appendCapture(cap);
      return { ok: true };
    }
    case 'sw:list-captures': {
      const all = await loadCaptures();
      const filtered = msg.tabId != null ? all.filter((c) => c.tabId === msg.tabId) : all;
      return { ok: true, data: filtered };
    }
    case 'sw:clear-captures': {
      await withWriteLock(STORAGE_KEY_CAPTURES, async () => {
        const all = await loadCaptures();
        const remaining = msg.tabId != null ? all.filter((c) => c.tabId !== msg.tabId) : [];
        await saveCaptures(remaining);
      });
      notifyPanel({ kind: 'panel:captures-cleared', tabId: msg.tabId });
      return { ok: true };
    }
    case 'sw:get-global-enabled': {
      return { ok: true, data: await loadGlobalEnabled() };
    }
    case 'sw:set-global-enabled': {
      await withWriteLock(STORAGE_KEY_GLOBAL_ENABLED, async () => {
        await saveGlobalEnabled(msg.enabled);
      });
      await broadcastRulesToAllTabs();
      notifyPanel({ kind: 'panel:global-toggled', enabled: msg.enabled });
      return { ok: true };
    }

    // ---- rules (via active scenario) ----
    case 'sw:get-rules-for-tab': {
      if (senderTabId == null) return { ok: true, data: [] };
      const enabled = await loadGlobalEnabled();
      if (!enabled) return { ok: true, data: [] };
      const rules = await getRulesForTab(storageAdapter, senderTabId);
      return { ok: true, data: rules };
    }
    case 'sw:list-rules': {
      // Panel-facing version. msg.tabId is the panel's "current tab".
      if (msg.tabId == null) return { ok: true, data: [] };
      const rules = await getRulesForTab(storageAdapter, msg.tabId);
      return { ok: true, data: rules };
    }
    case 'sw:save-rule': {
      const tabId = msg.rule.tabId;
      const { tabId: _, ...ruleWithoutTabId } = msg.rule;
      void _;
      let scenarioId: string | undefined;
      await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
        const r = await saveRuleInActiveScenario(storageAdapter, tabId, ruleWithoutTabId);
        scenarioId = r.scenarioId;
        if (r.created) {
          // Created an ephemeral scenario — also update active map.
          await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
            await setActiveScenarioForTab(storageAdapter, tabId, scenarioId!);
          });
        }
      });
      await broadcastRulesToTab(tabId);
      notifyPanel({ kind: 'panel:rules-updated' });
      return { ok: true, data: { scenarioId } };
    }
    case 'sw:delete-rule': {
      // The legacy message doesn't carry a tabId; find the rule across all active
      // tabs. For v1.1 we look it up by walking the active map (small N).
      const active = (await chrome.storage.local.get(STORAGE_KEY_ACTIVE))[STORAGE_KEY_ACTIVE] as
        | Record<number, string>
        | undefined;
      let found = false;
      if (active) {
        for (const [tabIdStr] of Object.entries(active)) {
          const tabId = Number(tabIdStr);
          let removed = false;
          await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
            removed = await deleteRuleInActiveScenario(storageAdapter, tabId, msg.ruleId);
          });
          if (removed) {
            await broadcastRulesToTab(tabId);
            found = true;
            break;
          }
        }
      }
      notifyPanel({ kind: 'panel:rules-updated' });
      return { ok: true, data: { removed: found } };
    }
    case 'sw:toggle-rule': {
      const active = (await chrome.storage.local.get(STORAGE_KEY_ACTIVE))[STORAGE_KEY_ACTIVE] as
        | Record<number, string>
        | undefined;
      let changed = false;
      if (active) {
        for (const [tabIdStr] of Object.entries(active)) {
          const tabId = Number(tabIdStr);
          let did = false;
          await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
            did = await toggleRuleInActiveScenario(storageAdapter, tabId, msg.ruleId, msg.enabled);
          });
          if (did) {
            await broadcastRulesToTab(tabId);
            changed = true;
            break;
          }
        }
      }
      notifyPanel({ kind: 'panel:rules-updated' });
      return { ok: true, data: { changed } };
    }

    // ---- scenarios ----
    case 'sw:list-scenarios': {
      const scenarios = await listScenarios(storageAdapter);
      return { ok: true, data: scenarios };
    }
    case 'sw:save-scenario': {
      let stored: Scenario | undefined;
      await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
        const incoming = msg.scenario;
        // Auto-rename on library name collision.
        const existing = await getScenario(storageAdapter, incoming.id);
        let finalName = incoming.name;
        if (!existing) {
          finalName = await uniqueNameFor(storageAdapter, incoming.name);
        }
        stored = { ...incoming, name: finalName };
        await saveScenario(storageAdapter, stored);
      });
      notifyPanel({ kind: 'panel:scenarios-updated' });
      // If this scenario is currently active in any tabs, push the new rules.
      const active = (await chrome.storage.local.get(STORAGE_KEY_ACTIVE))[STORAGE_KEY_ACTIVE] as
        | Record<number, string>
        | undefined;
      if (active && stored) {
        for (const [tabIdStr, sid] of Object.entries(active)) {
          if (sid === stored.id) await broadcastRulesToTab(Number(tabIdStr));
        }
      }
      return { ok: true, data: stored };
    }
    case 'sw:delete-scenario': {
      const affectedTabs: number[] = [];
      await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
        await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
          // Find tabs that had this scenario active so we can broadcast after.
          const active = (await chrome.storage.local.get(STORAGE_KEY_ACTIVE))[STORAGE_KEY_ACTIVE] as
            | Record<number, string>
            | undefined;
          if (active) {
            for (const [tabIdStr, sid] of Object.entries(active)) {
              if (sid === msg.scenarioId) affectedTabs.push(Number(tabIdStr));
            }
          }
          await deleteScenarioFromStore(storageAdapter, msg.scenarioId);
        });
      });
      await Promise.all(affectedTabs.map((id) => broadcastRulesToTab(id)));
      notifyPanel({ kind: 'panel:scenarios-updated' });
      return { ok: true };
    }
    case 'sw:load-scenario': {
      await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
        await setActiveScenarioForTab(storageAdapter, msg.tabId, msg.scenarioId);
      });
      await broadcastRulesToTab(msg.tabId);
      notifyPanel({ kind: 'panel:active-changed', tabId: msg.tabId, scenarioId: msg.scenarioId });
      return { ok: true };
    }
    case 'sw:unload-scenario': {
      await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
        await clearTabFromActive(storageAdapter, msg.tabId);
      });
      await broadcastRulesToTab(msg.tabId);
      notifyPanel({ kind: 'panel:active-changed', tabId: msg.tabId, scenarioId: null });
      return { ok: true };
    }
    case 'sw:get-active-scenario': {
      const scenarioId = await getActiveScenarioIdForTab(storageAdapter, msg.tabId);
      return { ok: true, data: { scenarioId } };
    }

    default:
      return { ok: false, error: `unknown message kind: ${(msg as { kind: string }).kind}` };
  }
}

console.log('[moxy] sw booted');
