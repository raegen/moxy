// moxy service worker — rule storage, capture buffer, scenarios, broadcasts.
//
// Boot order matters: migration runs first (reads moxy:formatVersion flag),
// then content-script registration (synced to currently-granted origins),
// then existing-tab injection. All storage writes go through withWriteLock
// to serialize concurrent saves across the side panel + DevTools panel +
// capture stream.
//
// v1.3 — content scripts (patch + bridge) are registered programmatically,
// scoped to the host origins the user has granted via optional_host_permissions.
// The manifest no longer declares static content_scripts; bridge injection is
// also programmatic and runs alongside the patch.

import type { Capture, RosterRow, Scenario, SwMessage, SwResponse } from './shared/types';
import { migrateV1ToV11, chromeStorageAdapter } from './shared/migrate';
import { withWriteLock } from './shared/storage';
import { createDebug } from './shared/debug';

const dbg = createDebug('sw');
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
const BRIDGE_SCRIPT_ID = 'moxy-bridge';
const STORAGE_KEY_CAPTURES = 'moxy:captures';
const STORAGE_KEY_GLOBAL_ENABLED = 'moxy:enabled';
const STORAGE_KEY_PRESERVE_LOG = 'moxy:preserveLog';
const CAPTURE_BUFFER_LIMIT_PER_TAB = 500;

const storageAdapter = chromeStorageAdapter();

// ---------- permission-scoped content script registration ----------

// Sync the registered content scripts (patch + bridge) so their `matches` array
// reflects the origins the user currently has granted via optional_host_permissions.
// Called at boot AND on every chrome.permissions.onAdded / onRemoved.
//
// Concurrent calls are serialized through a single in-flight promise — Chrome's
// register/update API will throw on overlapping mutation.
let syncInFlight: Promise<void> | null = null;

async function syncContentScriptRegistration(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      const { origins = [] } = await chrome.permissions.getAll();
      // Filter to actual URL match patterns; `permissions` may include API keys.
      const matches = origins.filter((o) => /^(\*|https?|file):/.test(o) || o === '<all_urls>');

      const existing = await chrome.scripting.getRegisteredContentScripts({
        ids: [PATCH_SCRIPT_ID, BRIDGE_SCRIPT_ID],
      });
      const existingIds = new Set(existing.map((s) => s.id));

      if (matches.length === 0) {
        if (existingIds.size > 0) {
          await chrome.scripting.unregisterContentScripts({ ids: [...existingIds] });
          console.log('[moxy] no granted origins — content scripts unregistered');
        }
        return;
      }

      const patchScript: chrome.scripting.RegisteredContentScript = {
        id: PATCH_SCRIPT_ID,
        matches,
        js: ['patch.js'],
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: false,
        persistAcrossSessions: true,
      };
      const bridgeScript: chrome.scripting.RegisteredContentScript = {
        id: BRIDGE_SCRIPT_ID,
        matches,
        js: ['bridge.js'],
        runAt: 'document_start',
        world: 'ISOLATED',
        allFrames: false,
        persistAcrossSessions: true,
      };

      const toRegister: chrome.scripting.RegisteredContentScript[] = [];
      const toUpdate: chrome.scripting.RegisteredContentScript[] = [];
      for (const s of [patchScript, bridgeScript]) {
        if (existingIds.has(s.id)) toUpdate.push(s);
        else toRegister.push(s);
      }

      if (toRegister.length > 0) await chrome.scripting.registerContentScripts(toRegister);
      if (toUpdate.length > 0) await chrome.scripting.updateContentScripts(toUpdate);
      console.log(`[moxy] content scripts synced to ${matches.length} origin pattern(s)`);
    } catch (e) {
      console.error('[moxy] content script sync failed', e);
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

// Inject patch + bridge into already-open tabs whose origin the user has
// granted permission for. Called at boot and on chrome.permissions.onAdded.
// Pre-load fetch/XHR calls (fired before document_start of the injection) are
// missed — DevTools shows a toast telling the user to reload.
async function injectIntoExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});

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
      // Per-tab permission check — skip silently for ungranted origins.
      let granted = false;
      try {
        granted = await chrome.permissions.contains({ origins: [tab.url] });
      } catch {
        return;
      }
      if (!granted) return;

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['patch.js'],
          world: 'MAIN',
          injectImmediately: true,
        });
      } catch (e) {
        console.warn(
          `[moxy] patch inject failed for ${tab.url} — ${e instanceof Error ? e.message : String(e)}`
        );
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['bridge.js'],
          world: 'ISOLATED',
          injectImmediately: true,
        });
      } catch (e) {
        console.warn(
          `[moxy] bridge inject failed for ${tab.url} — ${e instanceof Error ? e.message : String(e)}`
        );
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

// Drop the legacy moxy:captures blob from chrome.storage.local. Pre-v1.3.2
// stored captures there; v1.3.2 moved them to .session. Existing users would
// otherwise carry forward a potentially-massive stale value that eats into
// their .local quota forever (and bricks every other .local write once full).
async function purgeLegacyCapturesFromLocal(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY_CAPTURES);
  } catch (e) {
    console.warn('[moxy] legacy captures purge failed', e);
  }
}

