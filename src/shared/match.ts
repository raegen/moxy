// Tiny URL pattern matcher. Uses URLPattern when available, falls back to a
// glob-to-regex shim so v1 doesn't require a polyfill on older Chrome.

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
