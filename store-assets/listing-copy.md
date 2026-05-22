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

moxy declares `<all_urls>` under `optional_host_permissions`, not the required field, so the install dialog shows no host warning. Access is granted per-site at runtime — when the user opens the moxy DevTools panel on a site, Chrome's standard per-site permission prompt fires. Only origins the user explicitly grants are ever intercepted. The optional set spans `<all_urls>` because moxy cannot predict which sites a developer needs to mock; the target varies per project and debugging session.

---

## Privacy practices → Remote code justification

moxy loads, executes, and evaluates no remote code. All JavaScript is bundled at build time via Vite + esbuild. The MAIN-world interceptor (`patch.js`) is a self-contained IIFE with `@mswjs/interceptors` inlined. The JSON Schema validator is precompiled via ajv standalone + esbuild — no `new Function`, no `eval`, no runtime schema compilation. No CDN scripts, no remote modules, no dynamic `import()` of external URLs. Response bodies the user types into the rule editor are served back to their own page as synthesized `Response` objects — data, not external code execution.

---

## Privacy practices → `scripting` justification

moxy registers two content scripts on user-granted origins via `chrome.scripting.registerContentScripts`: `patch.js` (MAIN world) wraps `window.fetch` and `XMLHttpRequest` — the request-interception primitive at the heart of the single purpose. `bridge.js` (ISOLATED world) relays captured-request data and rule updates to the service worker. The registration's `matches` array stays in sync with currently-granted origins. `executeScript` is used to inject into already-open tabs at grant time so the user does not have to reload manually.

---

## Privacy practices → `sidePanel` justification

moxy renders cross-tab mission control in the Chrome side panel via `chrome.sidePanel`: global ON/OFF kill switch and a roster of tabs where moxy is currently mocking, with click-to-switch jump buttons. Users click the toolbar action to open it. `sidePanel` is required to register this UI surface.

---

## Privacy practices → `storage` justification

moxy persists mock rules, scenarios, and a per-tab capture buffer to `chrome.storage.local`. Without storage, rules would vanish on refresh, the DevTools panel could not show recent captures, scenarios could not persist between sessions, and the side panel roster could not survive service-worker wake/sleep cycles. All storage is local to the user's Chrome profile; moxy makes no outbound network requests.

---

## Privacy practices → `tabs` justification

moxy uses `tabs` to: (1) render the side panel's active-tabs roster via `chrome.tabs.query` (`tab.url` is otherwise stripped on ungranted origins); (2) click-to-switch from a roster row via `chrome.tabs.update` + `chrome.windows.update`; (3) read the DevTools-inspected tab's URL via `chrome.tabs.get` to derive the origin to request host permission for; (4) iterate open tabs after a grant to inject into already-loaded matching pages; (5) clean up per-tab state via `chrome.tabs.onRemoved` when tabs close.

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

**Per-site access, granted as you go.** moxy ships with no host permissions at install. Open the moxy panel in Chrome DevTools on a site you want to mock; Chrome asks once whether you want to grant moxy access to that site. Grant, mock, done. Other sites stay untouched until you grant them too. Revoke any site anytime from `chrome://extensions`.

**The workflow:**

1. Navigate to the site you're debugging and open Chrome DevTools.
2. Click the **moxy** tab in DevTools — Chrome's per-site permission prompt appears the first time. Grant it.
3. Every request your page makes shows up in the captures list with its real response.
4. Click a capture, change the status to 500, hit save. The next time your app makes that call, it sees the mocked response.
5. Save a set of mocked calls as a **scenario** — a named JSON bundle you can export, share with a teammate, or attach to a bug report. Drop the file into their moxy and they see the same broken state.

**Built for testing how your app handles error paths.**

- Force any HTTP status — 500, 401, 429, 503 — and verify your error UI is what you wanted.
- Inject artificial latency to test loading states without throttling DevTools.
- Modify response bodies (JSON, text, base64) and verify your parsing is defensive.
- Override response headers — CORS, cache, content-type — to test header-dependent client logic.
- Mock a single endpoint or a whole scenario, scoped to one tab so other tabs aren't affected.

**Two surfaces, two jobs:**

- **DevTools panel** — the per-tab working surface. Captures, rules, scenarios — all where you already are when you're debugging.
- **Side panel** — cross-tab mission control. Global ON/OFF kill switch and a roster of every tab moxy is currently mocking. Click a row to jump to that tab.

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
5. **Package** — `cd dist && zip -r ../moxy-v1.3.0.zip .` then upload the zip.
6. **Submit for review.** Typical CWS review for a new extension: 1-3 business days.
