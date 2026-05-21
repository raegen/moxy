// DATA-LOSS regression tests for migrate.ts.
//
// These tests exist because migration runs once on upgrade against the user's
// real storage. If migration breaks, users lose v1 rules. Each test below
// names a specific failure mode that would have caused data loss in the past.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  migrateV1ToV11,
  MIGRATED_SCENARIO_NAME,
  STORAGE_KEY_FORMAT_VERSION,
  STORAGE_KEY_LEGACY_RULES,
  STORAGE_KEY_SCENARIOS,
  STORAGE_KEY_ACTIVE_SCENARIOS,
  type StorageAdapter,
  type V1Rule,
} from './migrate';
import { MOXY_FORMAT_VERSION } from './types';

// In-memory adapter, semantically equivalent to chrome.storage.local
// (per-key get/set/remove). No serialization on the boundary — values are
// stored by reference, which matches chrome.storage.local's deep-clone
// semantics closely enough for these tests.
function inMemoryStorage(initial: Record<string, unknown> = {}): {
  adapter: StorageAdapter;
  snapshot: () => Record<string, unknown>;
} {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    adapter: {
      async get(key) {
        return store.has(key) ? structuredClone(store.get(key)) : undefined;
      },
      async set(key, value) {
        store.set(key, structuredClone(value));
      },
      async remove(key) {
        store.delete(key);
      },
    },
    snapshot: () => Object.fromEntries(store.entries()),
  };
}

function makeV1Rule(overrides: Partial<V1Rule> = {}): V1Rule {
  return {
    id: 'r-old-1',
    tabId: 42,
    enabled: true,
    match: { method: 'GET', urlGlob: 'https://api.example.com/users' },
    mutate: { status: 500 },
    createdAt: 1716000000000,
    ...overrides,
  };
}

