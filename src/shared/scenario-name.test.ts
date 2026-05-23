import { describe, it, expect } from 'vitest';
import { deriveScenarioName, FALLBACK_NAME } from './scenario-name';

describe('deriveScenarioName', () => {
  it('combines title + hostname when both are useful', () => {
    expect(deriveScenarioName('GitHub · raegen/moxy', 'https://github.com/raegen/moxy')).toBe(
      'GitHub · raegen/moxy — github.com'
    );
  });

  it('includes the port in the hostname half', () => {
    expect(deriveScenarioName('Vite dev server', 'http://localhost:3000/app')).toBe(
      'Vite dev server — localhost:3000'
    );
  });

  it('falls back to title only when URL has no http(s) host', () => {
    expect(deriveScenarioName('Local file viewer', 'file:///Users/me/page.html')).toBe(
      'Local file viewer'
    );
  });

  it('falls back to hostname only when title is empty', () => {
    expect(deriveScenarioName('', 'https://api.example.com/users')).toBe('api.example.com');
  });

  it('treats whitespace-only titles as empty', () => {
    expect(deriveScenarioName('   ', 'https://api.example.com/')).toBe('api.example.com');
  });

  it('does not duplicate the hostname when title equals host', () => {
    expect(deriveScenarioName('localhost:3000', 'http://localhost:3000/path')).toBe(
      'localhost:3000'
    );
  });

  it('falls back to the constant when both title and host are unavailable', () => {
    expect(deriveScenarioName(undefined, 'chrome://extensions')).toBe(FALLBACK_NAME);
    expect(deriveScenarioName('', undefined)).toBe(FALLBACK_NAME);
    expect(deriveScenarioName(undefined, undefined)).toBe(FALLBACK_NAME);
  });

  it('handles malformed URLs by falling through to title or fallback', () => {
    expect(deriveScenarioName('My scenario', 'not a url')).toBe('My scenario');
    expect(deriveScenarioName(undefined, 'not a url')).toBe(FALLBACK_NAME);
  });
});
