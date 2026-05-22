#!/usr/bin/env node
//
// Rasterize icons/moxy.svg to PNGs at the sizes Chrome + the Chrome Web Store
// expect. SVG is the source of truth; the PNGs are committed artifacts so
// fresh clones load the extension without running this script.
//
// To regenerate after editing the SVG: `bun run build:icons`.

import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const svgPath = path.join(repoRoot, 'icons/moxy.svg');
const iconsDir = path.join(repoRoot, 'icons');
const storeDir = path.join(repoRoot, 'store-assets');

const svg = fs.readFileSync(svgPath);

// Extension action + manifest icons.
// 16: toolbar button, also in chrome://extensions
// 32: high-DPI variant of 16 (Chrome picks this on retina)
// 48: extensions page main display
// 128: install dialog, Web Store listing
const extensionSizes = [16, 32, 48, 128];
for (const size of extensionSizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
  });
  const png = resvg.render().asPng();
  const out = path.join(iconsDir, `moxy-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`[icons] ${path.relative(repoRoot, out)} (${png.length} bytes)`);
}

// Store assets — 128x128 store icon (often same source as action), plus a
// large 1024x1024 for promotional materials / future website / @2x retina.
fs.mkdirSync(storeDir, { recursive: true });
for (const size of [128, 1024]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
  });
  const png = resvg.render().asPng();
  const out = path.join(storeDir, `icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`[icons] ${path.relative(repoRoot, out)} (${png.length} bytes)`);
}
