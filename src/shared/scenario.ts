// Scenario format: parse, serialize, validate, hash.
//
// This file owns the public-API surface of moxy's .moxy.json contract. The
// canonical contract is schema/v1.json (JSON Schema 2020-12), precompiled via
// scripts/compile-schema.mjs into src/shared/generated/validate-v1.mjs.
// This module wraps the precompiled validator with rich error mapping, post-
// validation warnings (unknown keys), and the deterministic-id / dedup logic.
//
// The format uses `type:` as the discriminator (JSON Schema convention). Code
// internally uses `kind:` for the same shape — this module is the translation
// boundary.

import validate from './generated/validate-v1.mjs';
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

// Shape of one ajv error (subset of ajv's ErrorObject we care about).
type AjvError = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
};

// The precompiled validator: function returning boolean, with `errors` populated
// on failure. Types fudged because the generated module has no .d.ts.
const validateScenario = validate as unknown as ((
  data: unknown
) => boolean) & { errors?: AjvError[] | null };

export class ScenarioImportError extends Error {
  readonly kind: ScenarioImportErrorKind;
  readonly ajvErrors?: AjvError[];
  constructor(message: string, kind: ScenarioImportErrorKind, ajvErrors?: AjvError[]) {
    super(message);
    this.name = 'ScenarioImportError';
    this.kind = kind;
    this.ajvErrors = ajvErrors;
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

// Keys we recognize on each level. Anything outside these on import emits a
// "unknown field" warning (the schema allows additionalProperties so unknown
// keys aren't a hard error — they survive but with a heads-up).
const KNOWN_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'moxyFormatVersion',
  'name',
  'description',
  'createdAt',
  'createdWith',
  'rules',
]);
const KNOWN_RULE_KEYS = new Set(['id', 'enabled', 'match', 'mutate', 'behavior']);
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
  // 1. JSON syntax.
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

  // 2. Friendly pre-checks for the two cases where ajv's default message would
  // confuse end users (format version and matcher type discriminator).
  preCheckFormatVersion(raw);
  preCheckMatcherTypes(raw);

  // 3. Hand off to the precompiled schema validator. All shape / type / range
  // checks live in schema/v1.json — this catches everything except the two
  // friendly cases above.
  const valid = validateScenario(raw);
  if (!valid) {
    const errs = validateScenario.errors ?? [];
    throw mapAjvErrorsToImportError(errs);
  }

  // 4. Post-validation: collect warnings, normalize, dedupe, regenerate IDs.
  const validated = raw as Record<string, unknown>;
  const warnings: string[] = [];
  collectUnknownKeyWarnings(validated, warnings);

  const name = (validated.name as string).trim();
  const description = validated.description as string | undefined;
  const createdAt = normalizeCreatedAt(validated.createdAt, warnings);
  const createdWith = validated.createdWith as Scenario['createdWith'];
  const rulesRaw = validated.rules as Array<Record<string, unknown>>;

  const parsedRules: Scenario['rules'] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rulesRaw.length; i++) {
    const r = parseRule(rulesRaw[i], i, warnings);
    if (seenIds.has(r.id)) {
      warnings.push(`rule #${i} is a duplicate of an earlier rule (same hash); skipping`);
      continue;
    }
    seenIds.add(r.id);
    parsedRules.push(r);
  }

  // Stable scenario id from name + first rule hash. Re-imports converge unless
  // the user renames; library auto-rename handles outright collisions.
  const scenarioIdSeed = name + '|' + (parsedRules[0]?.id ?? '');
  const scenarioId = 's_' + fnv1a32(scenarioIdSeed).toString(36);

  const scenario: Scenario = {
    id: scenarioId,
    moxyFormatVersion: MOXY_FORMAT_VERSION,
    name,
    description,
    createdAt,
    createdWith,
    rules: parsedRules,
  };
  return { scenario, warnings };
}

