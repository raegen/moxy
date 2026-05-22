// DevTools launcher. Registers the "moxy" panel in the DevTools window. The
// launcher page itself has no UI — it lives in DevTools' hidden context purely
// to call chrome.devtools.panels.create. The actual panel renders from
// src/devtools/panel/index.html.

chrome.devtools.panels.create(
  'moxy',
  'icons/moxy-24.png',
  'src/devtools/panel/index.html',
  (panel) => {
    void panel;
  }
);
