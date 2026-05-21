// URL pattern matching + matcher dispatch.
//
// Uses URLPattern when the runtime exposes it (Chrome 95+), falling back to a
// glob-to-regex shim. The dispatch on Matcher.type uses a `default: never` cast
// so any future matcher type added to types.ts forces this file to compile-fail
// until a case is added. Catches v1.2 regressions at build time, not at runtime.

import type { Matcher } from './types';

type URLPatternLike = new (init: string | object) => { test(url: string): boolean };

export function urlMatches(pattern: string, url: string): boolean {
  if (!pattern) return false;
  // Native URLPattern: handles ://, host, path, query naturally.
  const URLPatternCtor = (globalThis as { URLPattern?: URLPatternLike }).URLPattern;
  if (typeof URLPatternCtor === 'function') {
    try {
      return new URLPatternCtor(pattern).test(url);
    } catch {
      // Pattern wasn't a valid URLPattern (e.g. user-friendly globs). Fall through.
    }
  }
  return globToRegex(pattern).test(url);
}

function globToRegex(glob: string): RegExp {
  // Convert a minimatch-ish glob into a regex. ** = any chars including /, * = any except /
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (/[\\^$.|+()[\]{}]/.test(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  out += '$';
  return new RegExp(out);
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
