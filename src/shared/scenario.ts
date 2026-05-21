// Scenario format: parse, serialize, validate, hash.
//
// This file owns the public-API surface of moxy's .moxy.json contract. Any
// change here is a forward-compat breaking change — schema/v1.json + this
// module + the migration in migrate.ts must move together.
//
// The format uses `type:` as the discriminator (JSON Schema convention). Code
// internally uses `kind:` for the same shape — this module is the translation
// boundary.

import {
  MOXY_FORMAT_VERSION,
  MOXY_EXTENSION_VERSION,
  SCHEMA_URL,
  type Matcher,
  type MutationBody,
  type Rule,
  type Scenario,
  type SerializedScenario,
} from './types';

export class ScenarioImportError extends Error {
  readonly kind: ScenarioImportErrorKind;
  constructor(message: string, kind: ScenarioImportErrorKind) {
    super(message);
    this.name = 'ScenarioImportError';
    this.kind = kind;
  }
}

export type ScenarioImportErrorKind =
  | 'malformed-json'
  | 'unsupported-format-version'
  | 'unsupported-matcher-type'
  | 'invalid-shape'
  | 'empty-mutation'
  | 'out-of-range'
  | 'size-limit'
  | 'name-missing';

export interface ImportResult {
  scenario: Scenario;
  warnings: string[];
}

// Caps. Picked to be generous enough that real captured responses fit but small
// enough that a malicious / oversized file can't tank the panel.
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB per rule body
const MAX_STATUS = 599;
const MIN_STATUS = 100;
const MAX_LATENCY_MS = 60_000; // 60s — beyond this you're testing patience, not the app
const KNOWN_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'moxyFormatVersion',
  'name',
  'description',
  'createdAt',
  'createdWith',
  'rules',
]);
const KNOWN_RULE_KEYS = new Set([
  'id',
  'enabled',
  'match',
  'mutate',
  'behavior',
]);
const KNOWN_MATCH_KEYS_URL_GLOB = new Set(['type', 'pattern', 'method']);
const KNOWN_MUTATE_KEYS = new Set([
  'status',
  'statusText',
  'headers',
  'body',
  'latencyMs',
]);

// ---------- parse ----------