async function bootSequence(): Promise<void> {
  dbg('boot: migration');
  await runMigration();
  dbg('boot: purge legacy captures');
  await purgeLegacyCapturesFromLocal();
  dbg('boot: sync content scripts');
  await syncContentScriptRegistration();
  dbg('boot: inject into existing tabs');
  await injectIntoExistingTabs();
  dbg('boot: done');
}

// ---------- top-level lifecycle handlers ----------
// Service workers wake/sleep; listener registration MUST be at module top level
// to re-bind on every wake.

chrome.runtime.onInstalled.addListener(() => void bootSequence());

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
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
  })();
});
void bootSequence();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('[moxy] sidePanel behavior', e));

// ---------- permission grant / revoke ----------

chrome.permissions.onAdded.addListener((permissions) => {
  void (async () => {
    await syncContentScriptRegistration();
    // Inject into matching open tabs so the user doesn't have to reload to
    // see captures (modulo the document_start race, which we surface as a
    // toast in DevTools).
    await injectIntoExistingTabs();
    notifyPanel({ kind: 'panel:permissions-changed', added: permissions.origins ?? [] });
  })();
});

chrome.permissions.onRemoved.addListener((permissions) => {
  void (async () => {
    await syncContentScriptRegistration();
    // Clean up moxy:active entries whose tab origins are no longer granted.
    // Live patches in already-running tabs are caught by safeRuntime() on
    // next fetch — they pass through real responses.
    await cleanupActiveForRevoked(permissions.origins ?? []);
    notifyPanel({ kind: 'panel:permissions-changed', removed: permissions.origins ?? [] });
  })();
});

async function cleanupActiveForRevoked(revokedOrigins: string[]): Promise<void> {
  if (revokedOrigins.length === 0) return;
  const tabs = await chrome.tabs.query({});
  const tabUrlById = new Map<number, string>();
  for (const t of tabs) if (t.id && t.url) tabUrlById.set(t.id, t.url);

  await withWriteLock(STORAGE_KEY_ACTIVE, async () => {
    const active =
      ((await chrome.storage.local.get(STORAGE_KEY_ACTIVE))[STORAGE_KEY_ACTIVE] as
        | Record<number, string>
        | undefined) ?? {};
    let changed = false;
    for (const tabIdStr of Object.keys(active)) {
      const tabId = Number(tabIdStr);
      const url = tabUrlById.get(tabId);
      // If the tab is gone OR we no longer have permission for its origin,
      // drop the active entry.
      if (!url) {
        delete active[tabId];
        changed = true;
        continue;
      }
      let stillGranted = false;
      try {
        stillGranted = await chrome.permissions.contains({ origins: [url] });
      } catch {
        stillGranted = false;
      }
      if (!stillGranted) {
        delete active[tabId];
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: active });
  });
}

// ---------- roster (side panel) ----------

