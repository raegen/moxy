// URL pattern matching + matcher dispatch.
//
// Uses picomatch — the same glob library Vite, Vitest, and esbuild rely on.
// `*` matches a single non-slash run (a host, a path segment), `**` matches
// any run including slashes. The dispatch on Matcher.type uses a `default:
// never` cast so any future matcher variant forces this file to compile-fail
// until a case is added.

import picomatch from 'picomatch';
import type { Matcher } from './types';

// One compiled matcher per pattern. Patterns are stable (they live in the
// scenario file), so cache hits dominate after the first capture.
const matcherCache = new Map<string, (s: string) => boolean>();

export function urlMatches(pattern: string, url: string): boolean {
  if (!pattern) return false;

  // URLPattern-style semantics: parts the pattern doesn't specify are wildcarded.
  // If the user typed a bare endpoint URL with no `?` or `#`, they want it to
  // match the URL regardless of query string or hash fragment. Strip the
  // corresponding pieces from the URL before handing it to picomatch.
  let target = url;
  if (!pattern.includes('?')) {
    const i = target.indexOf('?');
    if (i !== -1) target = target.slice(0, i);
  }
  if (!pattern.includes('#')) {
    const i = target.indexOf('#');
    if (i !== -1) target = target.slice(0, i);
  }

  let m = matcherCache.get(pattern);
  if (!m) {
    // Pre-escape '?' so a pattern that DOES include a query separator matches
    // it literally rather than treating '?' as picomatch's single-char wildcard.
    // URLs also commonly contain literal '{}' and '()' in query payloads, so
    // we disable brace expansion and extglob.
    const safe = pattern.replace(/\?/g, '\\?');
    m = picomatch(safe, { nobrace: true, noext: true, dot: true });
    matcherCache.set(pattern, m);
  }
  return m(target);
}

export function methodMatches(rulMethod: string, requestMethod: string): boolean {
  if (rulMethod === '*' || rulMethod === '' || rulMethod.toUpperCase() === 'ANY') return true;
  return rulMethod.toUpperCase() === requestMethod.toUpperCase();
}

// Dispatch a Matcher against a request. Exhaustiveness enforced via `default: never`
// — adding a new variant to Matcher in types.ts without updating this switch will
// fail TypeScript compilation. That's the v1.2-safety net.
export function matcherMatches(matcher: Matcher, url: string, method: string): boolean {
  switch (matcher.type) {
    case 'url-glob':
      return methodMatches(matcher.method, method) && urlMatches(matcher.pattern, url);
    default: {
      const _exhaustive: never = matcher.type;
      void _exhaustive;
      return false;
    }
  }
}
