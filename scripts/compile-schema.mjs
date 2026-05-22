#!/usr/bin/env node
//
// Compile schema/v1.json into a precompiled, MV3-CSP-safe validator module.
//
// Pipeline:
//   1. ajv compiles the schema to a JS validator function
//   2. ajv.standaloneCode emits a hybrid module — ESM exports, but the runtime
//      helpers (ucs2length, ajv-formats date-time regex) come in via require()
//   3. esbuild bundles that hybrid into a single pure-ESM file, resolving every
//      require()/import statically and inlining what's actually used
//
// Output: src/shared/generated/validate-v1.mjs — pure ESM, zero require(),
// zero external imports at runtime, MV3-CSP-safe (no new Function, no eval).

import Ajv from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(repoRoot, 'schema/v1.json');
const outDir = path.join(repoRoot, 'src/shared/generated');
const outPath = path.join(outDir, 'validate-v1.mjs');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv.default({
  code: { source: true, esm: true, lines: true },
  allErrors: true,
  strict: false,
});
addFormats.default(ajv, { mode: 'fast', formats: ['date-time'] });

const validate = ajv.compile(schema);
const rawCode = standaloneCode.default(ajv, validate);

// Bundle the hybrid through esbuild. Treat stdin as JS, resolve from the
// repo root so `ajv/...` and `ajv-formats/...` resolve via node_modules.
const result = await esbuild.build({
  stdin: {
    contents: rawCode,
    loader: 'js',
    resolveDir: repoRoot,
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  legalComments: 'none',
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, result.outputFiles[0].text);

console.log(`[moxy] compiled schema → ${path.relative(repoRoot, outPath)} (${result.outputFiles[0].text.length} bytes)`);
