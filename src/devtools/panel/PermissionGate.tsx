import { useEffect, useState, useCallback } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

// Gates the DevTools panel content behind a per-origin host permission.
//
// On mount: read the inspected tab's URL via chrome.tabs.get(tabId), derive
// origin, check chrome.permissions.contains. If missing, attempt a single
// auto-request riding whatever user gesture brought us here. If Chrome refuses
// (gesture window expired), fall back to a manual "Grant access" button.
//
// Re-checks on chrome.devtools.network.onNavigated (origin can change within
// the same tabId) and on panel:permissions-changed broadcasts from the SW
// (handles external grants/revokes via chrome://extensions).

type GateState =
  | { kind: 'checking' }
  | { kind: 'no-origin' }
  | { kind: 'granted'; origin: string; freshlyGranted: boolean }
  | { kind: 'denied'; origin: string; awaitingUser: boolean };

function originFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null; // file://, chrome://, etc.
    return u.origin;
  } catch {
    return null;
  }
}

function patternForOrigin(origin: string): string {
  return `${origin}/*`;
}

export function PermissionGate({
  tabId,
  children,
}: {
  tabId: number;
  children: ComponentChildren;
}) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });

  const checkOrigin = useCallback(
    async (origin: string | null, autoRequest: boolean): Promise<void> => {
      if (!origin) {
        setState({ kind: 'no-origin' });
        return;
      }
      const origins = [patternForOrigin(origin)];
      try {
        const has = await chrome.permissions.contains({ origins });
        if (has) {
          setState((prev) => ({
            kind: 'granted',
            origin,
            freshlyGranted: prev.kind === 'denied',
          }));
          return;
        }
        if (autoRequest) {
          try {
            const granted = await chrome.permissions.request({ origins });
            if (granted) {
              setState({ kind: 'granted', origin, freshlyGranted: true });
              return;
            }
            setState({ kind: 'denied', origin, awaitingUser: true });
          } catch {
            // Gesture window probably expired; fall through to the manual button.
            setState({ kind: 'denied', origin, awaitingUser: true });
          }
        } else {
          setState({ kind: 'denied', origin, awaitingUser: true });
        }
      } catch (e) {
        console.warn('[moxy] permission check failed', e);
        setState({ kind: 'denied', origin, awaitingUser: true });
      }
    },
    []
  );

  // Initial mount: read tab URL, derive origin, check + maybe auto-request.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        const origin = originFromUrl(tab?.url);
        if (cancelled) return;
        await checkOrigin(origin, /*autoRequest*/ true);
      } catch (e) {
        if (cancelled) return;
        console.warn('[moxy] tab lookup failed', e);
        setState({ kind: 'no-origin' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tabId, checkOrigin]);

  // React to navigation within the inspected tab — origin may change.
  useEffect(() => {
    const onNav = (url: string) => {
      const origin = originFromUrl(url);
      void checkOrigin(origin, /*autoRequest*/ false);
    };
    chrome.devtools?.network?.onNavigated?.addListener(onNav);
    return () => chrome.devtools?.network?.onNavigated?.removeListener(onNav);
  }, [checkOrigin]);

  // React to SW broadcasts on permission grant/revoke.
  useEffect(() => {
    const listener = (msg: { kind?: string }) => {
      if (msg?.kind === 'panel:permissions-changed') {
        // Re-read tab URL because origin could have changed between check and now.
        void (async () => {
          try {
            const tab = await chrome.tabs.get(tabId);
            const origin = originFromUrl(tab?.url);
            await checkOrigin(origin, /*autoRequest*/ false);
          } catch {
            /* ignore */
          }
        })();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId, checkOrigin]);

  const requestGrant = useCallback(async () => {
    if (state.kind !== 'denied') return;
    const origins = [patternForOrigin(state.origin)];
    try {
      const granted = await chrome.permissions.request({ origins });
      if (granted) {
        setState({ kind: 'granted', origin: state.origin, freshlyGranted: true });
      }
    } catch (e) {
      console.error('[moxy] permission request failed', e);
    }
  }, [state]);

  if (state.kind === 'checking') {
    return <div class="empty">checking permissions…</div>;
  }

  if (state.kind === 'no-origin') {
    return (
      <div class="empty">
        moxy can only mock <code>http(s)://</code> origins.
        <br />
        Navigate the inspected tab to a regular web page to use moxy here.
      </div>
    );
  }

  if (state.kind === 'denied') {
    return (
      <div class="grant-banner">
        <h2>moxy needs access to {new URL(state.origin).host}</h2>
        <p>
          Grant permission to intercept <code>fetch</code> and{' '}
          <code>XMLHttpRequest</code> on this origin.
        </p>
        <button class="btn-primary" onClick={() => void requestGrant()}>
          Grant access to {new URL(state.origin).host}
        </button>
        <p class="hint">
          You can revoke access anytime from <code>chrome://extensions</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      {state.freshlyGranted && <FreshGrantNote origin={state.origin} />}
      {children}
    </>
  );
}

// Inline banner shown above the App after a fresh grant. Tells the user that
// requests fired during page load won't have been captured yet. Auto-dismisses
// after 12 seconds, or on click.
function FreshGrantNote({ origin }: { origin: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 12_000);
    return () => clearTimeout(t);
  }, [origin]);
  if (!visible) return null;
  return (
    <div
      class="reload-hint"
      role="status"
      onClick={() => setVisible(false)}
      title="dismiss"
    >
      Reload {new URL(origin).host} to mock requests fired during page load.
    </div>
  );
}
