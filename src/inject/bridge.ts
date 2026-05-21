// ISOLATED world. Runs at document_start.
// Relays messages between MAIN-world patch.ts and the service worker.

import { MOXY_MARKER, type FromMainMessage, type ToMainMessage, type SwResponse } from '../shared/types';

const nonce = crypto.randomUUID();

function postToMain(msg: ToMainMessage) {
  window.postMessage({ __moxy: MOXY_MARKER, payload: msg }, '*');
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
    // Patch is ready — ask SW for the rule set for this tab.
    void requestRules();
    return;
  }

  if (payload.kind === 'moxy:capture') {
    chrome.runtime
      .sendMessage({ kind: 'sw:capture', capture: payload.capture })
      .catch(() => {
        // SW may be asleep / extension reloading; drop quietly.
      });
    return;
  }
});

async function requestRules() {
  try {
    const res = (await chrome.runtime.sendMessage({
      kind: 'sw:get-rules-for-tab',
    })) as SwResponse;
    if (res?.ok && res.data) {
      postToMain({ kind: 'moxy:rules', rules: res.data as never, nonce });
    } else {
      postToMain({ kind: 'moxy:rules', rules: [], nonce });
    }
  } catch {
    postToMain({ kind: 'moxy:rules', rules: [], nonce });
  }
}

// Listen for live rule broadcasts from SW.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'broadcast:rules-updated') {
    void requestRules();
  }
});
