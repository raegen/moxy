// Storage helpers for scenarios + active-scenario state.
//
// Pure functions over a StorageAdapter — same pattern as migrate.ts so tests
// can inject an in-memory store instead of mocking chrome.storage.local.
//
// All write operations should be wrapped in withWriteLock() by the caller
// (sw.ts handles this); this module deliberately does NOT pull in storage.ts
// because that would couple the locking primitive to the data layer. Locks
// belong at the message-handler boundary, not in low-level storage code.

import type { Rule, Scenario } from './types';
import type { StorageAdapter } from './migrate';

export const STORAGE_KEY_SCENARIOS = 'moxy:scenarios';
export const STORAGE_KEY_ACTIVE = 'moxy:active';

const EPHEMERAL_NAME_PREFIX = 'Untitled (DevTools)';

// ---------- scenarios ----------

export async function listScenarios(storage: StorageAdapter): Promise<Scenario[]> {
  const raw = (await storage.get(STORAGE_KEY_SCENARIOS)) as Record<string, Scenario> | undefined;
  if (!raw) return [];
  return Object.values(raw);
}

export async function getScenario(
  storage: StorageAdapter,
  scenarioId: string
): Promise<Scenario | null> {
  const raw = (await storage.get(STORAGE_KEY_SCENARIOS)) as Record<string, Scenario> | undefined;
  return raw?.[scenarioId] ?? null;
}

export async function saveScenario(storage: StorageAdapter, scenario: Scenario): Promise<void> {
  const raw =
    ((await storage.get(STORAGE_KEY_SCENARIOS)) as Record<string, Scenario> | undefined) ?? {};
  raw[scenario.id] = scenario;
  await storage.set(STORAGE_KEY_SCENARIOS, raw);
}

export async function deleteScenario(storage: StorageAdapter, scenarioId: string): Promise<void> {
  const raw =
    ((await storage.get(STORAGE_KEY_SCENARIOS)) as Record<string, Scenario> | undefined) ?? {};
  delete raw[scenarioId];
  await storage.set(STORAGE_KEY_SCENARIOS, raw);
  // Also unload from any tabs that had it active.
  const active = ((await storage.get(STORAGE_KEY_ACTIVE)) as Record<number, string> | undefined) ?? {};
  let changed = false;
  for (const [tabId, sid] of Object.entries(active)) {
    if (sid === scenarioId) {
      delete active[tabId as unknown as number];
      changed = true;
    }
  }
  if (changed) await storage.set(STORAGE_KEY_ACTIVE, active);
}

