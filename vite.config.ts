import { build, defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

// Both injected scripts (MAIN-world patch + ISOLATED-world bridge) are
// loaded via chrome.scripting.{registerContentScripts,executeScript} as
// classic scripts (no ESM). The rest of the extension (panel, SW) uses
// code-split ESM via CRXJS — and Rollup refuses to mix IIFE with code-
// split builds. So we build patch.ts AND bridge.ts as self-contained
// IIFEs via Vite lib mode in a second pass triggered by closeBundle.
//
// As of v1.3, the bridge is no longer declared in manifest.content_scripts
// (we removed that with the optional_host_permissions migration). It's
// registered programmatically alongside the patch in sw.ts, so it must
// exist in dist/ as a self-contained classic script.
function buildInjectedScriptsAsIife(): Plugin {
  let didRun = false;
  const entries: Array<{ entry: string; name: string; fileName: string }> = [
    { entry: 'src/inject/patch.ts', name: 'moxyPatch', fileName: 'patch.js' },
    { entry: 'src/inject/bridge.ts', name: 'moxyBridge', fileName: 'bridge.js' },
  ];
  return {
    name: 'moxy:injected-iife',
    apply: 'build',
    async closeBundle() {
      if (didRun) return; // closeBundle can fire multiple times
      didRun = true;
      for (const { entry, name, fileName } of entries) {
        await build({
          configFile: false, // critical: prevent re-loading this config (would recurse)
          logLevel: 'warn',
          build: {
            emptyOutDir: false,
            target: 'es2022',
            lib: {
              entry,
              formats: ['iife'],
              name,
              fileName: () => fileName,
            },
            outDir: 'dist',
          },
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [preact(), crx({ manifest: manifest as never }), buildInjectedScriptsAsIife()],
  build: {
    target: 'es2022',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // CRXJS discovers HTML entries via manifest fields (default_popup,
        // side_panel.default_path, devtools_page). The DevTools panel itself
        // is referenced as a string argument to chrome.devtools.panels.create
        // at runtime, which static analysis can't see. List it explicitly so
        // Rollup emits the HTML + its bundled JS into dist/.
        devtoolsPanel: 'src/devtools/panel/index.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