export function parseScenario(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new ScenarioImportError(
      `scenario file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      'malformed-json'
    );
  }
  if (!isObject(raw)) {
    throw new ScenarioImportError('scenario root must be an object', 'invalid-shape');
  }

  const warnings: string[] = [];

  // Format version gate.
  const formatVersion = (raw as { moxyFormatVersion?: unknown }).moxyFormatVersion;
  if (formatVersion !== MOXY_FORMAT_VERSION) {
    if (typeof formatVersion === 'number' && formatVersion > MOXY_FORMAT_VERSION) {
      throw new ScenarioImportError(
        `this scenario requires moxy v${formatVersion} or newer (you have format v${MOXY_FORMAT_VERSION})`,
        'unsupported-format-version'
      );
    }
    throw new ScenarioImportError(
      `unrecognized moxyFormatVersion: ${JSON.stringify(formatVersion)}`,
      'unsupported-format-version'
    );
  }

  // Name (required).
  const name = (raw as { name?: unknown }).name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ScenarioImportError('scenario.name is required and must be a non-empty string', 'name-missing');
  }

  // Description (optional).
  const descriptionRaw = (raw as { description?: unknown }).description;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== 'string') {
    throw new ScenarioImportError('scenario.description must be a string if present', 'invalid-shape');
  }
  const description = (descriptionRaw as string | undefined) ?? undefined;

  // createdAt — ISO 8601 string in the JSON, number (ms epoch) in code.
  const createdAtRaw = (raw as { createdAt?: unknown }).createdAt;
  let createdAt: number = Date.now();
  if (typeof createdAtRaw === 'string') {
    const t = Date.parse(createdAtRaw);
    if (Number.isFinite(t)) createdAt = t;
    else warnings.push(`scenario.createdAt is not a valid ISO 8601 timestamp; defaulted to now`);
  } else if (createdAtRaw !== undefined) {
    warnings.push(`scenario.createdAt should be a string (ISO 8601); ignoring`);
  }

  // createdWith (optional metadata).
  const createdWithRaw = (raw as { createdWith?: unknown }).createdWith;
  let createdWith: Scenario['createdWith'];
  if (createdWithRaw !== undefined) {
    if (!isObject(createdWithRaw)) {
      warnings.push('scenario.createdWith should be an object; ignoring');
    } else {
      createdWith = {
        extensionVersion:
          typeof (createdWithRaw as { extensionVersion?: unknown }).extensionVersion === 'string'
            ? (createdWithRaw as { extensionVersion: string }).extensionVersion
            : undefined,
        userAgent:
          typeof (createdWithRaw as { userAgent?: unknown }).userAgent === 'string'
            ? (createdWithRaw as { userAgent: string }).userAgent
            : undefined,
      };
    }
  }

  // Rules (required, must be an array of >=1 entry).
  const rulesRaw = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(rulesRaw)) {
    throw new ScenarioImportError('scenario.rules is required and must be an array', 'invalid-shape');
  }

  // Unknown top-level keys: warn but don't reject (forward-compat sugar).
  for (const k of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(k)) {
      warnings.push(`scenario contains unknown top-level field "${k}"; it will be ignored`);
    }
  }

  // Parse each rule. Track hashes for dedupe.
  const parsedRules: Scenario['rules'] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rulesRaw.length; i++) {
    const parsed = parseRule(rulesRaw[i], i, warnings);
    if (seenIds.has(parsed.id)) {
      warnings.push(
        `rule #${i} is a duplicate of an earlier rule (same hash); skipping`
      );
      continue;
    }
    seenIds.add(parsed.id);
    parsedRules.push(parsed);
  }

  // Synthesize a stable scenario id from name + first rule hash so re-imports
  // converge unless the user renames. UI can override on conflict.
  const scenarioIdSeed = name + '|' + (parsedRules[0]?.id ?? '');
  const scenarioId = 's_' + fnv1a32(scenarioIdSeed).toString(36);

  const scenario: Scenario = {
    id: scenarioId,
    moxyFormatVersion: MOXY_FORMAT_VERSION,
    name: name.trim(),
    description,
    createdAt,
    createdWith,
    rules: parsedRules,
  };

  return { scenario, warnings };
}

function parseRule(raw: unknown, idx: number, warnings: string[]): Scenario['rules'][number] {
  if (!isObject(raw)) {
    throw new ScenarioImportError(`rule #${idx} must be an object`, 'invalid-shape');
  }

  // Unknown rule keys: warn.
  for (const k of Object.keys(raw)) {
    if (!KNOWN_RULE_KEYS.has(k)) {
      warnings.push(`rule #${idx} contains unknown field "${k}"; it will be ignored`);
    }
  }

  // Match (required).
  const matchRaw = (raw as { match?: unknown }).match;
  if (!isObject(matchRaw)) {
    throw new ScenarioImportError(`rule #${idx}.match must be an object`, 'invalid-shape');
  }
  const matchType = (matchRaw as { type?: unknown }).type;
  if (matchType !== 'url-glob') {
    throw new ScenarioImportError(
      `rule #${idx}: unsupported matcher type "${String(matchType)}"; this client supports: url-glob`,
      'unsupported-matcher-type'
    );
  }
  const pattern = (matchRaw as { pattern?: unknown }).pattern;
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new ScenarioImportError(
      `rule #${idx}.match.pattern must be a non-empty string`,
      'invalid-shape'
    );
  }
  const methodRaw = (matchRaw as { method?: unknown }).method;
  const method = typeof methodRaw === 'string' ? methodRaw : '*';
  // Unknown match keys (within url-glob shape): warn.
  for (const k of Object.keys(matchRaw)) {
    if (!KNOWN_MATCH_KEYS_URL_GLOB.has(k)) {
      warnings.push(`rule #${idx}.match contains unknown field "${k}"; ignored`);
    }
  }
  const match: Matcher = { type: 'url-glob', pattern: pattern.trim(), method };

  // Mutate (required, must produce a non-empty action).
  const mutateRaw = (raw as { mutate?: unknown }).mutate;
  if (!isObject(mutateRaw)) {
    throw new ScenarioImportError(`rule #${idx}.mutate must be an object`, 'invalid-shape');
  }
  for (const k of Object.keys(mutateRaw)) {
    if (!KNOWN_MUTATE_KEYS.has(k)) {
      warnings.push(`rule #${idx}.mutate contains unknown field "${k}"; ignored`);
    }
  }
  const mutate = parseMutate(mutateRaw, idx);

  // At least ONE of status/body/headers/latencyMs must be present, else the
  // rule is a silent no-op (footgun). Reject early.
  if (
    mutate.status === undefined &&
    mutate.body === undefined &&
    mutate.headers === undefined &&
    (mutate.latencyMs === undefined || mutate.latencyMs === 0)
  ) {
    throw new ScenarioImportError(
      `rule #${idx}.mutate must contain at least one of: status, body, headers, latencyMs`,
      'empty-mutation'
    );
  }

  // ID: regenerate deterministically. Source ID (if any) is ignored — rule
  // identity is content-derived so re-exports are stable across machines.
  const id = hashRuleId(match, mutate);
  const enabled = (raw as { enabled?: unknown }).enabled !== false; // default true

  return {
    id,
    enabled,
    match,
    mutate,
    createdAt: Date.now(),
  };
}