// Joins moxy:active (per-tab scenario), the scenarios map, and the open-tab
// list into a roster of "tabs currently mocking." Filters out tabs whose
// origin isn't granted (defensive — cleanupActiveForRevoked should keep
// moxy:active in sync, but a missed event would otherwise leak stale rows).
async function buildRoster(): Promise<RosterRow[]> {
  const [tabs, scenariosArr, activeObj] = await Promise.all([
    chrome.tabs.query({}),
    listScenarios(storageAdapter),
    chrome.storage.local.get(STORAGE_KEY_ACTIVE),
  ]);
  const active = (activeObj[STORAGE_KEY_ACTIVE] as Record<number, string> | undefined) ?? {};
  const scenariosById = new Map(scenariosArr.map((s) => [s.id, s]));

  const rows: RosterRow[] = [];
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.windowId == null) continue;
    const scenarioId = active[tab.id];
    if (!scenarioId) continue;
    const scenario = scenariosById.get(scenarioId);
    if (!scenario) continue;
    let granted = false;
    try {
      granted = await chrome.permissions.contains({ origins: [tab.url] });
    } catch {
      granted = false;
    }
    if (!granted) continue;

    let origin: string;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }

    rows.push({
      tabId: tab.id,
      windowId: tab.windowId,
      origin,
      scenarioId,
      scenarioName: scenario.name,
      ruleCount: scenario.rules.length,
      enabledRuleCount: scenario.rules.filter((r) => r.enabled).length,
    });
  }
  return rows;
}

// ---------- captures + global toggle ----------

// Captures live in chrome.storage.session (cleared on browser restart) rather
// than .local. They're inherently ephemeral — survival across browser sessions
// was never a feature, just a side effect of using .local — and large bodies
// from a long-lived session can blow the 10MB QuotaBytes cap, after which
// every appendCapture rejects with "Resource::kQuotaBytes quota exceeded" and
// no new captures land for any tab.
async function loadCaptures(): Promise<Capture[]> {
  const obj = await chrome.storage.session.get(STORAGE_KEY_CAPTURES);
  return (obj[STORAGE_KEY_CAPTURES] as Capture[] | undefined) ?? [];
}

// chrome.storage.session has a 10MB cap shared across ALL keys, and our
// captures key holds entries from every open tab. A single big response (or
// many medium ones accumulated across tabs) blows the cap and every
// subsequent set() rejects with "Session storage quota bytes exceeded" —
// captures stop appearing in the panel mid-flight. Recover by evicting
// oldest captures (FIFO, across all tabs) and retrying until it fits.
// Truncating bodies would be the alternative, but full bodies are the
// material users need to author rules from, so the fix has to be eviction.
async function saveCaptures(captures: Capture[]): Promise<void> {
  let trimmed = captures;
  let evicted = 0;
  while (trimmed.length > 0) {
    try {
      await chrome.storage.session.set({ [STORAGE_KEY_CAPTURES]: trimmed });
      if (evicted > 0) dbg('saveCaptures: evicted', evicted, 'oldest captures to fit quota');
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/quota/i.test(msg)) throw e;
      // Drop 10% (min 1) of the OLDEST entries — list is already ts-sorted
      // ascending by appendCapture. Cross-tab eviction is intentional: the
      // quota is global, so the fairest signal is "what's stalest overall".
      const dropCount = Math.max(1, Math.floor(trimmed.length * 0.1));
      trimmed = trimmed.slice(dropCount);
      evicted += dropCount;
    }
  }
  // Even an empty array threw — should be impossible, but log so the failure
  // is visible instead of silent. The new capture is lost.
  console.warn('[moxy] saveCaptures: dropped new capture — body exceeds session storage quota on its own');
}

async function loadGlobalEnabled(): Promise<boolean> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_GLOBAL_ENABLED);
  return (obj[STORAGE_KEY_GLOBAL_ENABLED] as boolean | undefined) ?? true;
}

async function saveGlobalEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_GLOBAL_ENABLED]: enabled });
}