describe('migrateV1ToV11 — DATA-LOSS scenarios', () => {
  let storage: ReturnType<typeof inMemoryStorage>;

  beforeEach(() => {
    storage = inMemoryStorage();
  });

  it('[DATA-LOSS] empty v1 storage → no-op (does not crash, does not destroy other state)', async () => {
    storage = inMemoryStorage({
      'moxy:enabled': true, // unrelated state must survive
    });
    const result = await migrateV1ToV11(storage.adapter);
    expect(result.ran).toBe(true);
    expect(result.reason).toBe('no-v1-data');
    const snap = storage.snapshot();
    expect(snap['moxy:enabled']).toBe(true);
    expect(snap[STORAGE_KEY_FORMAT_VERSION]).toBe(MOXY_FORMAT_VERSION);
  });

  it('[DATA-LOSS] v1 rules → wrapped into "Migrated v1 rules" scenario', async () => {
    storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: [makeV1Rule()],
    });
    const result = await migrateV1ToV11(storage.adapter);
    expect(result.ran).toBe(true);
    expect(result.reason).toBe('completed');
    expect(result.scenarioCreated?.name).toBe(MIGRATED_SCENARIO_NAME);
    expect(result.scenarioCreated?.rules).toHaveLength(1);
    expect(result.scenarioCreated?.rules[0].match).toEqual({
      type: 'url-glob',
      pattern: 'https://api.example.com/users',
      method: 'GET',
    });
    expect(result.scenarioCreated?.rules[0].mutate.status).toBe(500);

    const scenarios = storage.snapshot()[STORAGE_KEY_SCENARIOS] as Record<string, unknown>;
    expect(Object.keys(scenarios)).toHaveLength(1);
  });

  it('[DATA-LOSS] open tabs with v1 rule.tabId match → moxy:active populated', async () => {
    storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: [makeV1Rule({ tabId: 42 })],
    });
    const result = await migrateV1ToV11(storage.adapter, [42, 99]);
    const active = storage.snapshot()[STORAGE_KEY_ACTIVE_SCENARIOS] as Record<string, string>;
    expect(active[42]).toBe(result.scenarioCreated?.id);
    expect(active[99]).toBeUndefined();
  });

  it('[DATA-LOSS] corrupt v1 storage → safe fail, no overwrite of other keys', async () => {
    storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: 'not an array, oops',
      'moxy:enabled': true,
      'moxy:captures': [{ id: 'c1', tabId: 1, ts: 0 }], // pre-existing valuable state
    });
    const result = await migrateV1ToV11(storage.adapter);
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('corrupt-v1-data');
    const snap = storage.snapshot();
    // Critical: corrupt source must NOT overwrite or clear other state.
    expect(snap['moxy:enabled']).toBe(true);
    expect(snap['moxy:captures']).toBeTruthy();
    // formatVersion must NOT be marked migrated, so a fix on next boot can retry.
    expect(snap[STORAGE_KEY_FORMAT_VERSION]).toBeUndefined();
  });

  it('[DATA-LOSS] idempotent — re-running produces the same final state', async () => {
    storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: [makeV1Rule(), makeV1Rule({ id: 'r-old-2', mutate: { status: 404 } })],
    });
    const r1 = await migrateV1ToV11(storage.adapter);
    expect(r1.reason).toBe('completed');
    const snap1 = storage.snapshot();

    // Re-running on already-migrated storage should be a no-op.
    const r2 = await migrateV1ToV11(storage.adapter);
    expect(r2.ran).toBe(false);
    expect(r2.reason).toBe('already-migrated');
    const snap2 = storage.snapshot();
    expect(snap2).toEqual(snap1);
  });

  it('[DATA-LOSS] formatVersion flag written LAST → interrupted migration retries cleanly', async () => {
    // Simulate an interruption: run migration but throw between writing scenarios
    // and writing formatVersion. Verify that re-running completes the migration.
    let failOnFormatVersionSet = true;
    const wrappedAdapter: StorageAdapter = {
      ...storage.adapter,
      async set(key, value) {
        if (key === STORAGE_KEY_FORMAT_VERSION && failOnFormatVersionSet) {
          throw new Error('simulated crash before format version flag set');
        }
        return storage.adapter.set(key, value);
      },
    };
    storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: [makeV1Rule()],
    });
    // Re-bind the wrapped adapter to the freshly initialized storage.
    const wrappedAdapter2: StorageAdapter = {
      async get(key) {
        return storage.adapter.get(key);
      },
      async set(key, value) {
        if (key === STORAGE_KEY_FORMAT_VERSION && failOnFormatVersionSet) {
          throw new Error('simulated crash');
        }
        return storage.adapter.set(key, value);
      },
      async remove(key) {
        return storage.adapter.remove(key);
      },
    };

    // First run: throws on the formatVersion write.
    await expect(migrateV1ToV11(wrappedAdapter2)).rejects.toThrow('simulated crash');

    // Verify: scenario was written, but formatVersion was NOT (so retry is possible).
    const snap = storage.snapshot();
    expect(snap[STORAGE_KEY_SCENARIOS]).toBeTruthy();
    expect(snap[STORAGE_KEY_FORMAT_VERSION]).toBeUndefined();
    // Legacy key — could be either deleted or not depending on order; check that
    // either way, retry recovers.

    // Second run: allow formatVersion to be written. Migration should complete.
    failOnFormatVersionSet = false;
    const r2 = await migrateV1ToV11(wrappedAdapter2);
    // Either completed (legacy key still present) or no-v1-data (legacy was deleted in run 1).
    expect(r2.ran).toBe(true);
    expect(['completed', 'no-v1-data']).toContain(r2.reason);
    expect(storage.snapshot()[STORAGE_KEY_FORMAT_VERSION]).toBe(MOXY_FORMAT_VERSION);

    void wrappedAdapter; // keep linter happy about the unused first wrapper
  });
});

describe('migrateV1ToV11 — robustness', () => {
  it('skips malformed entries in v1 rules array but migrates the rest', async () => {
    const storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: [
        makeV1Rule(),
        null, // malformed
        { totally: 'wrong shape' }, // malformed
        makeV1Rule({ id: 'r-old-2', mutate: { status: 404 } }),
      ],
    });
    const result = await migrateV1ToV11(storage.adapter);
    expect(result.ran).toBe(true);
    expect(result.scenarioCreated?.rules).toHaveLength(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('removes the legacy moxy:rules key on successful migration', async () => {
    const storage = inMemoryStorage({
      [STORAGE_KEY_LEGACY_RULES]: [makeV1Rule()],
    });
    await migrateV1ToV11(storage.adapter);
    expect(storage.snapshot()[STORAGE_KEY_LEGACY_RULES]).toBeUndefined();
  });
});