function parseMutate(mutateRaw: Record<string, unknown>, idx: number): Rule['mutate'] {
  const out: Rule['mutate'] = {};

  // status
  if (mutateRaw.status !== undefined) {
    const s = mutateRaw.status;
    if (typeof s !== 'number' || !Number.isInteger(s) || s < MIN_STATUS || s > MAX_STATUS) {
      throw new ScenarioImportError(
        `rule #${idx}.mutate.status must be an integer in [${MIN_STATUS}, ${MAX_STATUS}]`,
        'out-of-range'
      );
    }
    out.status = s;
  }

  // statusText
  if (mutateRaw.statusText !== undefined) {
    if (typeof mutateRaw.statusText !== 'string') {
      throw new ScenarioImportError(`rule #${idx}.mutate.statusText must be a string`, 'invalid-shape');
    }
    out.statusText = mutateRaw.statusText;
  }

  // headers
  if (mutateRaw.headers !== undefined) {
    if (!isObject(mutateRaw.headers)) {
      throw new ScenarioImportError(`rule #${idx}.mutate.headers must be an object`, 'invalid-shape');
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(mutateRaw.headers)) {
      if (typeof v !== 'string') {
        throw new ScenarioImportError(
          `rule #${idx}.mutate.headers["${k}"] must be a string`,
          'invalid-shape'
        );
      }
      headers[k] = v;
    }
    out.headers = headers;
  }

  // latency
  if (mutateRaw.latencyMs !== undefined) {
    const ms = mutateRaw.latencyMs;
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > MAX_LATENCY_MS) {
      throw new ScenarioImportError(
        `rule #${idx}.mutate.latencyMs must be a number in [0, ${MAX_LATENCY_MS}]`,
        'out-of-range'
      );
    }
    out.latencyMs = Math.floor(ms);
  }

  // body
  if (mutateRaw.body !== undefined) {
    out.body = parseMutateBody(mutateRaw.body, idx);
  }

  return out;
}

