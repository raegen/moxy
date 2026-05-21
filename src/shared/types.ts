export type Body =
  | { kind: 'text'; data: string }
  | { kind: 'base64'; data: string }
  | { kind: 'skipped'; reason: 'stream' };

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

export type MutationBody =
  | { kind: 'text'; data: string }
  | { kind: 'base64'; data: string };

export type Rule = {
  id: string;
  tabId: number;
  enabled: boolean;
  match: {
    method: string;
    urlGlob: string;
  };
  mutate: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: MutationBody;
    latencyMs?: number;
  };
  fromCaptureId?: string;
  createdAt: number;
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
  | { kind: 'sw:set-global-enabled'; enabled: boolean };

export type SwResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export const MOXY_MARKER = '__moxy_v1__';
