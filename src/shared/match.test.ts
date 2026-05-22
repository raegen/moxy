import { describe, it, expect } from 'vitest';
import { urlMatches, methodMatches } from './match';

describe('urlMatches', () => {
  it('matches exact URL', () => {
    expect(urlMatches('https://api.example.com/v1/users', 'https://api.example.com/v1/users')).toBe(
      true
    );
  });

  it('matches wildcard path segments via *', () => {
    expect(urlMatches('https://api.example.com/v1/users/*', 'https://api.example.com/v1/users/42')).toBe(
      true
    );
  });

  it('matches across path segments via **', () => {
    expect(urlMatches('https://api.example.com/**', 'https://api.example.com/v1/users/42/profile')).toBe(
      true
    );
  });

  it('does not match different host', () => {
    expect(urlMatches('https://api.example.com/users', 'https://api.other.com/users')).toBe(false);
  });

  it('returns false for empty pattern', () => {
    expect(urlMatches('', 'https://api.example.com/users')).toBe(false);
  });

  // Regression: v1.3 dropped the URLPattern fast path because URLPattern's port
  // matcher treats unspecified ports as "protocol default" (443/80), not as a
  // wildcard. Patterns like `*://*/path` failed against any URL with an explicit
  // non-default port (every localhost dev URL).
  it('matches wildcard scheme + host against a URL with a non-default port', () => {
    expect(
      urlMatches(
        '*://*/com/api/v1/backoffice/user/filter',
        'https://localhost:3000/com/api/v1/backoffice/user/filter'
      )
    ).toBe(true);
  });

  it('matches wildcard scheme + host across http and https', () => {
    expect(urlMatches('*://example.com/users', 'http://example.com/users')).toBe(true);
    expect(urlMatches('*://example.com/users', 'https://example.com/users')).toBe(true);
  });

  it('wildcards a port-bearing host', () => {
    expect(urlMatches('https://*/api', 'https://staging.acme.com:8443/api')).toBe(true);
  });

  it('matches subdomains via host-level *', () => {
    expect(urlMatches('https://*.example.com/users', 'https://api.example.com/users')).toBe(true);
    expect(urlMatches('https://*.example.com/users', 'https://www.staging.example.com/users')).toBe(
      true
    );
  });

  it('treats ? as a literal query-string separator, not a glob wildcard', () => {
    // Pattern with ? should match the URL with ? in the same position, NOT
    // an arbitrary single character there.
    expect(urlMatches('https://api.example.com/users?id=42', 'https://api.example.com/usersXid=42'))
      .toBe(false);
    expect(urlMatches('https://api.example.com/users?id=42', 'https://api.example.com/users?id=42'))
      .toBe(true);
  });

  it('matches with ** across a query string', () => {
    expect(urlMatches('https://api.example.com/**', 'https://api.example.com/users?id=42&q=foo'))
      .toBe(true);
  });

  // URLPattern-style: pattern parts that aren't specified are wildcarded.
  // Common workflow: paste a captured URL as a rule pattern; that pasted URL
  // has no query string; the rule should match any incoming URL with the same
  // path regardless of query.
  it('matches a literal endpoint pattern against URLs with appended query strings', () => {
    expect(
      urlMatches(
        'https://localhost:3000/com/api/v2/celery-tasks',
        'https://localhost:3000/com/api/v2/celery-tasks?task_type=bulk_members_change_status&status=pending&_start=0&_end=1'
      )
    ).toBe(true);
  });

  it('matches a literal endpoint pattern against URLs with hash fragments', () => {
    expect(
      urlMatches('https://example.com/page', 'https://example.com/page#section-2')
    ).toBe(true);
  });

  it('still treats an explicit ? in the pattern as a literal separator', () => {
    // Pattern WITH query → URL's query is part of the match target.
    expect(
      urlMatches('https://api.example.com/users?id=42', 'https://api.example.com/users?id=42')
    ).toBe(true);
    expect(
      urlMatches('https://api.example.com/users?id=42', 'https://api.example.com/users?id=99')
    ).toBe(false);
  });
});

describe('methodMatches', () => {
  it('matches identical methods case-insensitively', () => {
    expect(methodMatches('GET', 'GET')).toBe(true);
    expect(methodMatches('post', 'POST')).toBe(true);
    expect(methodMatches('PUT', 'put')).toBe(true);
  });

  it('treats * as wildcard', () => {
    expect(methodMatches('*', 'GET')).toBe(true);
    expect(methodMatches('*', 'POST')).toBe(true);
    expect(methodMatches('*', 'DELETE')).toBe(true);
  });

  it('treats empty string as wildcard', () => {
    expect(methodMatches('', 'GET')).toBe(true);
  });

  it('treats ANY as wildcard', () => {
    expect(methodMatches('ANY', 'GET')).toBe(true);
    expect(methodMatches('any', 'GET')).toBe(true);
  });

  it('rejects mismatched methods', () => {
    expect(methodMatches('GET', 'POST')).toBe(false);
  });
});
