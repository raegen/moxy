# Chrome Web Store — listing copy

Everything below is meant to be **pasted verbatim** into the Chrome Web Store
Developer Dashboard fields. Each section is labelled with the dashboard field
it goes into.

---

## Settings → Contact email

`<TODO: your publisher contact email — required, must be verified>`

(Chrome sends a verification email to this address. Verify it before submitting.)

---

## Privacy practices → Single purpose description

moxy mocks HTTP responses (`fetch` and `XMLHttpRequest`) in the user's active browser tab. It lets developers override response status codes, headers, bodies, and latency without modifying their backend, and lets them save those mock configurations as portable JSON files to share with teammates for bug repro and testing.

---

## Privacy practices → Host permission justification

`<all_urls>` is required because moxy must inject a request interceptor into whichever tab the developer is testing. Developers cannot know in advance which sites they will need to mock against — the target varies per project, per task, per debugging session. The side panel and DevTools panel are user-driven: moxy only applies mock rules to tabs the user has explicitly scoped rules to via the panel UI. Without `<all_urls>`, moxy cannot support its stated single purpose for the general case of "whatever web app the developer is currently building or debugging."

---

## Privacy practices → Remote code justification

moxy does NOT load, execute, or evaluate any remote code. All extension JavaScript is bundled at build time via Vite + esbuild:

- The MAIN-world request interceptor (`patch.js`) ships as a self-contained IIFE with `@mswjs/interceptors` inlined.
- The JSON Schema validator for scenario files (`validate-v1.mjs`) is precompiled via `ajv` standalone + `esbuild --bundle --format=esm` — no `new Function`, no `eval`, no runtime schema compilation.
- All dependencies are resolved and inlined at build time. No CDN scripts, no remote module loading, no dynamic `import()` of external URLs.

The only "code-like" content moxy handles at runtime is the response body the developer types into the mutation form, which is then served back to the developer's own page as a synthesized `Response` object. This is data flowing from the developer to the developer's own application — equivalent to typing a JSON literal into Chrome DevTools — not external code execution by the extension.

---

## Privacy practices → `scripting` justification

moxy uses `chrome.scripting.registerContentScripts` to register a MAIN-world content script (`patch.js`) that wraps `window.fetch` and `XMLHttpRequest` on pages the user is testing. This is the request-interception primitive at the heart of moxy's single purpose. It also uses `chrome.scripting.executeScript` to re-inject the patch into already-open tabs when the extension is reloaded during development (so the user does not have to reload every tab manually after each extension update).

---

## Privacy practices → `sidePanel` justification

moxy's primary user interface is rendered in the Chrome side panel via `chrome.sidePanel`. Users click the moxy toolbar action to open the side panel and view captured requests, edit mock rules, and manage scenarios. The `sidePanel` permission is required to register and open this UI surface. There is no alternative UI mechanism that provides the same persistent, side-by-side view next to the developer's app.

---

## Privacy practices → `storage` justification

moxy persists user-created mock rules and a per-tab rolling buffer of recent captures to `chrome.storage.local`. This data is essential to the extension's core function:

- Without storage, mock rules would vanish on tab refresh or extension reload.
- The side panel could not show recent captures.
- Scenarios (named bundles of rules, imported from `.moxy.json` files) could not persist between sessions.

All storage is local to the user's Chrome profile. moxy makes no outbound network requests and transmits no user data to any external service.

---

## Privacy practices → `tabs` justification

moxy is per-tab by design. The `tabs` permission is used to:

1. Determine the currently-active tab id so the side panel can scope mock rules and captures to that tab.
2. Listen for `chrome.tabs.onActivated` so the panel UI updates when the user switches between tabs.
3. Listen for `chrome.tabs.onRemoved` to clean up per-tab state (active scenario, capture buffer) when tabs close, preventing storage leaks across browsing sessions.

moxy does not enumerate, modify, or read the content of tabs outside the explicit per-tab scoping the user has set up via the panel UI.

---

## Privacy practices → Data usage certification (checkbox)

You must tick the "I certify that my data usage complies with the Developer Program Policies" checkbox. moxy honestly satisfies these because:

- moxy does **not collect** personally identifiable information.
- moxy does **not transmit** any user data to remote services.
- moxy does **not use** user data for purposes unrelated to its single purpose.
- moxy does **not sell** user data.

If the dashboard asks you to declare data types collected/used, check NONE of the following: personally identifiable information, health information, financial information, authentication information, personal communications, location, web history, user activity, website content.

---

## Privacy practices → Privacy policy URL

```
https://github.com/raegen/moxy/blob/main/PRIVACY.md
```

(Until there's a project website. Replace with `https://moxy.dev/privacy` or similar once that exists.)

---

## Store listing → Category

**Developer Tools**

---

## Store listing → Detailed description (DRAFT — edit to taste before submitting)

> Paste into the Store Listing → Description field. Plain text or basic HTML (`<b>`, `<i>`, `<a>`, `<br>`, `<ul>`, `<li>`, `<p>`) allowed.

**Mock HTTP responses from your browser.** moxy intercepts your page's `fetch` and `XMLHttpRequest` calls and lets you override the response — status code, headers, body, latency — without touching your backend, without running a separate proxy, and without the yellow "this browser is being controlled by automated test software" banner.

Chrome DevTools' Local Overrides can change response bodies, but not status codes. moxy fills the gap.

**The workflow:**

1. Open the moxy side panel on the tab you're debugging.
2. Every request your page makes shows up in the captures list with its real response.
3. Click a capture, change the status to 500, hit save. The next time your app makes that call, it sees the mocked response.
4. Save a set of mocked calls as a **scenario** — a named JSON bundle you can export, share with a teammate, or attach to a bug report. Drop the file into their moxy and they see the same broken state.

**Built for testing how your app handles error paths.**

- Force any HTTP status — 500, 401, 429, 503 — and verify your error UI is what you wanted.
- Inject artificial latency to test loading states without throttling DevTools.
- Modify response bodies (JSON, text, base64) and verify your parsing is defensive.
- Override response headers — CORS, cache, content-type — to test header-dependent client logic.
- Mock a single endpoint or a whole scenario, scoped to one tab so other tabs aren't affected.

**Two surfaces:**

- **Side panel** — persistent UI alongside your app for capture browsing and rule editing.
- **DevTools panel** — the same UI inside Chrome DevTools, scoped to the tab DevTools is inspecting. Stay in DevTools while you mock.

**Local-only.** moxy makes no outbound network requests. All rules and captures are stored in `chrome.storage.local`, never synced or transmitted anywhere. Full privacy policy: https://github.com/raegen/moxy/blob/main/PRIVACY.md

**Open source.** MIT licensed. https://github.com/raegen/moxy

**Built for developers, no signup, no account, no telemetry.**

---

## Store listing → Short description (132-char limit, shown in search results)

Mock HTTP responses in your browser. Override status, body, headers, latency. Share scenarios as .moxy.json files. No backend changes.

(Count: 130 chars.)

---

## Submission order

1. **Settings → Contact email** — fill in, click verify, click the link in the email Chrome sends.
2. **Settings → Account** — pay the $5 one-time developer fee if not already done.
3. **Privacy practices** — paste each justification above into its respective field. Tick the data-usage compliance checkbox.
4. **Store listing** — upload screenshots (3-5 at 1280×800), paste the detailed description, set category to Developer Tools, set privacy policy URL.
5. **Package** — `cd dist && zip -r ../moxy-v1.2.0.zip .` then upload the zip.
6. **Submit for review.** Typical CWS review for a new extension: 1-3 business days.
