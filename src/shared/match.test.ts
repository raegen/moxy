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
