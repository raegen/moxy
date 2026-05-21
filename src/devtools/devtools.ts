// DevTools launcher. Registers the "moxy" panel in the DevTools window. The
// launcher page itself has no UI — it lives in DevTools' hidden context purely
// to call chrome.devtools.panels.create. The actual panel renders from
// src/devtools/panel/index.html.

chrome.devtools.panels.create(
  'moxy',
  // icon path — Chrome supports 24x24 PNG; using the existing extension icon
  // for v1.1b. A purpose-built icon can land later without a manifest bump.
  'hello_extensions.png',
  'src/devtools/panel/index.html',
  (panel) => {
    void panel;
  }
);
