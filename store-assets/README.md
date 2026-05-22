# Chrome Web Store submission assets

Files in this directory ship to the Chrome Web Store listing, NOT the
extension package.

## Generated artifacts (committed)

- `icon-128.png` — store icon (same source as the action icon at this size)
- `icon-1024.png` — large promotional / retina source

Both regenerate via `bun run build:icons`.

## To-do before first CWS submission

### Required
- **Screenshots** — 3 to 5 PNGs at 1280×800 OR 640×400. Pick one resolution and stay consistent. Suggested shots:
  1. Side panel showing a captured request being mutated into a 500
  2. DevTools panel with a scenario loaded
  3. The scenario library tab with 2-3 example scenarios
  4. A `.moxy.json` file open next to the panel that just loaded it
  5. The ON/OFF pill demonstrating the global kill switch
- **Detailed description** — up to 16,000 chars of HTML for the listing body. Drafted in `listing-copy.md` alongside every permission justification and field copy.
- **Privacy policy URL** — point to `https://github.com/raegen/moxy/blob/main/PRIVACY.md` until there's a project website.
- **Category** — Developer Tools.

### Optional but worth doing
- **Promo tile** — 440×280 PNG for featured placement (Chrome ranks listings with promo tiles higher).
- **Marquee tile** — 1400×560 PNG, only used if Chrome staff feature the extension.
- **Listing copy** — `listing-copy.md` with the description + feature list + FAQ for the store body.

## Submission checklist

- [ ] Pay one-time `$5` developer registration fee (chrome.google.com/webstore/devconsole)
- [ ] Bump `manifest.json` and `package.json` to the version being submitted
- [ ] `bun run build:icons && bun run build` — fresh dist/
- [ ] `cd dist && zip -r ../moxy-vX.Y.Z.zip .` — submission package
- [ ] Upload zip + screenshots + 128 icon to the dev console
- [ ] Fill in description, category, language
- [ ] Provide privacy policy URL
- [ ] Justify each permission in the "Single Purpose" + "Justification" fields:
  - `<all_urls>` host permission: "to inject the fetch/XHR interceptor into pages the user is developing"
  - `scripting`: "to register the MAIN-world content script that wraps window.fetch"
  - `storage`: "to persist scenarios and capture history locally"
  - `tabs`: "to scope rules per-tab and clean up state when tabs close"
  - `sidePanel`: "to render the moxy side panel UI"
- [ ] Submit for review (typical review time: 1-3 days for new extensions)
