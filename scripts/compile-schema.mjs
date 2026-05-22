#!/usr/bin/env node
//
// Compile schema/v1.json into a precompiled, MV3-CSP-safe validator module.
//
// Why precompile: ajv's default `ajv.compile(schema)` uses `new Function(...)`
// to build the validator. MV3 extension pages forbid `unsafe-eval`, so any
// runtime ajv.compile() call would crash with `Refused to evaluate a string
// as JavaScript`. ajv's `standaloneCode` emits a self-contained ES module
// containing the compiled validator as ordinary functions — no `new Function`,
// no `eval`. Safe to ship in the panel bundle.
//
// Output: src/shared/generated/validate-v1.mjs (committed to git so tests
// don't need to compile first, and so dependents can read it).

import Ajv from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(repoRoot, 'schema/v1.json');
const outDir = path.join(repoRoot, 'src/shared/generated');
const outPath = path.join(outDir, 'validate-v1.mjs');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

// `code.source: true` enables the standalone code generator.
// `allErrors: true` collects every violation, not just the first.
// `strict: false` allows JSON Schema features outside ajv's strict subset
// (default true emits warnings for `description`, `default`, etc).
const ajv = new Ajv.default({
  code: { source: true, esm: true, lines: true },
  allErrors: true,
  strict: false,
});
const validate = ajv.compile(schema);

let code = standaloneCode.default(ajv, validate);

// standaloneCode emits CommonJS-style `module.exports = ...` by default. With
// `esm: true` it should emit `export default`, but some ajv versions still
// emit a hybrid. Normalize: if we see `module.exports`, rewrite to ESM.
if (/^module\.exports\s*=/m.test(code) && !/^export default/m.test(code)) {
  code = code.replace(/module\.exports\s*=\s*([^;]+);?/, 'export default $1;');
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, code, 'utf-8');

console.log(`[moxy] compiled schema → ${path.relative(repoRoot, outPath)} (${code.length} bytes)`);
