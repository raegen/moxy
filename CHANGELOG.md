# Changelog

All notable changes to moxy are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/).

## v1.2.0 — 2026-05-22

### Added
- Branded action icon — lowercase `m` in ultraviolet on dark, rendered from `icons/moxy.svg` to 16 / 32 / 48 / 128 PNGs via `bun run build:icons` (resvg).
- Manifest metadata: `short_name`, `author`, `homepage_url`. Description rewritten for the Chrome Web Store listing.
- `LICENSE` (MIT), `PRIVACY.md`, `CHANGELOG.md`, `store-assets/` directory for CWS submission materials.

### Removed
- `hello_extensions.png` — the Chrome hello-world placeholder icon. Replaced by the branded set.

## v1.1.3 — 2026-05-22

### Fixed
- **`Uncaught ReferenceError: require is not defined`** in the scenario bundle. ajv-standalone's `esm: true` flag converts module exports but leaves `require()` calls for runtime helpers (`ucs2length`, ajv-formats format regexes). MV3 contexts have no global `require`. Now the precompiled validator runs through `esbuild.build({ bundle: true, format: 'esm' })` which resolves and inlines every require into pure ESM.
- **Service worker registration failed with status code 15** (module parse failure). Same root cause as the require issue — the SW imports `migrate.ts` → `scenario.ts` → the broken validator and the module failed to parse. Fixed by the above.
- **`Cannot read properties of undefined (reading 'sendMessage')`** in the bridge. Orphaned content-script instances from previous extension installs would throw on every page fetch. Bridge now wraps every `chrome.runtime` access in a `safeRuntime()` check that detects invalidated contexts and bails before throwing.

## v1.1.2 — 2026-05-22

### Fixed
- Schema's `format: "date-time"` on `createdAt` was silently ignored at runtime (ajv 8 doesn't ship format validators by default — they live in `ajv-formats`). Now `addFormats` is wired into the precompile step; the date-time format is actually enforced. Two new regression tests pin valid + invalid date-time strings.

## v1.1.1 — 2026-05-21

### Added
- `schema/v1.json` — the canonical JSON Schema 2020-12 contract for `.moxy.json` files. Previously the validation rules lived only in TypeScript code and the published `$schema` URL pointed to a file that didn't exist.
- ajv standalone precompile pipeline (`scripts/compile-schema.mjs` → `src/shared/generated/validate-v1.mjs`). MV3-CSP-safe (no `new Function`, no `eval`).
- DevTools panel UI tests (`src/devtools/panel/host.test.tsx`). Extracted `DevToolsPanelHost` as a testable component.

### Changed
- `src/shared/scenario.ts` rewritten as a thin wrapper over the precompiled validator. Friendly pre-checks for format-version + matcher-type messages; ajv handles the rest.

## v1.1.0 — 2026-05-21

### Added
- **Shareable scenarios.** Save mock rules as `.moxy.json` files, share them with teammates, attach to bug reports.
- **Dedicated DevTools panel.** Open Chrome DevTools → "moxy" panel appears alongside Network/Console. Same UI as the side panel, scoped to the inspected tab.
- Discriminated-union matcher type (`url-glob` in v1.1; `regex` / `header` / `body-jsonpath` reserved for v1.2).
- `Body` discriminated union adds `kind: 'json'` variant — no double-stringify when mocking JSON responses.
- v1 → v1.1 migration with `moxy:formatVersion` flag written LAST for crash-resistant idempotency. Six DATA-LOSS regression tests pin the contract.
- Per-key storage write lock (`src/shared/storage.ts`) — eliminates the read-modify-write race between the side panel, the DevTools panel, and the capture stream.
- ScenarioBar component shows the active scenario for the current tab.
- ScenariosTab with drag-drop / file picker / paste textarea import, library browser with load / export / duplicate / delete, scenario name collision auto-rename.

## v1.1.0-refactor (v1.1a) — 2026-05-21

### Changed
- Moved `src/panel/` → `src/panel-shared/` via `git mv` for clean history. Added `TabContext` provider so the shared UI can be mounted by both the side panel (live `chrome.tabs` subscription) and the DevTools panel (fixed `chrome.devtools.inspectedWindow.tabId`).

### Added
- Test infrastructure: vitest 2.x + jsdom 25 + `@testing-library/preact`. 14 tests at the time of the refactor.
- `.github/workflows/test.yml` — runs typecheck + tests + build on push and PR.

## v1.0.1 — 2026-05-20

### Fixed
- **Cold-start gap.** Reloading the extension during dev previously required reloading every open tab for the patch to re-inject. Now `injectIntoExistingTabs()` in the SW iterates open `http(s)` tabs at every boot trigger and force-injects `patch.js` (MAIN) + bridge (ISOLATED) via `chrome.scripting.executeScript`. Respects `chrome.extension.isAllowedIncognitoAccess()`. Logs per-tab inject failures (CSP-strict pages) to the SW console.
- Bridge idempotency guard via `globalThis.__moxy_bridge_installed` — re-injection on already-bridged tabs is a clean no-op.

## v1.0.0 (initial public commit) — 2026-05-20

### Added
- MV3 Chrome extension that intercepts page `fetch` and `XMLHttpRequest` via `@mswjs/interceptors` (no debugger banner, full status code control).
- Side panel UI built with Preact: capture list, mutate drawer (status / status-text / headers / body / latency), rules tab, global ON/OFF toggle.
- Rule storage in `chrome.storage.local` with per-tab capture buffer (500/tab).
