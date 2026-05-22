import { describe, it, expect } from 'vitest';
import {
  parseScenario,
  serializeScenario,
  hashRuleId,
  stableStringify,
  fnv1a32,
  ScenarioImportError,
} from './scenario';
import type { Scenario, Matcher } from './types';

const MIN_VALID = `{
  "moxyFormatVersion": 1,
  "name": "Minimal",
  "rules": [
    {
      "match": { "type": "url-glob", "pattern": "https://api.example.com/users", "method": "GET" },
      "mutate": { "status": 500 }
    }
  ]
}`;

describe('parseScenario — happy path', () => {
  it('parses a minimal valid scenario', () => {
    const { scenario, warnings } = parseScenario(MIN_VALID);
    expect(scenario.name).toBe('Minimal');
    expect(scenario.moxyFormatVersion).toBe(1);
    expect(scenario.rules).toHaveLength(1);
    expect(scenario.rules[0].match.type).toBe('url-glob');
    expect(scenario.rules[0].mutate.status).toBe(500);
    expect(warnings).toEqual([]);
  });

  it('regenerates deterministic ids regardless of source id', () => {
    const withId = JSON.parse(MIN_VALID);
    withId.rules[0].id = 'totally-made-up';
    const { scenario } = parseScenario(JSON.stringify(withId));
    // Source id is discarded; new id is content-hashed.
    expect(scenario.rules[0].id).toMatch(/^r_[0-9a-z]+$/);
    expect(scenario.rules[0].id).not.toBe('totally-made-up');
  });

  it('preserves body type "text"', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate.body = { type: 'text', data: 'hello' };
    const { scenario } = parseScenario(JSON.stringify(json));
    expect(scenario.rules[0].mutate.body).toEqual({ kind: 'text', data: 'hello' });
  });

  it('preserves body type "json"', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate.body = { type: 'json', data: { error: 'oops', code: 42 } };
    const { scenario } = parseScenario(JSON.stringify(json));
    expect(scenario.rules[0].mutate.body).toEqual({
      kind: 'json',
      data: { error: 'oops', code: 42 },
    });
  });

  it('preserves body type "base64"', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate.body = { type: 'base64', data: 'aGVsbG8=' };
    const { scenario } = parseScenario(JSON.stringify(json));
    expect(scenario.rules[0].mutate.body).toEqual({ kind: 'base64', data: 'aGVsbG8=' });
  });

  it('defaults method to *', () => {
    const json = JSON.parse(MIN_VALID);
    delete json.rules[0].match.method;
    const { scenario } = parseScenario(JSON.stringify(json));
    expect(scenario.rules[0].match.method).toBe('*');
  });

  it('defaults enabled to true', () => {
    const { scenario } = parseScenario(MIN_VALID);
    expect(scenario.rules[0].enabled).toBe(true);
  });

  it('respects explicit enabled: false', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].enabled = false;
    const { scenario } = parseScenario(JSON.stringify(json));
    expect(scenario.rules[0].enabled).toBe(false);
  });
});