// Pre-check: friendly message for format version mismatches. The schema's
// `const: 1` would otherwise emit "must be equal to constant" which isn't
// helpful when a user tries to import a v2 file on a v1.1 client.
function preCheckFormatVersion(raw: Record<string, unknown>): void {
  const v = raw.moxyFormatVersion;
  if (v === MOXY_FORMAT_VERSION) return;
  if (typeof v === 'number' && v > MOXY_FORMAT_VERSION) {
    throw new ScenarioImportError(
      `this scenario requires moxy v${v} or newer (you have format v${MOXY_FORMAT_VERSION})`,
      'unsupported-format-version'
    );
  }
  if (v === undefined) {
    throw new ScenarioImportError(
      'scenario is missing moxyFormatVersion field',
      'unsupported-format-version'
    );
  }
  throw new ScenarioImportError(
    `unrecognized moxyFormatVersion: ${JSON.stringify(v)}`,
    'unsupported-format-version'
  );
}

// Pre-check: friendly message for unsupported match.type. Schema would report
// `oneOf` failure which doesn't surface the actual type to the user.
function preCheckMatcherTypes(raw: Record<string, unknown>): void {
  const rules = raw.rules;
  if (!Array.isArray(rules)) return; // ajv will catch shape
  for (let i = 0; i < rules.length; i++) {
    const m = (rules[i] as { match?: unknown })?.match;
    if (!isObject(m)) continue;
    const t = (m as { type?: unknown }).type;
    if (t !== 'url-glob' && typeof t === 'string') {
      throw new ScenarioImportError(
        `rule #${i}: unsupported matcher type "${t}"; this client supports: url-glob`,
        'unsupported-matcher-type'
      );
    }
  }
}

function parseRule(raw: Record<string, unknown>, idx: number, warnings: string[]): Scenario['rules'][number] {
  for (const k of Object.keys(raw)) {
    if (!KNOWN_RULE_KEYS.has(k)) {
      warnings.push(`rule #${idx} contains unknown field "${k}"; it will be ignored`);
    }
  }
  const matchRaw = raw.match as Record<string, unknown>;
  for (const k of Object.keys(matchRaw)) {
    if (!KNOWN_MATCH_KEYS_URL_GLOB.has(k)) {
      warnings.push(`rule #${idx}.match contains unknown field "${k}"; ignored`);
    }
  }
  const mutateRaw = raw.mutate as Record<string, unknown>;
  for (const k of Object.keys(mutateRaw)) {
    if (!KNOWN_MUTATE_KEYS.has(k)) {
      warnings.push(`rule #${idx}.mutate contains unknown field "${k}"; ignored`);
    }
  }

  const match: Matcher = {
    type: 'url-glob',
    pattern: ((matchRaw.pattern as string) ?? '').trim(),
    method: (matchRaw.method as string | undefined) ?? '*',
  };
  const mutate = buildMutate(mutateRaw);
  const enabled = raw.enabled !== false; // default true
  const id = hashRuleId(match, mutate);

  return {
    id,
    enabled,
    match,
    mutate,
    createdAt: Date.now(),
  };
}

function buildMutate(raw: Record<string, unknown>): Rule['mutate'] {
  const out: Rule['mutate'] = {};
  if (raw.status !== undefined) out.status = raw.status as number;
  if (raw.statusText !== undefined) out.statusText = raw.statusText as string;
  if (raw.headers !== undefined) out.headers = raw.headers as Record<string, string>;
  if (raw.latencyMs !== undefined) out.latencyMs = Math.floor(raw.latencyMs as number);
  if (raw.body !== undefined) {
    const b = raw.body as { type: string; data: unknown };
    if (b.type === 'text') out.body = { kind: 'text', data: b.data as string };
    else if (b.type === 'base64') out.body = { kind: 'base64', data: b.data as string };
    else if (b.type === 'json') out.body = { kind: 'json', data: b.data };
  }
  return out;
}

function collectUnknownKeyWarnings(raw: Record<string, unknown>, warnings: string[]): void {
  for (const k of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(k)) {
      warnings.push(`scenario contains unknown top-level field "${k}"; it will be ignored`);
    }
  }
}

