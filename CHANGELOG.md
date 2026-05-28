# Changelog

All notable changes to moxy are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/).

## v1.3.2 — 2026-05-28

### Fixed
- **Captures stop appearing after the extension has been running a while.** Captures used to live in `chrome.storage.local`, which has a 10 MB hard quota across all keys. Once a long-lived browser session accumulated enough captures, every new `storage.local.set` failed with `Resource::kQuotaBytes quota exceeded`, breaking not just capture storage but every other write that shared the namespace. New captures silently disappeared; the panel showed an empty list for the affected origin even though `interceptor.on('response')` was firing. Captures now live in `chrome.storage.session` — auto-cleared on browser restart, isolated from rule + scenario storage, and they're inherently ephemeral anyway. On boot the legacy `moxy:captures` blob is purged from `.local` so existing users immediately reclaim that quota.

### Added
- **Opt-in debug logging across the whole message bus.** A new `src/shared/debug.ts` exposes `createDebug(prefix)`, gating logs behind `localStorage.moxy:debug === '1'` in page contexts (patch, bridge, devtools panel, side panel) and `globalThis.MOXY_DEBUG = true` in the SW. Instrumented every meaningful hop: patch lifecycle + nonce handshake + per-request rule-match decisions + response → bridge handoff, bridge install + nonce-out + capture-forward (replacing the silent `.catch` with explicit `.then`/`.catch` traces) + rules round-trip, SW boot phases + every `recv`/`reply`/`threw`/`notifyPanel`/`broadcastRulesToTab` + capture-store result, both panels' `send`/`recv` (including the DevTools panel's `tabId` filter drops with the actual mismatched IDs). Off by default — zero noise unless you flip the flag in the surface you want logs from.

### Changed
- **Auto-created scenario names now come from the inspected page.** The first rule you save in a tab with no active scenario creates an ephemeral scenario named `{pageTitle} — {hostname}` (e.g. `GitHub — github.com`) instead of `Untitled (DevTools) — tab 1111726977`. Falls back to hostname, then title, then `Untitled scenario` when nothing's available.
- **Auto-created scenarios no longer carry the misleading "Rename to keep" description.** That string promised rename UI that didn't exist.

### Added
- **Inline rename + description editing** in the scenario library. Double-click a scenario's name or description in the DevTools panel to edit. Enter saves, Esc cancels. Names can't be empty; descriptions can.
- **Drag-to-export** scenarios. Drag a scenario row out of the DevTools panel into Finder/Explorer to drop a `.moxy.json` file. Drag into a text editor or chat window to paste the raw JSON. The existing Export button stays.
- **Logo in the panel headers.** Both DevTools and side panel now show the moxy mark next to the brand name. Reuses `icons/moxy-24.png` rendered at 16×16.

### Removed
- `EPHEMERAL_NAME_PREFIX` — ephemeral detection now keys off the scenario id prefix (`s_eph_t*`) so user-renamed scenarios still survive GC correctly.

### UI polish
- **DevTools header decluttered.** Removed the `N/M active` badge and the `tab N` badge (the latter was a leftover from when the side panel mirrored DevTools and needed to disambiguate tabs). Disabled-rules signal folded into the `rules` tab pill — shows `N/M` only when some rules are toggled off.
- **`Clear` button moved.** Was in the header, now lives in a small toolbar above the capture list (`N captures` on the left, `clear` on the right). Toolbar only renders when there's something to clear.
- **ON/OFF moved to the right side of both headers.** Brand reads as one unit on the left (`[logo] moxy`); kill switch lives on the right where browsers and IDEs conventionally place controls.

## v1.3.0 — 2026-05-22

### Changed
- **Permissions are now granted per-site at runtime, not all-sites at install.** `host_permissions: ["<all_urls>"]` → `optional_host_permissions: ["<all_urls>"]`. Chrome's install dialog no longer shows the "Read your data on all websites" warning — only "Read your browsing history" (from the `tabs` permission) remains.
- **DevTools panel auto-requests host permission on first mount per inspected origin.** Click the moxy tab in DevTools → Chrome's per-site permission prompt appears → grant once, mock thereafter. If the user gesture window expires before the request fires, a `Grant access to {host}` button banner is the fallback.
- **Side panel reshaped as cross-tab mission control.** No longer mirrors the DevTools panel UI. Two pieces of UI total: global ON/OFF kill switch + a roster of tabs currently mocking, with `switch ▸` click-to-focus per row. Scenario management stays in DevTools where the capture→mutate→save flow lives.

### Added
- Content scripts (patch + bridge) registered programmatically and scoped to currently-granted origins. The registration syncs on every `chrome.permissions.onAdded` / `onRemoved`. Static `content_scripts` declaration removed from the manifest.
- `chrome.permissions.onRemoved` cleans up `moxy:active` entries whose tab origins are no longer granted.
- `panel:permissions-changed` SW broadcast keeps the side panel roster and DevTools panel gate in sync with permission state.
- `sw:list-roster` SW message joins `moxy:active` + scenarios + open tabs + per-tab permission check into a single payload for the side panel.
- `RosterRow` type in `src/shared/types.ts`.

### Removed
- `panel-shared/` no longer holds Preact components — only `panel.css`. The DevTools-only components (`App`, `MutateDrawer`, `ScenarioBar`, `ScenariosTab`, `TabContext`) moved to `src/devtools/panel/`. New side panel lives at `src/side-panel/`.
- Side panel's `captures` / `rules` / `scenarios` tabs — that surface is the DevTools panel's job now.

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
