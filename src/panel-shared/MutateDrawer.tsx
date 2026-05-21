import { useEffect, useState } from 'preact/hooks';
import type { Capture, Rule, MutationBody, SwResponse } from '../shared/types';

type Props = {
  capture: Capture;
  tabId: number;
  existingRule?: Rule;
  onClose: () => void;
  onSaved: () => void;
};

// Wire-level headers that would be misleading on a synthesized Response —
// the body length / encoding is whatever we set, not whatever the real
// server sent.
const HEADERS_STRIP = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
]);

function bodyToText(b: Capture['response']['body']): string {
  if (b.kind === 'text') return b.data;
  if (b.kind === 'base64') return '(binary response — base64 omitted from editor)';
  if (b.kind === 'skipped') return '(streaming response — not capturable)';
  return '';
}

function suggestGlob(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

function defaultHeadersFromCapture(c: Capture): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.response.headers)) {
    if (HEADERS_STRIP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function headersToLines(h: Record<string, string>): string {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function send<T = unknown>(msg: unknown): Promise<T | null> {
  return chrome.runtime
    .sendMessage(msg)
    .then((res: SwResponse) => (res?.ok ? ((res.data ?? null) as T | null) : null))
    .catch(() => null);
}

export function MutateDrawer({ capture, tabId, existingRule, onClose, onSaved }: Props) {
  const [urlGlob, setUrlGlob] = useState(existingRule?.match.pattern ?? suggestGlob(capture.request.url));
  const [method, setMethod] = useState(existingRule?.match.method ?? capture.request.method);
  const [status, setStatus] = useState(String(existingRule?.mutate.status ?? capture.response.status));
  const [statusText, setStatusText] = useState(existingRule?.mutate.statusText ?? capture.response.statusText);
  const [bodyText, setBodyText] = useState(
    existingRule?.mutate.body?.kind === 'text'
      ? existingRule.mutate.body.data
      : bodyToText(capture.response.body)
  );
  const [headersText, setHeadersText] = useState(
    headersToLines(
      existingRule?.mutate.headers ?? defaultHeadersFromCapture(capture)
    )
  );
  const [latency, setLatency] = useState(String(existingRule?.mutate.latencyMs ?? 0));
  const [useBody, setUseBody] = useState(
    existingRule ? existingRule.mutate.body !== undefined : true
  );
  const [saving, setSaving] = useState(false);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    const mutateBody: MutationBody | undefined = useBody
      ? { kind: 'text', data: bodyText }
      : undefined;
    const parsedHeaders = parseHeaderLines(headersText);

    const rule: Rule = {
      id: existingRule?.id ?? crypto.randomUUID(),
      tabId,
      enabled: existingRule?.enabled ?? true,
      match: {
        type: 'url-glob',
        method: method.trim() || '*',
        pattern: urlGlob.trim(),
      },
      mutate: {
        status: Number(status) || undefined,
        statusText: statusText.trim() || undefined,
        headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
        body: mutateBody,
        latencyMs: Number(latency) || 0,
      },
      fromCaptureId: existingRule?.fromCaptureId ?? capture.id,
      createdAt: existingRule?.createdAt ?? Date.now(),
    };
    await send({ kind: 'sw:save-rule', rule });
    setSaving(false);
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!existingRule) return;
    await send({ kind: 'sw:delete-rule', ruleId: existingRule.id });
    onSaved();
    onClose();
  };

  return (
    <div class="drawer-overlay" onClick={onClose}>
      <div class="drawer" onClick={(e) => e.stopPropagation()}>
        <div class="drawer-head">
          <div>
            <div class="drawer-title">{existingRule ? 'edit rule' : 'create rule from capture'}</div>
            <div class="drawer-sub">{capture.request.method} {capture.request.url}</div>
          </div>
          <button class="btn-sm" onClick={onClose}>close</button>
        </div>

        <div class="form">
          <label>
            <span>URL pattern</span>
            <input
              type="text"
              value={urlGlob}
              onInput={(e) => setUrlGlob((e.target as HTMLInputElement).value)}
              placeholder="https://api.example.com/v1/checkout"
            />
            <small>URLPattern syntax, or `*` glob fallback. Examples: <code>*://*/api/checkout</code>, <code>https://api.example.com/v1/users/*</code></small>
          </label>

          <label>
            <span>Method</span>
            <input
              type="text"
              value={method}
              onInput={(e) => setMethod((e.target as HTMLInputElement).value.toUpperCase())}
              placeholder="GET, POST, * for any"
              list="method"
            />
            <datalist id="method">
                <option value="GET"></option>
                <option value="POST"></option>
                <option value="HEAD"></option>
                <option value="OPTIONS"></option>
                <option value="PUT"></option>
                <option value="PATCH"></option>
                <option value="DELETE"></option>
            </datalist>
          </label>

          <div class="row">
            <label class="grow">
              <span>Status</span>
              <input
                type="number"
                value={status}
                onInput={(e) => setStatus((e.target as HTMLInputElement).value)}
                placeholder="500"
              />
            </label>
            <label class="grow">
              <span>Status text</span>
              <input
                type="text"
                value={statusText}
                onInput={(e) => setStatusText((e.target as HTMLInputElement).value)}
                placeholder="Internal Server Error"
              />
            </label>
            <label class="grow">
              <span>Latency (ms)</span>
              <input
                type="number"
                value={latency}
                onInput={(e) => setLatency((e.target as HTMLInputElement).value)}
                placeholder="0"
              />
            </label>
          </div>

          <label>
            <span>Response headers</span>
            <textarea
              rows={5}
              value={headersText}
              onInput={(e) => setHeadersText((e.target as HTMLTextAreaElement).value)}
              spellcheck={false}
            />
            <small>
              One per line, <code>key: value</code>. Pre-filled from the captured
              response (content-length / encoding stripped). In passthrough mode
              these override matching real headers; in body-replace mode these
              are the only headers sent.
            </small>
          </label>

          <label class="checkbox">
            <input
              type="checkbox"
              checked={useBody}
              onChange={(e) => setUseBody((e.target as HTMLInputElement).checked)}
            />
            <span>Replace body (uncheck to keep real body and override only status / headers)</span>
          </label>

          {useBody && (
            <label>
              <span>Response body</span>
              <textarea
                rows={10}
                value={bodyText}
                onInput={(e) => setBodyText((e.target as HTMLTextAreaElement).value)}
                spellcheck={false}
              />
            </label>
          )}

          <div class="actions">
            {existingRule && (
              <button class="btn-danger" onClick={remove} disabled={saving}>
                delete rule
              </button>
            )}
            <div class="spacer" />
            <button class="btn-primary" onClick={save} disabled={saving || !urlGlob.trim()}>
              {existingRule ? 'save' : 'create rule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
