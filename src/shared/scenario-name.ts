// Human-friendly scenario name derivation.
//
// Used when an ephemeral scenario is auto-created on first rule-save in a tab.
// The old name was `Untitled (DevTools) — tab ${tabId}` — both halves of that
// were noise. tabIds are huge session counters; users recognize page titles.

export const FALLBACK_NAME = 'Untitled scenario';

// Pure: derive a name from (title, url). Hosts pass these in; this module
// doesn't touch chrome.* so it stays test-friendly.
export function deriveScenarioName(title: string | undefined, url: string | undefined): string {
  const cleanTitle = (title ?? '').trim();
  const host = hostnameOf(url);

  if (cleanTitle && host && cleanTitle !== host) {
    return `${cleanTitle} — ${host}`;
  }
  if (cleanTitle) return cleanTitle;
  if (host) return host;
  return FALLBACK_NAME;
}

// Returns hostname (+ port) for http(s) URLs only. chrome://, file://, etc.
// fall through to empty string — they have no meaningful host to show users.
function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.host; // includes port if non-default
  } catch {
    return '';
  }
}