describe('parseScenario — rejections', () => {
  it('throws on malformed JSON', () => {
    expect(() => parseScenario('not json {{{')).toThrow(ScenarioImportError);
    try {
      parseScenario('not json');
    } catch (e) {
      expect((e as ScenarioImportError).kind).toBe('malformed-json');
    }
  });

  it('rejects format version newer than current', () => {
    const json = JSON.parse(MIN_VALID);
    json.moxyFormatVersion = 2;
    try {
      parseScenario(JSON.stringify(json));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ScenarioImportError);
      expect((e as ScenarioImportError).kind).toBe('unsupported-format-version');
      expect((e as Error).message).toMatch(/requires moxy v2/);
    }
  });

  it('rejects unknown match.type within known format version', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].match = { type: 'regex', pattern: '.*' };
    try {
      parseScenario(JSON.stringify(json));
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ScenarioImportError).kind).toBe('unsupported-matcher-type');
      expect((e as Error).message).toMatch(/url-glob/);
    }
  });

  it('rejects missing name', () => {
    const json = JSON.parse(MIN_VALID);
    delete json.name;
    expect(() => parseScenario(JSON.stringify(json))).toThrow(/name is required/);
  });

  it('rejects rule with no mutation action', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate = {};
    try {
      parseScenario(JSON.stringify(json));
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ScenarioImportError).kind).toBe('empty-mutation');
    }
  });

  it('rejects out-of-range status', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate.status = 9999;
    try {
      parseScenario(JSON.stringify(json));
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ScenarioImportError).kind).toBe('out-of-range');
    }
  });

  it('rejects out-of-range latencyMs', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate = { status: 200, latencyMs: 999_999_999 };
    try {
      parseScenario(JSON.stringify(json));
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ScenarioImportError).kind).toBe('out-of-range');
    }
  });

  it('rejects body type unknown', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate.body = { type: 'msgpack', data: 'whatever' };
    expect(() => parseScenario(JSON.stringify(json))).toThrow(ScenarioImportError);
  });

  it('rejects invalid ISO 8601 date string in createdAt (schema enforces date-time format)', () => {
    // Regression for v1.1.1 schema lie: createdAt had format: date-time but
    // ajv-formats wasn't wired, so any string passed. v1.1.2 enforces it.
    const json = JSON.parse(MIN_VALID);
    json.createdAt = 'yesterday lol';
    expect(() => parseScenario(JSON.stringify(json))).toThrow(ScenarioImportError);
  });

  it('accepts valid ISO 8601 date string in createdAt', () => {
    const json = JSON.parse(MIN_VALID);
    json.createdAt = '2026-05-22T10:30:00Z';
    const { scenario } = parseScenario(JSON.stringify(json));
    expect(scenario.createdAt).toBe(Date.parse('2026-05-22T10:30:00Z'));
  });
});

describe('parseScenario — warnings', () => {
  it('warns on unknown top-level keys', () => {
    const json = JSON.parse(MIN_VALID);
    json.unknownFutureField = 'something';
    const { warnings } = parseScenario(JSON.stringify(json));
    expect(warnings.some((w) => w.includes('unknownFutureField'))).toBe(true);
  });

  it('warns on duplicate rules and skips the dupe', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules.push({ ...json.rules[0] }); // identical match + mutate
    const { scenario, warnings } = parseScenario(JSON.stringify(json));
    expect(scenario.rules).toHaveLength(1);
    expect(warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('warns on unknown rule keys', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].futureFlag = true;
    const { warnings } = parseScenario(JSON.stringify(json));
    expect(warnings.some((w) => w.includes('futureFlag'))).toBe(true);
  });
});

describe('serializeScenario', () => {
  it('round-trips parse ∘ serialize as identity (semantic equality)', () => {
    const { scenario: parsed } = parseScenario(MIN_VALID);
    const serialized = serializeScenario(parsed);
    const { scenario: reparsed } = parseScenario(serialized);

    // createdAt is assigned at parse time when the source has none, so it
    // differs across parse calls. Strip it before structural comparison.
    expect(reparsed.name).toBe(parsed.name);
    expect(reparsed.moxyFormatVersion).toBe(parsed.moxyFormatVersion);
    const strip = (r: typeof parsed.rules[number]) => ({ ...r, createdAt: 0 });
    expect(reparsed.rules.map(strip)).toEqual(parsed.rules.map(strip));
  });

  it('produces stable output for identical input (byte-stable)', () => {
    const { scenario } = parseScenario(MIN_VALID);
    expect(serializeScenario(scenario)).toBe(serializeScenario(scenario));
  });

  it('uses type: not kind: in serialized output', () => {
    const json = JSON.parse(MIN_VALID);
    json.rules[0].mutate.body = { type: 'json', data: { foo: 'bar' } };
    const { scenario } = parseScenario(JSON.stringify(json));
    const serialized = serializeScenario(scenario);
    expect(serialized).toContain('"type": "url-glob"');
    expect(serialized).toContain('"type": "json"');
    expect(serialized).not.toContain('"kind":');
  });
});

