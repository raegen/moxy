// Opt-in logging gate. Off by default everywhere.
//
// Page contexts (patch.ts MAIN-world, bridge.ts ISOLATED-world, devtools panel,
// side panel): enable via DevTools console on whatever surface you want logs from:
//   localStorage.setItem('moxy:debug', '1')
//   location.reload()  // patch + bridge cache the flag at install time
//
// Service worker (no localStorage): set a global on the SW context. Open the
// SW console from chrome://extensions and run:
//   globalThis.MOXY_DEBUG = true
// The flag is re-read on every dbg() call so changes take effect immediately,
// no SW reload needed. Resets when the SW restarts.

function isDebugEnabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('moxy:debug') === '1';
    }
  } catch {
    /* sandboxed iframe etc — fall through */
  }
  return (globalThis as { MOXY_DEBUG?: boolean }).MOXY_DEBUG === true;
}

export function createDebug(prefix: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (isDebugEnabled()) console.log(`[moxy:${prefix}]`, ...args);
  };
}
