import { build, defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

// MAIN-world content scripts are injected via chrome.scripting as classic
// scripts (no ESM). The rest of the extension (panel, SW, ISOLATED bridge)
// uses code-split ESM via CRXJS — and Rollup refuses to mix IIFE with
// code-split builds. So we build patch.ts as a self-contained IIFE via
// Vite lib mode in a second pass triggered by closeBundle.
function buildPatchAsIife(): Plugin {
  let didRun = false;
  return {
    name: 'moxy:patch-iife',
    apply: 'build',
    async closeBundle() {
      if (didRun) return; // closeBundle can fire multiple times
      didRun = true;
      await build({
        configFile: false, // critical: prevent re-loading this config (would recurse)
        logLevel: 'warn',
        build: {
          emptyOutDir: false,
          target: 'es2022',
          lib: {
            entry: 'src/inject/patch.ts',
            formats: ['iife'],
            name: 'moxyPatch',
            fileName: () => 'patch.js',
          },
          outDir: 'dist',
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [preact(), crx({ manifest: manifest as never }), buildPatchAsIife()],
  build: {
    target: 'es2022',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