function parseMutateBody(raw: unknown, idx: number): MutationBody {
  if (!isObject(raw)) {
    throw new ScenarioImportError(`rule #${idx}.mutate.body must be an object`, 'invalid-shape');
  }
  const type = (raw as { type?: unknown }).type;
  const data = (raw as { data?: unknown }).data;
  if (type === 'text') {
    if (typeof data !== 'string') {
      throw new ScenarioImportError(`rule #${idx}.mutate.body.data must be a string for type "text"`, 'invalid-shape');
    }
    if (data.length > MAX_BODY_BYTES) {
      throw new ScenarioImportError(
        `rule #${idx}.mutate.body exceeds ${MAX_BODY_BYTES} bytes`,
        'size-limit'
      );
    }
    return { kind: 'text', data };
  }
  if (type === 'base64') {
    if (typeof data !== 'string') {
      throw new ScenarioImportError(`rule #${idx}.mutate.body.data must be a base64 string`, 'invalid-shape');
    }
    if (data.length > MAX_BODY_BYTES) {
      throw new ScenarioImportError(
        `rule #${idx}.mutate.body exceeds ${MAX_BODY_BYTES} bytes`,
        'size-limit'
      );
    }
    return { kind: 'base64', data };
  }
  if (type === 'json') {
    // data is arbitrary JSON value; check serialized size.
    try {
      const ser = JSON.stringify(data);
      if (ser.length > MAX_BODY_BYTES) {
        throw new ScenarioImportError(
          `rule #${idx}.mutate.body exceeds ${MAX_BODY_BYTES} bytes`,
          'size-limit'
        );
      }
    } catch (e) {
      if (e instanceof ScenarioImportError) throw e;
      throw new ScenarioImportError(
        `rule #${idx}.mutate.body.data is not JSON-serializable: ${e instanceof Error ? e.message : String(e)}`,
        'invalid-shape'
      );
    }
    return { kind: 'json', data };
  }
  throw new ScenarioImportError(
    `rule #${idx}.mutate.body.type must be "text", "base64", or "json" (got "${String(type)}")`,
    'invalid-shape'
  );
}

// ---------- serialize ----------

export function serializeScenario(scenario: Scenario): string {
  const out: SerializedScenario = {
    $schema: SCHEMA_URL,
    moxyFormatVersion: scenario.moxyFormatVersion,
    name: scenario.name,
    description: scenario.description,
    createdAt: new Date(scenario.createdAt).toISOString(),
    createdWith: scenario.createdWith ?? {
      extensionVersion: MOXY_EXTENSION_VERSION,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    },
    rules: scenario.rules.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      match: serializeMatcher(r.match),
      mutate: {
        status: r.mutate.status,
        statusText: r.mutate.statusText,
        headers: r.mutate.headers,
        body: r.mutate.body ? serializeBody(r.mutate.body) : undefined,
        latencyMs: r.mutate.latencyMs,
      },
      ...(r.behavior ? { behavior: r.behavior } : {}),
    })),
  };
  return JSON.stringify(out, null, 2);
}

function serializeMatcher(m: Matcher): SerializedScenario['rules'][number]['match'] {
  switch (m.type) {
    case 'url-glob':
      return { type: 'url-glob', pattern: m.pattern, method: m.method };
    default: {
      const _exhaustive: never = m.type;
      void _exhaustive;
      throw new Error('unreachable');
    }
  }
}

function serializeBody(body: MutationBody): NonNullable<SerializedScenario['rules'][number]['mutate']['body']> {
  switch (body.kind) {
    case 'text':
      return { type: 'text', data: body.data };
    case 'base64':
      return { type: 'base64', data: body.data };
    case 'json':
      return { type: 'json', data: body.data };
    default: {
      const _exhaustive: never = body;
      void _exhaustive;
      throw new Error('unreachable');
    }
  }
}

// ---------- hash ----------

// FNV-1a 32-bit. Pure-JS, deterministic, sync. Locked algorithm for v1 — if
// this changes in v2, rule IDs across exported scenarios all shift, breaking
// the git-friendly stability contract. Snapshot-tested in scenario.test.ts.
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Canonical JSON: sorts object keys at every depth so semantically equal
// objects always produce the same string. Required for stable hashing.
export function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .filter((k) => obj[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
        .join(',') +
      '}'
    );
  }
  return 'null';
}

// Rule identity from content. Two rules with the same match + mutate get the
// same id, regardless of which scenario they came from or what order they
// were imported in. Enables dedupe on import and git-friendly re-exports.
export function hashRuleId(match: Matcher, mutate: Rule['mutate'], behavior?: Rule['behavior']): string {
  const canonical = stableStringify({ match, mutate, behavior: behavior ?? null });
  return 'r_' + fnv1a32(canonical).toString(36);
}

// ---------- helpers ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
