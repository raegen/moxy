# moxy

A Chrome extension for full response mocking — including status codes.

Chrome DevTools "Local Overrides" can change response bodies but not status codes. moxy intercepts your page's `fetch` and `XMLHttpRequest` calls, lets you snapshot a real response, mutate `status` / `headers` / `body` / `latency`, and replay. Per-tab scoped. No yellow debugger banner. Mocks live in **scenarios** — named bundles you can save, export to `.moxy.json`, and share.

## Status

- **v1.0.1** — cold-start fix, ships now.
- **v1.1.0** — shareable scenarios, dedicated DevTools panel.

## Install

```bash
bun install
bun run build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → select the `dist/` folder.

## Usage

**Side panel.** Click the moxy icon in the toolbar to open the side panel. Three tabs:

- **captures** — every request your page made. Click one to mutate it into a rule.
- **rules** — what's actively mocked in this tab. Toggle individual rules; the ON/OFF pill in the header kills the whole patch globally.
- **scenarios** — your library of saved bundles. Import a `.moxy.json`, load it into the current tab, or export the active scenario.

**DevTools panel.** Open Chrome DevTools (Cmd+Option+I) → the **moxy** panel appears in the tab bar next to Network/Console. Same UI as the side panel, bound to the tab DevTools is inspecting. Stay in DevTools while you mock — no context switch.

**Scenarios.**
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

## Develop

```bash
bun run dev          # vite watcher + auto-rebuild
bun run test         # vitest in watch mode
bun run test:run     # one-shot
bun run typecheck    # tsc --noEmit
bun run build        # production build to dist/
```

The MAIN-world patch builds as a self-contained IIFE (Vite lib mode in a second pass) because `chrome.scripting.executeScript` loads classic scripts; ESM `import` would throw. The rest is normal CRXJS / code-split ESM.

## Architecture

- `src/sw.ts` — service worker. Migrates v1 storage → v1.1 on install. Registers MAIN-world patch via `chrome.scripting.registerContentScripts` + force-injects into already-open tabs at boot (cold-start fix). Holds scenarios + active-scenario-per-tab in `chrome.storage.local`. All read-modify-write goes through a per-key write lock.
- `src/inject/patch.ts` — MAIN-world content script. Wraps `window.fetch` + `XMLHttpRequest` via [`@mswjs/interceptors`](https://github.com/mswjs/interceptors). Matches rules locally; returns synthesized `Response` objects.
- `src/inject/bridge.ts` — ISOLATED world content script. Relays nonce handshake + capture stream + rule broadcasts between the MAIN-world patch and the service worker. Idempotent — safe to re-inject.
- `src/panel/` — side panel host. Owns the active-tab subscription.
- `src/devtools/` — DevTools page launcher + dedicated panel host. Reads `chrome.devtools.inspectedWindow.tabId`.
- `src/panel-shared/` — Preact UI shared between both panel hosts. `TabContext` injects the "current tab id" — different per host.
- `src/shared/` — types, URL matcher, scenario parse/serialize/hash, v1 migration, storage write lock.

## Known limitations

- **Editing the same rule from both the side panel and the DevTools panel simultaneously is last-write-wins.** If you have a mutate drawer open in one surface and save from the other, your unsaved edits get silently overwritten when you save. Either work in one surface at a time, or refresh before saving when both are open.
- **Incognito.** moxy works in incognito tabs only if you've enabled "Allow in incognito" for the extension. Side panel and DevTools panel write to different `chrome.storage.local` partitions across the incognito boundary — they won't sync state with each other.
- **Cold-start coverage.** The v1.0.1 fix re-injects on extension reload, but late injection doesn't intercept fetch/XHR calls that fired *during* page load (before the patch landed). For full coverage of page-load requests, reload the tab once after a fresh install.
- **Restart drops active scenarios.** Tab IDs recycle across Chrome restarts, so moxy clears the active-scenario-per-tab map on startup. Your scenario library persists; reload into the tab manually.
- **Streaming responses** (`text/event-stream`, chunked) can be captured-only, not mocked. moxy logs a console warning and passes the real response through.
