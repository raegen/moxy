# moxy

A Chrome extension for full response mocking — including status codes.

Chrome DevTools "Local Overrides" can change response bodies but not status codes. moxy is a side panel + content-script patch that intercepts your page's `fetch` and `XMLHttpRequest` calls, lets you snapshot a real response, mutate `status`/`headers`/`body`/`latency`, and replay. Per-tab scoped. No yellow debugger banner.

## Status

Phase 1 (scaffold). Loads as an unpacked MV3 extension; patch wires into `window.fetch` and logs every call. No mocking yet.

## Install

```bash
bun install
bun run build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → select the `dist/` folder.

## Develop

```bash
bun run dev
```

Vite + `@crxjs/vite-plugin` watches and rebuilds `dist/`. Chrome auto-reloads the extension on changes; reload the page you're testing to re-inject the patch.

## Architecture

- `src/sw.ts` — service worker. Registers the MAIN-world patch via `chrome.scripting.registerContentScripts`. Holds rules in `chrome.storage.local`. Broadcasts rule sets to live tabs.
- `src/inject/patch.ts` — MAIN-world content script. Wraps `window.fetch` and `XMLHttpRequest` via [`@mswjs/interceptors`](https://github.com/mswjs/interceptors). Matches rules locally and returns synthesized `Response` objects.
- `src/inject/bridge.ts` — ISOLATED world content script. Relays messages between the MAIN-world patch and the service worker.
- `src/panel/` — Preact side panel UI. Capture list, mutate drawer.
- `src/shared/` — types + URL matcher.

The MAIN-world patch is built as a self-contained IIFE (Vite lib mode in a second pass) because `chrome.scripting.registerContentScripts` injects classic scripts and ESM `import` would throw. The rest of the build is normal CRXJS / code-split ESM.
