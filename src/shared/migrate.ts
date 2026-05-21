// v1 → v1.1 storage migration.
//
// DATA-LOSS critical path. If this breaks, users (you) lose their v1 rules on
// upgrade. The mandate is:
//
//   1. Detect "is migration needed" by reading moxy:formatVersion. Absent =
//      pre-v1.1 storage; needs migration. Present + matches = done; skip.
//   2. Read existing v1 storage (the old key `moxy:rules`).
//   3. Wrap them into a single "Migrated v1 rules" scenario in moxy:scenarios.
//   4. Populate moxy:active for any currently-open tab whose id appears in the
//      v1 rules' tabId field — best-effort restoration of active state.
//   5. Delete the legacy moxy:rules key.
//   6. Write moxy:formatVersion LAST. If anything interrupts before this
//      write, the migration is re-run on next boot — that's why every step
//      above must be idempotent (re-running produces the same result).
//
// The order in step 6 is non-negotiable. Writing formatVersion early means a
// crash mid-migration leaves the storage in a half-converted state we can't
// recover from automatically.

import {
  MOXY_FORMAT_VERSION,
  type Matcher,
  type Rule,
  type Scenario,
} from './types';
import { hashRuleId } from './scenario';

export const STORAGE_KEY_FORMAT_VERSION = 'moxy:formatVersion';
export const STORAGE_KEY_LEGACY_RULES = 'moxy:rules';
export const STORAGE_KEY_SCENARIOS = 'moxy:scenarios';
export const STORAGE_KEY_ACTIVE_SCENARIOS = 'moxy:active';

export const MIGRATED_SCENARIO_NAME = 'Migrated v1 rules';

// Shape of a v1 rule (pre-discriminated-union match). The migration is the
// only place this old shape is named — everything else uses the v1.1 Rule
// type going forward.
export type V1Rule = {
  id: string;
  tabId: number;
  enabled: boolean;
  match: { method: string; urlGlob: string };
  mutate: Rule['mutate'];
  fromCaptureId?: string;
  createdAt: number;
};

// Minimal storage interface. Lets tests inject an in-memory implementation
// instead of mocking chrome.storage.local directly.
export interface StorageAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface MigrationResult {
  ran: boolean;
  reason?: 'already-migrated' | 'no-v1-data' | 'completed' | 'corrupt-v1-data';
  scenarioCreated?: Scenario;
  warnings: string[];
}

