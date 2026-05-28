// ISOLATED world. Runs at document_start.
// Relays messages between MAIN-world patch.ts and the service worker.

import { MOXY_MARKER, type FromMainMessage, type ToMainMessage, type SwResponse } from '../shared/types';
import { createDebug } from '../shared/debug';

const dbg = createDebug('bridge');

(() => {
  // Idempotency guard. Re-injection via chrome.scripting.executeScript (used by
  // sw.ts injectIntoExistingTabs for the cold-start fix) would otherwise install
  // a duplicate set of listeners, double-emit capture forwards, and leak a stale
  // nonce. The flag lives on globalThis so it survives bundler IIFE wrapping.
  const g = globalThis as typeof globalThis & { __moxy_bridge_installed?: boolean };
  if (g.__moxy_bridge_installed) {
    dbg('install skipped (already installed)');
    return;
  }
  g.__moxy_bridge_installed = true;

  const nonce = crypto.randomUUID();
  dbg('install', { nonce, url: location.href });

  function postToMain(msg: ToMainMessage) {
    window.postMessage({ __moxy: MOXY_MARKER, payload: msg }, '*');
  }

  // Defensive: when the extension is reloaded during development, content-
  // script instances already running in open tabs beco me orphaned. Their
  // `chrome.runtime` reference becomes undefined (or accessing it throws
  // "Extension context invalidated"). We can't recover those instances —
  // the new injected bridge supersedes them — but we must not throw an
  // uncaught error every time a fetch fires in the old context.
  function safeRuntime(): typeof chrome.runtime | null {
    try {
      // `chrome` may be undefined; `chrome.runtime` may be undefined; the
      // getter for `chrome.runtime.id` throws on invalidated contexts.
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        return null;
      }
      return chrome.runtime;
    } catch {
      return null;
    }
  }

  if (!safeRuntime()) {
    // Bail without installing listeners. This instance is in an invalidated
    // context (extension reload during page lifetime); the new injection has
    // already installed a working bridge.
    dbg('install aborted (runtime invalidated)');
    return;
  }

  // Tell the SW a fresh document just loaded. The SW uses this to clear
  // stale captures for the tab when "Preserve log" is off (DevTools Network
  // panel semantics). Fired once per bridge install — the install guard above
  // means executeScript-driven re-injection on the same document is a no-op,
  // and SPA route changes don't re-run content scripts at all, so this only
  // fires for actual full document loads.
  try {
    safeRuntime()
      ?.sendMessage({ kind: 'sw:new-document' })
      .then((res) => dbg('sw:new-document resolved', res))
      .catch((e) => dbg('sw:new-document rejected', e));
  } catch (e) {
    dbg('sw:new-document threw sync', e);
  }

  // Send the nonce as soon as the page is alive. patch.ts runs first
  // (document_start, MAIN world), but it buffers calls until it gets the nonce.
  dbg('nonce → main');
  postToMain({ kind: 'moxy:nonce', nonce });

  // Listen for messages from MAIN.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__moxy !== MOXY_MARKER) return;
    const payload = data.payload as FromMainMessage | undefined;
    if (!payload) return;

    // Validate handshake from MAIN: it must echo our nonce.
    if (payload.kind === 'moxy:handshake') {
      if (payload.nonce !== nonce) {
        dbg('handshake dropped (nonce mismatch)');
        return;
      }
      dbg('handshake ok → requesting rules');
      void requestRules();
      return;
    }

    if (payload.kind === 'moxy:capture') {
      const rt = safeRuntime();
      if (!rt) {
        dbg('capture dropped (runtime invalidated)', payload.capture.id);
        return;
      }
      dbg('capture → sw', { id: payload.capture.id, url: payload.capture.request.url });
      try {
        rt.sendMessage({ kind: 'sw:capture', capture: payload.capture })
          .then((res) => dbg('sw:capture resolved', res))
          .catch((e) => dbg('sw:capture rejected', e));
      } catch (e) {
        // Context invalidated mid-send; drop quietly.
        dbg('sw:capture threw sync', e);
      }
      return;
    }
  });

  async function requestRules() {
    const rt = safeRuntime();
    if (!rt) {
      dbg('requestRules: runtime invalidated → empty rules');
      postToMain({ kind: 'moxy:rules', rules: [], nonce });
      return;
    }
    try {
      const res = (await rt.sendMessage({ kind: 'sw:get-rules-for-tab' })) as SwResponse;
      if (res?.ok && res.data) {
        dbg('rules from sw', { count: (res.data as unknown[]).length });
        postToMain({ kind: 'moxy:rules', rules: res.data as never, nonce });
      } else {
        dbg('rules from sw: empty', res);
        postToMain({ kind: 'moxy:rules', rules: [], nonce });
      }
    } catch (e) {
      dbg('rules from sw: threw', e);
      postToMain({ kind: 'moxy:rules', rules: [], nonce });
    }
  }

  // Listen for live rule broadcasts from SW. Guard the listener registration
  // itself for the invalidated-context case.
  try {
    safeRuntime()?.onMessage.addListener((msg) => {
      if (msg?.kind === 'broadcast:rules-updated') {
        dbg('broadcast:rules-updated → re-requesting rules');
        void requestRules();
      }
    });
  } catch (e) {
    // Listener registration on invalidated context throws; nothing to do.
    dbg('runtime.onMessage register threw', e);
  }
})();
