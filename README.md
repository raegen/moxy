# <img src="icons/moxy-48.png" align="left" width="32" height="32" alt="moxy" /> moxy

[![release](https://img.shields.io/github/v/release/raegen/moxy?color=8b5cf6)](https://github.com/raegen/moxy/releases)
[![license](https://img.shields.io/badge/license-MIT-8b5cf6)](LICENSE)
[![tests](https://github.com/raegen/moxy/actions/workflows/test.yml/badge.svg)](https://github.com/raegen/moxy/actions/workflows/test.yml)

**Mock HTTP responses from your browser.** Override status codes, bodies, headers, latency — in any tab you've granted access to — without a backend proxy and without the yellow `chrome://debugger` banner.

Chrome DevTools' "Local Overrides" can change response bodies but not status codes. moxy fills the gap: intercept your page's `fetch` and `XMLHttpRequest` calls, snapshot the real response, mutate any part of it, save the rule into a **scenario**, share that scenario as a `.moxy.json` file. Attach a broken state to a bug report. Reproduce a teammate's edge case in one click.

## Install

[moxy](https://chromewebstore.google.com/detail/hilainlbpdobjmhgapokojiipniihbbi?utm_source=item-share-cb)

## Usage

moxy grants permissions **per-site**, not all-sites. After install, no site has access — you grant per origin as you encounter it.

### DevTools panel (where the work happens)

Open Chrome DevTools on a site → click the **moxy** tab next to Network/Console. The first time you open it on an origin, Chrome shows its per-site permission prompt — grant once, mock thereafter. Three tabs inside:

- **captures** — every request the page made. Click one to mutate it into a rule.
- **rules** — what's actively mocked in this tab. Toggle individual rules.
- **scenarios** — your library of saved bundles. Import a `.moxy.json`, load it into the current tab, export the active one, save the current rules as a new scenario.

### Side panel (cross-tab visibility)

Click the moxy icon in the toolbar to open the side panel. Two things:

- **ON/OFF pill** — global kill switch. Mutes interception across all live patches without revoking permissions.
- **Active tabs** — one row per tab where moxy is currently mocking, with the active scenario name and rule count. Click `switch ▸` to focus that tab and window.

Revoking access to a site goes through `chrome://extensions` → moxy → Site access.

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

Both injected scripts (MAIN-world patch + ISOLATED-world bridge) build as self-contained IIFEs (Vite lib mode in a second pass) because `chrome.scripting.executeScript` loads classic scripts; ESM `import` would throw. The JSON-Schema validator is precompiled via ajv standalone + esbuild bundle so MV3's `unsafe-eval` ban doesn't kill it. The rest is normal CRXJS / code-split ESM.

## Architecture

- `src/sw.ts` — service worker. Migrates v1 storage → v1.1 on install. Registers patch (MAIN) + bridge (ISOLATED) via `chrome.scripting.registerContentScripts`, scoped to currently-granted origins; syncs on `chrome.permissions.onAdded`/`onRemoved`. Holds scenarios + active-scenario-per-tab in `chrome.storage.local`. All read-modify-write goes through a per-key write lock.
- `src/inject/patch.ts` — MAIN-world content script. Wraps `window.fetch` + `XMLHttpRequest` via [`@mswjs/interceptors`](https://github.com/mswjs/interceptors). Matches rules locally, returns synthesized `Response` objects.
- `src/inject/bridge.ts` — ISOLATED world content script. Relays nonce handshake + capture stream + rule broadcasts between MAIN-world patch and SW. Idempotent — safe to re-inject. Defensive against invalidated extension contexts.
- `src/side-panel/` — slim mission control. ON/OFF pill + active-tabs roster with click-to-switch. No TabContext; the side panel has no single "current tab."
- `src/devtools/panel/` — full per-tab working surface (captures, rules, scenarios). Auto-requests host permission for the inspected origin on first mount via `PermissionGate`. `TabContext` feeds `chrome.devtools.inspectedWindow.tabId`.
- `src/panel-shared/` — `panel.css` only (shared by both hosts).
- `src/shared/` — types, URL matcher, scenario parse/serialize/hash, v1 migration, storage write lock.
- `schema/v1.json` — canonical scenario format contract. Precompiled to `src/shared/generated/validate-v1.mjs` via `scripts/compile-schema.mjs`.
- `icons/moxy.svg` — icon source. Rasterized to PNGs via `scripts/generate-icons.mjs`.

## Privacy

moxy makes no network requests. All storage is local to your Chrome profile. See [PRIVACY.md](PRIVACY.md).

## Known limitations

- **Pre-grant requests are missed.** Programmatic injection happens AFTER `document_start`, so requests fired during the page load *before* you granted access (or before reloading after grant) won't be intercepted. The DevTools panel shows a one-time reload reminder after a fresh grant.
- **Incognito.** moxy works in incognito tabs only if you've enabled "Allow in incognito" for the extension. Side panel and DevTools panel write to different `chrome.storage.local` partitions across the incognito boundary.
- **`file://` URLs.** Not currently mockable. moxy is `http(s)://` only in v1.3.
- **Restart drops active scenarios.** Tab IDs recycle across Chrome restarts; moxy clears the active-scenario-per-tab map on startup. Your scenario library persists; reload into the tab manually.
- **Streaming responses** (`text/event-stream`, chunked) are captured-only, not mockable. moxy logs a console warning and passes the real response through.

## License

[MIT](LICENSE).