// "Preserve log" mirrors DevTools Network panel semantics. Off (default) means
// captures clear on every full document load (signaled by bridge.ts install);
// on means captures persist across reloads + navigations until the user clears
// manually or closes the tab. Stored in .local (tiny boolean, fine for quota)
// rather than .session so the preference survives browser restarts.
async function loadPreserveLog(): Promise<boolean> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_PRESERVE_LOG);
  return (obj[STORAGE_KEY_PRESERVE_LOG] as boolean | undefined) ?? false;
}

async function savePreserveLog(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_PRESERVE_LOG]: enabled });
}

async function clearCapturesForTab(tabId: number): Promise<void> {
  await withWriteLock(STORAGE_KEY_CAPTURES, async () => {
    const caps = await loadCaptures();
    const remaining = caps.filter((c) => c.tabId !== tabId);
    if (remaining.length !== caps.length) await saveCaptures(remaining);
  });
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
    dbg('capture stored', { id: cap.id, tabId: cap.tabId, total: trimmed.length });
  });
  notifyPanel({ kind: 'panel:capture-added', capture: cap });
}

// ---------- broadcasts ----------

function notifyPanel(msg: unknown): void {
  const kind = (msg as { kind?: string })?.kind;
  dbg('notifyPanel', kind);
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function broadcastRulesToTab(tabId: number): Promise<void> {
  dbg('broadcastRulesToTab', tabId);
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'broadcast:rules-updated' });
  } catch (e) {
    dbg('broadcastRulesToTab failed (no bridge yet?)', tabId, e);
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
  dbg('recv', msg?.kind, 'from tab', sender.tab?.id);
  void handleMessage(msg, sender)
    .then((res) => {
      dbg('reply', msg?.kind, res);
      sendResponse(res);
    })
    .catch((e) => {
      dbg('threw', msg?.kind, e);
      sendResponse({ ok: false, error: String(e) } satisfies SwResponse);
    });
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
    case 'sw:get-preserve-log': {
      return { ok: true, data: await loadPreserveLog() };
    }
    case 'sw:set-preserve-log': {
      await withWriteLock(STORAGE_KEY_PRESERVE_LOG, async () => {
        await savePreserveLog(msg.enabled);
      });
      notifyPanel({ kind: 'panel:preserve-log-changed', enabled: msg.enabled });
      return { ok: true };
    }
    case 'sw:new-document': {
      // bridge.ts fires this at document_start of every fresh page load. If
      // "Preserve log" is off (default), clear the tab's captures so the
      // panel doesn't show stale data from the previous document. SPA route
      // changes don't re-run content scripts, so this never fires for
      // in-document navigations — captures persist across them naturally.
      if (senderTabId == null) return { ok: true };
      const preserve = await loadPreserveLog();
      if (preserve) {
        dbg('sw:new-document: preserveLog on — keeping captures for tab', senderTabId);
        return { ok: true };
      }
      await clearCapturesForTab(senderTabId);
      dbg('sw:new-document: cleared captures for tab', senderTabId);
      notifyPanel({ kind: 'panel:captures-cleared', tabId: senderTabId });
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
      // Fetch tab metadata so an auto-created ephemeral scenario gets a
      // human-friendly name. Best-effort — if the lookup fails we still
      // save the rule, the scenario just gets the "Untitled scenario" fallback.
      let tabMeta: { title?: string; url?: string } | undefined;
      try {
        const tab = await chrome.tabs.get(tabId);
        tabMeta = { title: tab.title, url: tab.url };
      } catch {
        /* tab vanished mid-edit; fall through */
      }
      let scenarioId: string | undefined;
      await withWriteLock(STORAGE_KEY_SCENARIOS, async () => {
        const r = await saveRuleInActiveScenario(storageAdapter, tabId, ruleWithoutTabId, tabMeta);
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

    // ---- side panel roster (v1.3) ----
    case 'sw:list-roster': {
      const rows = await buildRoster();
      return { ok: true, data: rows };
    }

    default:
      return { ok: false, error: `unknown message kind: ${(msg as { kind: string }).kind}` };
  }
}

console.log('[moxy] sw booted');