// Auto-rename on library import: "Checkout 500" → "Checkout 500 (2)" if taken.
// Walks existing scenario names; appends ` (N)` until unique.
export async function uniqueNameFor(
  storage: StorageAdapter,
  desiredName: string
): Promise<string> {
  const all = await listScenarios(storage);
  const names = new Set(all.map((s) => s.name));
  if (!names.has(desiredName)) return desiredName;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desiredName} (${n})`;
    if (!names.has(candidate)) return candidate;
  }
  return `${desiredName} (${Date.now()})`;
}

// ---------- active scenario per tab ----------

export async function getActiveScenarioIdForTab(
  storage: StorageAdapter,
  tabId: number
): Promise<string | null> {
  const active = ((await storage.get(STORAGE_KEY_ACTIVE)) as Record<number, string> | undefined) ?? {};
  return active[tabId] ?? null;
}

export async function setActiveScenarioForTab(
  storage: StorageAdapter,
  tabId: number,
  scenarioId: string | null
): Promise<void> {
  const active = ((await storage.get(STORAGE_KEY_ACTIVE)) as Record<number, string> | undefined) ?? {};
  if (scenarioId === null) {
    delete active[tabId];
  } else {
    active[tabId] = scenarioId;
  }
  await storage.set(STORAGE_KEY_ACTIVE, active);
}

export async function clearTabFromActive(storage: StorageAdapter, tabId: number): Promise<void> {
  await setActiveScenarioForTab(storage, tabId, null);
}

export async function clearAllActive(storage: StorageAdapter): Promise<void> {
  await storage.set(STORAGE_KEY_ACTIVE, {});
}

// ---------- rule resolution for a tab ----------

// Returns the rules the patch should consider for a tab. Empty when the global
// kill switch is off (caller's responsibility to check) or when no scenario is
// active in that tab.
export async function getRulesForTab(storage: StorageAdapter, tabId: number): Promise<Rule[]> {
  const scenarioId = await getActiveScenarioIdForTab(storage, tabId);
  if (!scenarioId) return [];
  const scenario = await getScenario(storage, scenarioId);
  if (!scenario) return [];
  // Lift the scenario's rules into Rule shape (add tabId scoping).
  return scenario.rules.map((r) => ({ ...r, tabId }));
}

// ---------- rule edits via scenarios ----------

// Save a rule for the active scenario in a tab. If no scenario is active,
// create an ephemeral one ("Untitled (DevTools)") and activate it. Replaces
// an existing rule with the same id; otherwise appends.
export async function saveRuleInActiveScenario(
  storage: StorageAdapter,
  tabId: number,
  rule: Omit<Rule, 'tabId'>
): Promise<{ scenarioId: string; created: boolean }> {
  const existingId = await getActiveScenarioIdForTab(storage, tabId);
  let scenarioId: string;
  let created = false;
  let scenario: Scenario | null = null;

  if (existingId) {
    scenario = await getScenario(storage, existingId);
  }
  if (scenario) {
    scenarioId = scenario.id;
  } else {
    // Ephemeral. Stable id per tab so re-creating doesn't pile up duplicates.
    scenarioId = `s_eph_t${tabId}`;
    scenario = {
      id: scenarioId,
      moxyFormatVersion: 1,
      name: `${EPHEMERAL_NAME_PREFIX} — tab ${tabId}`,
      description: 'Auto-created when editing a rule with no active scenario. Rename to keep.',
      createdAt: Date.now(),
      rules: [],
    };
    created = true;
  }

  const idx = scenario.rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) scenario.rules[idx] = rule;
  else scenario.rules.push(rule);

  await saveScenario(storage, scenario);
  if (created) await setActiveScenarioForTab(storage, tabId, scenarioId);
  return { scenarioId, created };
}

export async function deleteRuleInActiveScenario(
  storage: StorageAdapter,
  tabId: number,
  ruleId: string
): Promise<boolean> {
  const scenarioId = await getActiveScenarioIdForTab(storage, tabId);
  if (!scenarioId) return false;
  const scenario = await getScenario(storage, scenarioId);
  if (!scenario) return false;
  const before = scenario.rules.length;
  scenario.rules = scenario.rules.filter((r) => r.id !== ruleId);
  if (scenario.rules.length === before) return false;
  await saveScenario(storage, scenario);
  return true;
}

export async function toggleRuleInActiveScenario(
  storage: StorageAdapter,
  tabId: number,
  ruleId: string,
  enabled: boolean
): Promise<boolean> {
  const scenarioId = await getActiveScenarioIdForTab(storage, tabId);
  if (!scenarioId) return false;
  const scenario = await getScenario(storage, scenarioId);
  if (!scenario) return false;
  const idx = scenario.rules.findIndex((r) => r.id === ruleId);
  if (idx < 0) return false;
  scenario.rules[idx] = { ...scenario.rules[idx], enabled };
  await saveScenario(storage, scenario);
  return true;
}

// Garbage-collect ephemeral scenarios that are not active in any tab. Called
// on browser startup (paired with clearAllActive) so leftover ephemerals from
// previous sessions don't pile up.
export async function gcEphemeralScenarios(storage: StorageAdapter): Promise<number> {
  const raw =
    ((await storage.get(STORAGE_KEY_SCENARIOS)) as Record<string, Scenario> | undefined) ?? {};
  const active =
    ((await storage.get(STORAGE_KEY_ACTIVE)) as Record<number, string> | undefined) ?? {};
  const activeIds = new Set(Object.values(active));
  let removed = 0;
  for (const [id, sc] of Object.entries(raw)) {
    if (sc.name.startsWith(EPHEMERAL_NAME_PREFIX) && !activeIds.has(id)) {
      delete raw[id];
      removed++;
    }
  }
  if (removed > 0) await storage.set(STORAGE_KEY_SCENARIOS, raw);
  return removed;
}