function normalizeCreatedAt(raw: unknown, warnings: string[]): number {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
    warnings.push('scenario.createdAt is not a valid ISO 8601 timestamp; defaulted to now');
  } else if (raw !== undefined) {
    warnings.push('scenario.createdAt should be a string (ISO 8601); ignoring');
  }
  return Date.now();
}

// Map ajv error array to a single ScenarioImportError with the most actionable
// message. Approach: scan the whole error array for high-priority signatures
// (anyOf on mutate, name issues, range issues) before falling back to the
// first-error heuristic. ajv with allErrors:true emits multiple errors per
// validation; the most useful one isn't always errors[0].
function mapAjvErrorsToImportError(errs: AjvError[]): ScenarioImportError {
  if (errs.length === 0) {
    return new ScenarioImportError('scenario failed validation (no details)', 'invalid-shape');
  }

  // High-priority scan: empty-mutation. The anyOf failure on /rules/N/mutate
  // shows up alongside per-branch `required` errors; either form should be
  // recognized.
  const mutateAnyOf = errs.find((e) => e.keyword === 'anyOf' && /\/mutate$/.test(e.instancePath));
  if (mutateAnyOf) {
    return new ScenarioImportError(
      `${humanPath(mutateAnyOf.instancePath)} must contain at least one of: status, body, headers, latencyMs`,
      'empty-mutation',
      errs
    );
  }

  const err = errs[0];
  const path = err.instancePath || '(root)';
  const where = humanPath(path);

  // missing required name
  if (err.keyword === 'required' && err.params.missingProperty === 'name') {
    return new ScenarioImportError('scenario.name is required and must be a non-empty string', 'name-missing', errs);
  }
  // name minLength / wrong type
  if (path === '/name' && (err.keyword === 'minLength' || err.keyword === 'type')) {
    return new ScenarioImportError('scenario.name is required and must be a non-empty string', 'name-missing', errs);
  }
  // status range
  if (
    /\/mutate\/status$/.test(path) &&
    (err.keyword === 'minimum' || err.keyword === 'maximum' || err.keyword === 'type')
  ) {
    return new ScenarioImportError(
      `${where} must be an integer in [100, 599]`,
      'out-of-range',
      errs
    );
  }
  // latencyMs range
  if (
    /\/mutate\/latencyMs$/.test(path) &&
    (err.keyword === 'minimum' || err.keyword === 'maximum' || err.keyword === 'type')
  ) {
    return new ScenarioImportError(
      `${where} must be a number in [0, 60000]`,
      'out-of-range',
      errs
    );
  }
  // body size cap
  if (/\/data$/.test(path) && err.keyword === 'maxLength') {
    return new ScenarioImportError(
      `${where} exceeds the 5 MB size limit`,
      'size-limit',
      errs
    );
  }
  // body oneOf — almost always means unknown body.type or bad shape
  if (err.keyword === 'oneOf' && /\/body$/.test(path)) {
    return new ScenarioImportError(
      `${where}.type must be "text", "base64", or "json"`,
      'invalid-shape',
      errs
    );
  }
  // generic fallback
  const msg = err.message ?? 'failed validation';
  return new ScenarioImportError(`${where} ${msg}`, 'invalid-shape', errs);
}

// Translate a JSON Pointer instancePath like "/rules/0/mutate/status" into the
// human-readable "rule #0.mutate.status" form the rest of moxy uses.
function humanPath(p: string): string {
  if (!p) return '(scenario root)';
  // /rules/N/... → rule #N....
  const m = p.match(/^\/rules\/(\d+)(\/(.*))?$/);
  if (m) {
    const idx = m[1];
    const rest = (m[3] ?? '').split('/').filter(Boolean).join('.');
    return rest ? `rule #${idx}.${rest}` : `rule #${idx}`;
  }
  return 'scenario' + p.replace(/\//g, '.');
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

export function hashRuleId(match: Matcher, mutate: Rule['mutate'], behavior?: Rule['behavior']): string {
  const canonical = stableStringify({ match, mutate, behavior: behavior ?? null });
  return 'r_' + fnv1a32(canonical).toString(36);
}

// ---------- helpers ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
