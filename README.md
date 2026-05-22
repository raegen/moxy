# <img src="icons/moxy-48.png" align="left" width="32" height="32" alt="moxy" /> moxy

[![release](https://img.shields.io/github/v/release/raegen/moxy?color=8b5cf6)](https://github.com/raegen/moxy/releases)
[![license](https://img.shields.io/badge/license-MIT-8b5cf6)](LICENSE)
[![tests](https://github.com/raegen/moxy/actions/workflows/test.yml/badge.svg)](https://github.com/raegen/moxy/actions/workflows/test.yml)

**Mock HTTP responses from your browser.** Override status codes, bodies, headers, latency — in any tab — without a backend proxy and without the yellow `chrome://debugger` banner.

Chrome DevTools' "Local Overrides" can change response bodies but not status codes. moxy fills the gap: intercept your page's `fetch` and `XMLHttpRequest` calls, snapshot the real response, mutate any part of it, save the rule into a **scenario**, share that scenario as a `.moxy.json` file. Attach a broken state to a bug report. Reproduce a teammate's edge case in one click.

> Status: v1.2.0 — branding + Chrome Web Store prep. CWS submission is the next step.

## Install

### From source (today)

```bash
git clone https://github.com/raegen/moxy
cd moxy
bun install
bun run build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `dist/` folder.

### From Chrome Web Store

Coming soon. See `store-assets/README.md` for the submission checklist.

## Usage

### Side panel

Click the moxy icon in the toolbar to open the side panel. Three tabs:

- **captures** — every request your page made. Click one to mutate it into a rule.
- **rules** — what's actively mocked in this tab. Toggle individual rules; the **ON/OFF** pill in the header is the global kill switch.
- **scenarios** — your library of saved bundles. Import a `.moxy.json`, load it into the current tab, export the active one as a file.

### DevTools panel

Open Chrome DevTools → the **moxy** panel appears next to Network/Console. Same UI as the side panel, scoped to the tab DevTools is inspecting. Stay in DevTools while you mock — no context switch.

### Scenarios

```json
{
  "$schema": "https://raw.githubusercontent.com/raegen/moxy/v1.1.0/schema/v1.json",
  "moxyFormatVersion": 1,
  "name": "Checkout 500",
  "description": "Stripe charge returns 500 with backend error payload.",
  "rules": [
    {
      "match": { "type": "url-glob", "pattern": "https://api.stripe.com/v1/charges", "method": "POST" },
      "mutate": {
        "status": 500,
        "headers": { "content-type": "application/json" },
        "body": { "type": "json", "data": { "error": { "type": "api_error", "message": "Test failure" } } },
        "latencyMs": 800
      }
    }
  ]
}
```

Drop into the **scenarios** tab via the file picker or drag-drop. The scenario loads into the current tab automatically. Tab-close unloads. Browser-restart unloads (tab IDs recycle); reload from the library if needed.

The format is documented as a real JSON Schema in [`schema/v1.json`](schema/v1.json) — IDE autocomplete works when you reference the `$schema` URL.

## Develop

```bash
bun run dev          # vite watcher + auto-rebuild
bun run test         # vitest in watch mode
bun run test:run     # one-shot
bun run typecheck    # tsc --noEmit
bun run build        # production build to dist/
bun run build:icons  # regenerate icons/*.png from icons/moxy.svg
bun run build:schema # recompile schema/v1.json into the precompiled validator
```

The MAIN-world patch builds as a self-contained IIFE (Vite lib mode in a second pass) because `chrome.scripting.executeScript` loads classic scripts; ESM `import` would throw. The JSON-Schema validator is precompiled via ajv standalone + esbuild bundle so MV3's `unsafe-eval` ban doesn't kill it. The rest is normal CRXJS / code-split ESM.

## Architecture

- `src/sw.ts` — service worker. Migrates v1 storage → v1.1 on install. Registers the MAIN-world patch via `chrome.scripting.registerContentScripts` and force-injects into already-open tabs at boot (cold-start fix). Holds scenarios + active-scenario-per-tab in `chrome.storage.local`. All read-modify-write goes through a per-key write lock.
- `src/inject/patch.ts` — MAIN-world content script. Wraps `window.fetch` + `XMLHttpRequest` via [`@mswjs/interceptors`](https://github.com/mswjs/interceptors). Matches rules locally, returns synthesized `Response` objects.
- `src/inject/bridge.ts` — ISOLATED world content script. Relays nonce handshake + capture stream + rule broadcasts between MAIN-world patch and SW. Idempotent — safe to re-inject. Defensive against invalidated extension contexts.
- `src/panel/` — side panel host. Owns the active-tab subscription.
- `src/devtools/` — DevTools page launcher + dedicated panel host. Reads `chrome.devtools.inspectedWindow.tabId`.
- `src/panel-shared/` — Preact UI shared between both panel hosts. `TabContext` injects the "current tab id" — different per host.
- `src/shared/` — types, URL matcher, scenario parse/serialize/hash, v1 migration, storage write lock.
- `schema/v1.json` — canonical scenario format contract. Precompiled to `src/shared/generated/validate-v1.mjs` via `scripts/compile-schema.mjs`.
- `icons/moxy.svg` — icon source. Rasterized to PNGs via `scripts/generate-icons.mjs`.

## Privacy

moxy makes no network requests. All storage is local to your Chrome profile. See [PRIVACY.md](PRIVACY.md).

## Known limitations

- **Editing the same rule from both the side panel and the DevTools panel simultaneously is last-write-wins.** Work in one surface at a time, or refresh before saving when both are open.
- **Incognito.** moxy works in incognito tabs only if you've enabled "Allow in incognito" for the extension. Side panel and DevTools panel write to different `chrome.storage.local` partitions across the incognito boundary.
- **Cold-start coverage.** The v1.0.1 fix re-injects on extension reload but doesn't catch fetch/XHR calls that fired *during* the page load that preceded the install. Reload the tab once after a fresh install for full coverage.
- **Restart drops active scenarios.** Tab IDs recycle across Chrome restarts; moxy clears the active-scenario-per-tab map on startup. Your scenario library persists; reload into the tab manually.
- **Streaming responses** (`text/event-stream`, chunked) are captured-only, not mockable. moxy logs a console warning and passes the real response through.

## License

[MIT](LICENSE).
