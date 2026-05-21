// moxy service worker — rule storage, capture buffer, tab lifecycle, broadcasts.

import type { Capture, Rule, SwMessage, SwResponse } from './shared/types';

const PATCH_SCRIPT_ID = 'moxy-patch';
const STORAGE_KEY_RULES = 'moxy:rules';
const STORAGE_KEY_CAPTURES = 'moxy:captures';
const STORAGE_KEY_GLOBAL_ENABLED = 'moxy:enabled';
const CAPTURE_BUFFER_LIMIT_PER_TAB = 500;

// Serialize all callers within a single SW lifetime. The three triggers
// (onInstalled, onStartup, top-level wake) can fire near-simultaneously and
// race past the existence check; a singleton promise collapses them into one
// attempt.
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
        // Cross-SW-lifetime race or stale registration; harmless.
        console.log('[moxy] patch script already registered');
        return;
      }
      console.error('[moxy] register failed', e);
      throw e;
    }
  })();
  return registerPromise;
}

// Cold-start fix (v1.0.1). chrome.scripting.registerContentScripts only fires
// on new page loads — tabs already open when the extension installs or reloads
// would otherwise need a manual reload before patch.js + bridge re-inject. This
// iterates every eligible http(s) tab and force-injects via executeScript.
// Idempotent: __moxy_installed / __moxy_bridge_installed guards make re-inject
// a no-op when already installed.
async function injectIntoExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const manifest = chrome.runtime.getManifest();
  // Bridge files are declared in manifest.content_scripts. CRXJS bundles them
  // to hashed filenames; reading at runtime avoids hardcoding the hash.
  const bridgeFiles =
    manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return;
      if (!/^https?:/i.test(tab.url)) return; // skip chrome://, file://, edge cases

      // Incognito: chrome.extension.isAllowedIncognitoAccess() reflects the
      // user-level "Allow in incognito" toggle. inIncognitoContext only tells
      // us about the SW's own context, which is the wrong question.
      if (tab.incognito) {
        try {
          const allowed = await chrome.extension.isAllowedIncognitoAccess();
          if (!allowed) return;
        } catch {
          return;
        }
      }

      // MAIN-world patch. injectImmediately: page is already past
      // document_start, so inject ASAP.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['patch.js'],
          world: 'MAIN',
          injectImmediately: true,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[moxy] patch inject failed for ${tab.url} — ${msg}`);
      }

      // ISOLATED-world bridge.
      if (bridgeFiles.length > 0) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: bridgeFiles,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[moxy] bridge inject failed for ${tab.url} — ${msg}`);
        }
      }
    })
  );
}

// Run after patch script registration. onInstalled fires on fresh install and
// on every extension reload during dev — both code paths benefit.
async function bootSequence(): Promise<void> {
  await registerPatchScript();
  await injectIntoExistingTabs();
}

chrome.runtime.onInstalled.addListener(() => void bootSequence());
chrome.runtime.onStartup.addListener(() => void bootSequence());
void bootSequence();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('[moxy] sidePanel behavior', e));

// ---------- storage helpers ----------

async function loadRules(): Promise<Rule[]> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_RULES);
  return (obj[STORAGE_KEY_RULES] as Rule[] | undefined) ?? [];
}

async function loadGlobalEnabled(): Promise<boolean> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_GLOBAL_ENABLED);
  const v = obj[STORAGE_KEY_GLOBAL_ENABLED] as boolean | undefined;
  return v ?? true;
}

async function saveGlobalEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_GLOBAL_ENABLED]: enabled });
}

async function saveRules(rules: Rule[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_RULES]: rules });
}

async function loadCaptures(): Promise<Capture[]> {
  const obj = await chrome.storage.local.get(STORAGE_KEY_CAPTURES);
  return (obj[STORAGE_KEY_CAPTURES] as Capture[] | undefined) ?? [];
}

async function saveCaptures(captures: Capture[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_CAPTURES]: captures });
}

