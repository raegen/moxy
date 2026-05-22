// ISOLATED world. Runs at document_start.
// Relays messages between MAIN-world patch.ts and the service worker.

import { MOXY_MARKER, type FromMainMessage, type ToMainMessage, type SwResponse } from '../shared/types';

(() => {
  // Idempotency guard. Re-injection via chrome.scripting.executeScript (used by
  // sw.ts injectIntoExistingTabs for the cold-start fix) would otherwise install
  // a duplicate set of listeners, double-emit capture forwards, and leak a stale
  // nonce. The flag lives on globalThis so it survives bundler IIFE wrapping.
  const g = globalThis as typeof globalThis & { __moxy_bridge_installed?: boolean };
  if (g.__moxy_bridge_installed) return;
  g.__moxy_bridge_installed = true;

  const nonce = crypto.randomUUID();

  function postToMain(msg: ToMainMessage) {
    window.postMessage({ __moxy: MOXY_MARKER, payload: msg }, '*');
  }

  // Defensive: when the extension is reloaded during development, content-
  // script instances already running in open tabs become orphaned. Their
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
    return;
  }

  // Send the nonce as soon as the page is alive. patch.ts runs first
  // (document_start, MAIN world), but it buffers calls until it gets the nonce.
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
      if (payload.nonce !== nonce) return;
      void requestRules();
      return;
    }

    if (payload.kind === 'moxy:capture') {
      const rt = safeRuntime();
      if (!rt) return;
      try {
        rt.sendMessage({ kind: 'sw:capture', capture: payload.capture }).catch(() => {});
      } catch {
        // Context invalidated mid-send; drop quietly.
      }
      return;
    }
  });

  async function requestRules() {
    const rt = safeRuntime();
    if (!rt) {
      postToMain({ kind: 'moxy:rules', rules: [], nonce });
      return;
    }
    try {
      const res = (await rt.sendMessage({ kind: 'sw:get-rules-for-tab' })) as SwResponse;
      if (res?.ok && res.data) {
        postToMain({ kind: 'moxy:rules', rules: res.data as never, nonce });
      } else {
        postToMain({ kind: 'moxy:rules', rules: [], nonce });
      }
    } catch {
      postToMain({ kind: 'moxy:rules', rules: [], nonce });
    }
  }

  // Listen for live rule broadcasts from SW. Guard the listener registration
  // itself for the invalidated-context case.
  try {
    safeRuntime()?.onMessage.addListener((msg) => {
      if (msg?.kind === 'broadcast:rules-updated') {
        void requestRules();
      }
    });
  } catch {
    // Listener registration on invalidated context throws; nothing to do.
  }
})();
