export type Body =
  | { kind: 'text'; data: string }
  | { kind: 'base64'; data: string }
  | { kind: 'skipped'; reason: 'stream' };

// Body shapes that can be used in a rule's mutate.body. `skipped` is a capture-only
// marker (we can't replay streamed responses) so it's excluded. `json` is sugar that
// preserves object structure across serialization; the patch JSON.stringify()s it
// when building the synthesized Response.
export type MutationBody =
  | { kind: 'text'; data: string }
  | { kind: 'base64'; data: string }
  | { kind: 'json'; data: unknown };

export type RequestRecord = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Body;
};

export type ResponseRecord = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Body;
};

export type Capture = {
  id: string;
  tabId: number;
  ts: number;
  request: RequestRecord;
  response: ResponseRecord;
  durationMs: number;
  mocked?: boolean;
  ruleId?: string;
};

// Discriminated-union matcher type. v1.1 ships only `url-glob`. Future variants
// (`regex`, `header`, `body-jsonpath`) are additive — adding a new type forces
// match.ts dispatch to handle it via the `default: never` exhaustiveness check.
export type Matcher =
  | { type: 'url-glob'; pattern: string; method: string };

// Reserved namespace for future stochastic / behavioral fields (probability,
// jitter, repeat-N-times). Empty in v1.1; consumers should ignore unknown keys.
export type RuleBehavior = Record<string, never>;

export type Rule = {
  id: string;
  // Scope: which tab(s) this rule applies to. v1.1 keeps `tabId: number` for
  // backward compat with v1 rules; rules inside a scenario are scoped via
  // moxy:active (which scenario is loaded in which tab).
  tabId: number;
  enabled: boolean;
  match: Matcher;
  mutate: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: MutationBody;
    latencyMs?: number;
  };
  behavior?: RuleBehavior;
  fromCaptureId?: string;
  createdAt: number;
};

// A named bundle of rules — the unit of sharing. Lives in moxy:scenarios; loaded
// into a tab via moxy:active. Serialized to .moxy.json for export.
export type Scenario = {
  id: string;
  moxyFormatVersion: 1;
  name: string;
  description?: string;
  createdAt: number;
  createdWith?: {
    extensionVersion?: string;
    userAgent?: string;
  };
  rules: Omit<Rule, 'tabId'>[];
};

// Serialized scenario shape (what lives in .moxy.json files). Differs from
// in-memory Scenario in two ways: $schema URL, and discriminated body uses
// `type:` (matches JSON Schema convention) rather than the in-code `kind:`.
export type SerializedScenario = {
  $schema?: string;
  moxyFormatVersion: 1;
  name: string;
  description?: string;
  createdAt: string; // ISO 8601
  createdWith?: {
    extensionVersion?: string;
    userAgent?: string;
  };
  rules: Array<{
    id?: string;
    enabled?: boolean;
    match: { type: 'url-glob'; pattern: string; method?: string };
    mutate: {
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      body?:
        | { type: 'text'; data: string }
        | { type: 'base64'; data: string }
        | { type: 'json'; data: unknown };
      latencyMs?: number;
    };
    behavior?: Record<string, unknown>;
  }>;
};

export type FromMainMessage =
  | { kind: 'moxy:handshake'; nonce: string }
  | { kind: 'moxy:capture'; capture: Omit<Capture, 'tabId'> }
  | { kind: 'moxy:ready' };

export type ToMainMessage =
  | { kind: 'moxy:rules'; rules: Rule[]; nonce: string }
  | { kind: 'moxy:nonce'; nonce: string };

export type SwMessage =
  | { kind: 'sw:get-rules-for-tab' }
  | { kind: 'sw:capture'; capture: Omit<Capture, 'tabId'> }
  | { kind: 'sw:save-rule'; rule: Rule }
  | { kind: 'sw:delete-rule'; ruleId: string }
  | { kind: 'sw:toggle-rule'; ruleId: string; enabled: boolean }
  | { kind: 'sw:list-captures'; tabId?: number }
  | { kind: 'sw:list-rules'; tabId?: number }
  | { kind: 'sw:clear-captures'; tabId?: number }
  | { kind: 'sw:get-global-enabled' }
  | { kind: 'sw:set-global-enabled'; enabled: boolean }
  // Scenario CRUD (v1.1b)
  | { kind: 'sw:list-scenarios' }
  | { kind: 'sw:save-scenario'; scenario: Scenario }
  | { kind: 'sw:delete-scenario'; scenarioId: string }
  | { kind: 'sw:load-scenario'; scenarioId: string; tabId: number }
  | { kind: 'sw:unload-scenario'; tabId: number }
  | { kind: 'sw:get-active-scenario'; tabId: number }
  // v1.3 — side panel roster
  | { kind: 'sw:list-roster' };

// Roster row — the side panel's view of one currently-mocked tab. Computed by
// joining moxy:active, the scenarios map, and the open-tab list.
export type RosterRow = {
  tabId: number;
  windowId: number;
  origin: string;
  scenarioId: string;
  scenarioName: string;
  ruleCount: number;
  enabledRuleCount: number;
};

export type SwResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export const MOXY_MARKER = '__moxy_v1__';
export const MOXY_FORMAT_VERSION = 1 as const;
export const MOXY_EXTENSION_VERSION = '1.3.0';
export const SCHEMA_URL = 'https://raw.githubusercontent.com/raegen/moxy/v1.1.0/schema/v1.json';