async function appendCapture(cap: Capture): Promise<void> {
  const all = await loadCaptures();
  all.push(cap);

  // Rolling buffer per tab.
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
  notifyPanel({ kind: 'panel:capture-added', capture: cap });
}

// ---------- broadcasts ----------

function notifyPanel(msg: unknown): void {
  // Side panel listens via chrome.runtime.onMessage. If no listener, sendMessage
  // rejects — swallow.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function broadcastRulesToTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'broadcast:rules-updated' });
  } catch {
    // Tab has no bridge yet (e.g. chrome://, devtools). Ignore.
  }
}

async function broadcastRulesToAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => (t.id ? broadcastRulesToTab(t.id) : Promise.resolve())));
}

// ---------- tab lifecycle ----------

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rules = await loadRules();
  const remaining = rules.filter((r) => r.tabId !== tabId);
  if (remaining.length !== rules.length) {
    await saveRules(remaining);
  }
  const caps = await loadCaptures();
  const remainingCaps = caps.filter((c) => c.tabId !== tabId);
  if (remainingCaps.length !== caps.length) {
    await saveCaptures(remainingCaps);
  }
  notifyPanel({ kind: 'panel:tab-closed', tabId });
});

// ---------- message router ----------

chrome.runtime.onMessage.addListener((msg: SwMessage & { kind: string }, sender, sendResponse) => {
  void handleMessage(msg, sender).then(sendResponse).catch((e) => {
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
    case 'sw:get-rules-for-tab': {
      if (senderTabId == null) return { ok: true, data: [] };
      const enabled = await loadGlobalEnabled();
      if (!enabled) return { ok: true, data: [] };
      const all = await loadRules();
      const forTab = all.filter((r) => r.tabId === senderTabId);
      return { ok: true, data: forTab };
    }
    case 'sw:get-global-enabled': {
      const enabled = await loadGlobalEnabled();
      return { ok: true, data: enabled };
    }
    case 'sw:set-global-enabled': {
      await saveGlobalEnabled(msg.enabled);
      await broadcastRulesToAllTabs();
      notifyPanel({ kind: 'panel:global-toggled', enabled: msg.enabled });
      return { ok: true };
    }
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
    case 'sw:list-rules': {
      const all = await loadRules();
      const filtered = msg.tabId != null ? all.filter((r) => r.tabId === msg.tabId) : all;
      return { ok: true, data: filtered };
    }
    case 'sw:save-rule': {
      const all = await loadRules();
      const idx = all.findIndex((r) => r.id === msg.rule.id);
      if (idx >= 0) all[idx] = msg.rule;
      else all.push(msg.rule);
      await saveRules(all);
      await broadcastRulesToTab(msg.rule.tabId);
      notifyPanel({ kind: 'panel:rules-updated' });
      return { ok: true };
    }
    case 'sw:delete-rule': {
      const all = await loadRules();
      const target = all.find((r) => r.id === msg.ruleId);
      const remaining = all.filter((r) => r.id !== msg.ruleId);
      await saveRules(remaining);
      if (target) await broadcastRulesToTab(target.tabId);
      notifyPanel({ kind: 'panel:rules-updated' });
      return { ok: true };
    }
    case 'sw:toggle-rule': {
      const all = await loadRules();
      const idx = all.findIndex((r) => r.id === msg.ruleId);
      if (idx < 0) return { ok: false, error: 'rule not found' };
      all[idx] = { ...all[idx], enabled: msg.enabled };
      await saveRules(all);
      await broadcastRulesToTab(all[idx].tabId);
      notifyPanel({ kind: 'panel:rules-updated' });
      return { ok: true };
    }
    case 'sw:clear-captures': {
      const all = await loadCaptures();
      const remaining = msg.tabId != null ? all.filter((c) => c.tabId !== msg.tabId) : [];
      await saveCaptures(remaining);
      notifyPanel({ kind: 'panel:captures-cleared', tabId: msg.tabId });
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown message kind: ${(msg as { kind: string }).kind}` };
  }
}

console.log('[moxy] sw booted');
