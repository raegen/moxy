// MAIN world. document_start.
// Uses @mswjs/interceptors for fetch + XHR primitives (handles AbortSignal,
// ReadableStream, Response.clone, XHR event-order, upload progress, etc.).
// Adds moxy's rule matching, latency injection, capture emission.

import { BatchInterceptor } from '@mswjs/interceptors';
import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest';

import type {
  Body,
  Capture,
  FromMainMessage,
  MutationBody,
  Rule,
  ToMainMessage,
} from '../shared/types';
import { MOXY_MARKER } from '../shared/types';
import { matcherMatches } from '../shared/match';
import { createDebug } from '../shared/debug';

const dbg = createDebug('patch');

(() => {
  const w = window as Window & { __moxy_installed?: boolean };
  if (w.__moxy_installed) {
    dbg('install skipped (already installed)');
    return;
  }
  w.__moxy_installed = true;
  dbg('install', { url: location.href });

  // Capture the real fetch BEFORE the interceptor patches window.fetch.
  // Needed for partial-mutation mode (run the real request, override status/headers).
  const realFetch = window.fetch.bind(window);

  let nonce: string | null = null;
  let rules: Rule[] = [];
  let rulesReady = false;
  const rulesReadyWaiters: Array<() => void> = [];

  // Per-request bookkeeping. ruleId tracked from request → response handler.
  const requestStart = new Map<string, number>();
  const requestRule = new Map<string, string>();

  // ---------- bridge plumbing ----------

  function postToBridge(msg: FromMainMessage) {
    window.postMessage({ __moxy: MOXY_MARKER, payload: msg }, '*');
  }

  function awaitRules(): Promise<void> {
    if (rulesReady) return Promise.resolve();
    return new Promise((resolve) => rulesReadyWaiters.push(resolve));
  }

  function markRulesReady() {
    if (rulesReady) return;
    rulesReady = true;
    const waiters = rulesReadyWaiters.splice(0);
    for (const w of waiters) w();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__moxy !== MOXY_MARKER) return;
    const payload = data.payload as ToMainMessage | undefined;
    if (!payload) return;

    if (payload.kind === 'moxy:nonce') {
      nonce = payload.nonce;
      dbg('nonce received → handshake', nonce);
      postToBridge({ kind: 'moxy:handshake', nonce });
      return;
    }

    if (payload.kind === 'moxy:rules') {
      if (nonce !== null && payload.nonce !== nonce) {
        dbg('rules dropped (nonce mismatch)');
        return;
      }
      rules = Array.isArray(payload.rules) ? payload.rules : [];
      dbg('rules received', { count: rules.length });
      markRulesReady();
    }
  });

  // Safety: if rules never arrive within 250ms, assume none and unblock.
  setTimeout(() => {
    if (!rulesReady) dbg('rules timeout (250ms) — proceeding without');
    markRulesReady();
  }, 250);

  // ---------- helpers ----------

  function headersToObject(h: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    h.forEach((v, k) => (out[k] = v));
    return out;
  }

  function isStreamy(headers: Headers): boolean {
    const ct = (headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('text/event-stream')) return true;
    if ((headers.get('transfer-encoding') ?? '').toLowerCase() === 'chunked') return true;
    return false;
  }

  async function readResponseBody(res: Response): Promise<Body> {
    if (isStreamy(res.headers)) return { kind: 'skipped', reason: 'stream' };
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const isText =
      ct.startsWith('text/') ||
      ct.includes('json') ||
      ct.includes('xml') ||
      ct.includes('javascript') ||
      ct.includes('css') ||
      ct === '';
    try {
      if (isText) {
        return { kind: 'text', data: await res.clone().text() };
      }
      const buf = await res.clone().arrayBuffer();
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return { kind: 'base64', data: btoa(s) };
    } catch {
      return { kind: 'text', data: '' };
    }
  }

  async function readRequestBody(req: Request): Promise<Body | undefined> {
    if (!req.body) return undefined;
    try {
      const text = await req.clone().text();
      return text ? { kind: 'text', data: text } : undefined;
    } catch {
      return undefined;
    }
  }

  function makeId(): string {
    return (
      (crypto.randomUUID?.() as string | undefined) ??
      Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
  }

  function sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  // ---------- rule matching ----------
  // Dispatch lives in src/shared/match.ts so adding a new matcher type
  // (regex / header / body-jsonpath in v1.2) only requires updating that file's
  // switch — the exhaustiveness check fails compile here if a case is missed.

  function findMatchingRule(method: string, url: string): Rule | undefined {
    for (const r of rules) {
      if (!r.enabled) continue;
      if (!matcherMatches(r.match, url, method)) continue;
      return r;
    }
    return undefined;
  }

  function bodyToBodyInit(body: Body | MutationBody | undefined): BodyInit | null {
    if (!body) return null;
    if (body.kind === 'text') return body.data;
    if (body.kind === 'json') {
      // JSON variant carries a JS value; stringify for the wire. Patches that
      // also override Content-Type to application/json keep this consistent
      // with the headers; if not, the page may misinterpret it — surfaced
      // explicitly in the import-time validator (scenario.ts).
      try {
        return JSON.stringify(body.data);
      } catch {
        return null;
      }
    }
    if (body.kind === 'base64') {
      try {
        const binary = atob(body.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      } catch {
        return null;
      }
    }
    return null; // skipped (stream) — no body to synthesize from
  }

  // ---------- interceptor wiring ----------

  const interceptor = new BatchInterceptor({
    name: 'moxy',
    interceptors: [new FetchInterceptor(), new XMLHttpRequestInterceptor()],
  });

  interceptor.on('request', async ({ request, controller, requestId }) => {
    requestStart.set(requestId, performance.now());

    if (!rulesReady) await awaitRules();

    const rule = findMatchingRule(request.method, request.url);
    if (!rule) {
      dbg('request passthrough', request.method, request.url);
      return; // passthrough — interceptor will let the real request fly
    }

    dbg('request matched rule', { ruleId: rule.id, method: request.method, url: request.url });
    requestRule.set(requestId, rule.id);

    let mockedResponse: Response;

    if (rule.mutate.body === undefined) {
      // Partial mutation: do the real request, override only status/headers.
      let real: Response;
      try {
        real = await realFetch(request.clone());
      } catch (err) {
        controller.respondWith(Response.error());
        void err;
        return;
      }
      if (isStreamy(real.headers)) {
        console.warn(
          '[moxy] cannot mock streaming response for rule',
          rule.id,
          '— passing real response through'
        );
        await sleep(rule.mutate.latencyMs ?? 0);
        controller.respondWith(real);
        return;
      }
      const realHeaders = headersToObject(real.headers);
      const mergedHeaders = { ...realHeaders, ...(rule.mutate.headers ?? {}) };
      const buf = await real.clone().arrayBuffer();
      mockedResponse = new Response(buf, {
        status: rule.mutate.status ?? real.status,
        statusText: rule.mutate.statusText ?? real.statusText,
        headers: mergedHeaders,
      });
    } else {
      const noBodyStatuses = new Set([101, 204, 205, 304]);
      const status = rule.mutate.status ?? 200;
      mockedResponse = new Response(
        noBodyStatuses.has(status) ? null : bodyToBodyInit(rule.mutate.body),
        {
          status,
          statusText: rule.mutate.statusText ?? '',
          headers: rule.mutate.headers ?? {},
        }
      );
    }

    await sleep(rule.mutate.latencyMs ?? 0);
    controller.respondWith(mockedResponse);
  });

  interceptor.on('response', async ({ response, request, isMockedResponse, requestId }) => {
    if (nonce === null) {
      dbg('response dropped (no nonce yet)', request.method, request.url);
      return;
    }
    const start = requestStart.get(requestId);
    requestStart.delete(requestId);
    const ruleId = requestRule.get(requestId);
    requestRule.delete(requestId);

    const cap: Omit<Capture, 'tabId'> = {
      id: makeId(),
      ts: Date.now(),
      request: {
        method: request.method,
        url: request.url,
        headers: headersToObject(request.headers),
        body: await readRequestBody(request),
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
        body: await readResponseBody(response),
      },
      durationMs: start != null ? Math.round(performance.now() - start) : 0,
      mocked: isMockedResponse,
      ruleId,
    };

    dbg('capture → bridge', { id: cap.id, status: cap.response.status, mocked: cap.mocked, url: request.url });
    postToBridge({ kind: 'moxy:capture', capture: cap });
  });

  interceptor.on('unhandledException', ({ error, request }) => {
    dbg('unhandled exception', request.method, request.url, error);
  });

  interceptor.apply();
  dbg('interceptors applied');

  console.log('[moxy] interceptors applied (fetch + XHR via @mswjs/interceptors)');
})();
