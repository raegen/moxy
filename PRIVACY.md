# moxy — Privacy Policy

Effective: 2026-05-22

moxy is a developer tool. It runs entirely in your browser; nothing leaves your device.

## What moxy reads

When you load moxy into a Chrome tab, it intercepts that tab's `fetch` and `XMLHttpRequest` calls so you can mock the responses. To do that, the extension can see:

- The URL, method, headers, and body of every request your page makes
- The status, headers, and body of every response your page receives
- The URL of the tab the panel is currently scoped to

The extension does NOT read:

- Form input you type into pages
- DOM content (text, images, video) outside of network requests
- Pages or tabs the side panel is not currently scoped to (the patch only emits captures to the moxy service worker)
- Anything from incognito tabs unless you've explicitly enabled "Allow in incognito" for the extension

## What moxy stores

All moxy data lives in your browser's `chrome.storage.local`. The storage contains:

- **Scenarios** you've imported or created — the JSON rule bundles
- **Captures** — a rolling buffer of the last 500 requests per tab, used to populate the panel UI
- **Active-scenario-per-tab state** — which scenario is loaded in which tab id (cleared on browser restart)
- **Global on/off flag**
- **Format-version marker** to gate the v1 → v1.1 migration

This storage is local to your Chrome profile. It is never synced to any moxy server (there is no moxy server) and never transmitted anywhere by moxy itself.

## What moxy sends

**Nothing.** moxy makes no outbound network requests. It does not call any analytics, telemetry, error-reporting, or update-check endpoint. The only network traffic moxy is involved in is the traffic of the tab you're testing — and even then, only the real `fetch` / `XHR` calls the page itself makes (with optional mocked responses synthesized locally).

## Permissions explained

moxy declares the following permissions in its manifest. Each is necessary for the stated feature:

- **`scripting`** — to inject the response interceptor into pages.
- **`storage`** — to save scenarios and captures to `chrome.storage.local`.
- **`tabs`** — to know which tab the side panel is scoped to and to clean up state when tabs close.
- **`sidePanel`** — to render the moxy side panel UI.
- **`<all_urls>` host permission** — moxy can only mock requests on tabs it has injection permission for. To work on whatever app you're developing, the extension requests access to all URLs. You can restrict this per-site via Chrome's per-site extension settings if you prefer.

## DevTools panel

When you open Chrome DevTools, moxy registers a "moxy" panel via `chrome.devtools.panels.create`. That panel runs in DevTools' own extension context, reads the same `chrome.storage.local` as the side panel, and shares no additional data with anything.

## Open source

moxy is open source under the MIT license. The code that handles your data is auditable at https://github.com/raegen/moxy.

## Contact

For privacy questions, file an issue at https://github.com/raegen/moxy/issues.