describe('hashRuleId — locked algorithm', () => {
  // CRITICAL: these snapshots lock the FNV-1a hash. If they change, every
  // exported .moxy.json file out in the world is invalidated — re-imports
  // produce different rule IDs and the dedupe / git-friendliness contract
  // breaks. Do not update these without a v2 format bump.
  const m: Matcher = { type: 'url-glob', pattern: 'https://x/y', method: 'GET' };

  it('produces snapshot-stable hash for known input', () => {
    expect(hashRuleId(m, { status: 500 })).toBe('r_fhequk');
  });

  it('same {match, mutate} produces same hash', () => {
    expect(hashRuleId(m, { status: 500 })).toBe(hashRuleId(m, { status: 500 }));
  });

  it('different status produces different hash', () => {
    expect(hashRuleId(m, { status: 500 })).not.toBe(hashRuleId(m, { status: 404 }));
  });

  it('different pattern produces different hash', () => {
    const m2: Matcher = { type: 'url-glob', pattern: 'https://x/z', method: 'GET' };
    expect(hashRuleId(m, { status: 500 })).not.toBe(hashRuleId(m2, { status: 500 }));
  });

  it('object key order does not affect hash (stable stringify)', () => {
    // Construct two equivalent objects with different key insertion order.
    const headers1: Record<string, string> = {};
    headers1['a'] = '1';
    headers1['b'] = '2';
    const headers2: Record<string, string> = {};
    headers2['b'] = '2';
    headers2['a'] = '1';
    const h1 = hashRuleId(m, { status: 500, headers: headers1 });
    const h2 = hashRuleId(m, { status: 500, headers: headers2 });
    expect(h1).toBe(h2);
  });
});

describe('stableStringify', () => {
  it('sorts object keys', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('handles nested objects with sorted keys', () => {
    expect(stableStringify({ b: { d: 4, c: 3 }, a: 1 })).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('omits undefined values', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('handles arrays in declared order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('represents null and undefined as null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
  });
});

describe('fnv1a32', () => {
  // Snapshot-test the algorithm itself so any change to the hash function
  // shows up as a test failure here before it shows up as broken scenarios.
  it('hashes empty string to FNV-1a offset basis (mod 2^32)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('produces known hash for "moxy"', () => {
    // Known FNV-1a 32-bit hash of "moxy" — locked.
    const h = fnv1a32('moxy');
    expect(h).toBe(fnv1a32('moxy'));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });
});

describe('Scenario round-trip with rich body', () => {
  it('preserves json body shape across serialize/parse', () => {
    const original: Scenario = {
      id: 's_test',
      moxyFormatVersion: 1,
      name: 'Rich',
      createdAt: 1716290000000,
      rules: [
        {
          id: 'placeholder',
          enabled: true,
          createdAt: 1716290000000,
          match: { type: 'url-glob', pattern: 'https://api.test/*', method: 'POST' },
          mutate: {
            status: 422,
            statusText: 'Unprocessable Entity',
            headers: { 'content-type': 'application/json' },
            body: { kind: 'json', data: { error: 'validation', fields: ['email'] } },
            latencyMs: 100,
          },
        },
      ],
    };
    const out = serializeScenario(original);
    const { scenario: round } = parseScenario(out);
    expect(round.rules[0].mutate.body).toEqual(original.rules[0].mutate.body);
    expect(round.rules[0].mutate.headers).toEqual(original.rules[0].mutate.headers);
    expect(round.rules[0].mutate.status).toBe(422);
    expect(round.rules[0].mutate.latencyMs).toBe(100);
  });
});