export async function migrateV1ToV11(
  storage: StorageAdapter,
  openTabIds: number[] = []
): Promise<MigrationResult> {
  const warnings: string[] = [];

  // Step 1: gate on formatVersion flag.
  const currentVersion = await storage.get(STORAGE_KEY_FORMAT_VERSION);
  if (currentVersion === MOXY_FORMAT_VERSION) {
    return { ran: false, reason: 'already-migrated', warnings };
  }

  // Step 2: read legacy v1 rules.
  let legacyRaw: unknown;
  try {
    legacyRaw = await storage.get(STORAGE_KEY_LEGACY_RULES);
  } catch (e) {
    warnings.push(`failed to read legacy rules: ${e instanceof Error ? e.message : String(e)}`);
    return { ran: false, reason: 'corrupt-v1-data', warnings };
  }

  if (legacyRaw === undefined || legacyRaw === null) {
    // No v1 data to migrate — mark version flag and exit cleanly.
    await storage.set(STORAGE_KEY_FORMAT_VERSION, MOXY_FORMAT_VERSION);
    return { ran: true, reason: 'no-v1-data', warnings };
  }

  if (!Array.isArray(legacyRaw)) {
    warnings.push(
      `legacy moxy:rules is not an array (got ${typeof legacyRaw}); leaving storage untouched`
    );
    return { ran: false, reason: 'corrupt-v1-data', warnings };
  }

  if (legacyRaw.length === 0) {
    // Empty array — clean up the key and mark migrated.
    await storage.remove(STORAGE_KEY_LEGACY_RULES);
    await storage.set(STORAGE_KEY_FORMAT_VERSION, MOXY_FORMAT_VERSION);
    return { ran: true, reason: 'no-v1-data', warnings };
  }

  // Step 3: convert each v1 rule into the new shape. Track which tabIds had
  // rules so we can repopulate moxy:active in step 4.
  const newRules: Omit<Rule, 'tabId'>[] = [];
  const tabIdsWithRules = new Set<number>();
  for (let i = 0; i < legacyRaw.length; i++) {
    const r = legacyRaw[i] as Partial<V1Rule> | null;
    if (!isV1Rule(r)) {
      warnings.push(`legacy rule #${i} is malformed; skipping`);
      continue;
    }
    const newMatch: Matcher = {
      type: 'url-glob',
      pattern: r.match.urlGlob,
      method: r.match.method || '*',
    };
    const id = hashRuleId(newMatch, r.mutate);
    newRules.push({
      id,
      enabled: r.enabled,
      match: newMatch,
      mutate: r.mutate,
      fromCaptureId: r.fromCaptureId,
      createdAt: r.createdAt,
    });
    tabIdsWithRules.add(r.tabId);
  }

  if (newRules.length === 0) {
    // All entries were malformed; treat as no-v1-data and exit.
    await storage.remove(STORAGE_KEY_LEGACY_RULES);
    await storage.set(STORAGE_KEY_FORMAT_VERSION, MOXY_FORMAT_VERSION);
    warnings.push('no migratable v1 rules found; storage cleaned and version flag set');
    return { ran: true, reason: 'no-v1-data', warnings };
  }

  // Step 3b: build the wrapper scenario. Same id every time for idempotency
  // (so re-running migration overwrites cleanly rather than creating duplicates).
  const scenario: Scenario = {
    id: 's_migrated_v1',
    moxyFormatVersion: MOXY_FORMAT_VERSION,
    name: MIGRATED_SCENARIO_NAME,
    description:
      'Auto-created from v1 storage during upgrade. Edit, rename, or split as needed.',
    createdAt: Date.now(),
    rules: newRules,
  };

  // Read any existing scenarios (idempotency: if migration was partially run
  // before, we may already have this scenario). Use the migrated scenario id
  // as the key to overwrite rather than append.
  const existingScenarios = (await safeGet(storage, STORAGE_KEY_SCENARIOS, {})) as Record<
    string,
    Scenario
  >;
  existingScenarios[scenario.id] = scenario;
  await storage.set(STORAGE_KEY_SCENARIOS, existingScenarios);

  // Step 4: populate moxy:active for tabs that had v1 rules AND are currently open.
  const existingActive = (await safeGet(storage, STORAGE_KEY_ACTIVE_SCENARIOS, {})) as Record<
    number,
    string
  >;
  for (const tabId of tabIdsWithRules) {
    if (openTabIds.includes(tabId)) {
      existingActive[tabId] = scenario.id;
    }
  }
  await storage.set(STORAGE_KEY_ACTIVE_SCENARIOS, existingActive);

  // Step 5: delete the legacy key.
  await storage.remove(STORAGE_KEY_LEGACY_RULES);

  // Step 6: write the format version flag LAST. Interruption before this point
  // means migration re-runs on next boot (and is idempotent — scenario id is
  // stable, active populates the same tabs).
  await storage.set(STORAGE_KEY_FORMAT_VERSION, MOXY_FORMAT_VERSION);

  return { ran: true, reason: 'completed', scenarioCreated: scenario, warnings };
}

function isV1Rule(r: unknown): r is V1Rule {
  if (!r || typeof r !== 'object') return false;
  const obj = r as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.tabId !== 'number') return false;
  if (typeof obj.enabled !== 'boolean') return false;
  if (!obj.match || typeof obj.match !== 'object') return false;
  const match = obj.match as Record<string, unknown>;
  if (typeof match.urlGlob !== 'string') return false;
  if (!obj.mutate || typeof obj.mutate !== 'object') return false;
  if (typeof obj.createdAt !== 'number') return false;
  return true;
}

async function safeGet(storage: StorageAdapter, key: string, fallback: unknown): Promise<unknown> {
  try {
    const v = await storage.get(key);
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

// Adapter that wraps chrome.storage.local. Used by sw.ts; not used in tests
// (tests inject an in-memory adapter).
export function chromeStorageAdapter(): StorageAdapter {
  return {
    async get(key) {
      const obj = await chrome.storage.local.get(key);
      return obj[key];
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
    async remove(key) {
      await chrome.storage.local.remove(key);
    },
  };
}
