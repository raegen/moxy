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
import addFormats from 'ajv-formats';
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

// ajv-formats supplies the implementations for `format` keywords in the schema
// (we use date-time on createdAt). Without it ajv accepts any string and emits
// `unknown format "date-time" ignored` — the schema would silently fail to
// enforce the format it advertises.
addFormats.default(ajv, { mode: 'fast', formats: ['date-time'] });

const validate = ajv.compile(schema);

let code = standaloneCode.default(ajv, validate);

// standaloneCode emits CommonJS-style `module.exports = ...` by default. With
// `esm: true` it should emit `export default`, but some ajv versions still
// emit a hybrid. Normalize: if we see `module.exports`, rewrite to ESM.
if (/^module\.exports\s*=/m.test(code) && !/^export default/m.test(code)) {
  code = code.replace(/module\.exports\s*=\s*([^;]+);?/, 'export default $1;');
}

// `esm: true` doesn't convert ajv's runtime-helper `require()` calls — only the
// module's export form. Helpers like `ucs2length` (used by minLength/maxLength
// on strings, handles surrogate pairs) and `ajv-formats`'s format regexes are
// emitted as `const x = require("...").default` lines. In an MV3 panel /
// service-worker context `require` is undefined, so the bundle crashes on
// first use ("ReferenceError: require is not defined"). Convert to real ESM
// imports so Vite/Rollup can inline the helpers during the panel bundle.
const requireImports = new Set();
code = code.replace(
  /const\s+(\w+)\s*=\s*require\("([^"]+)"\)\.default\s*;?/g,
  (_m, name, modPath) => {
    requireImports.add(`import ${name} from "${modPath}";`);
    return '';
  }
);
code = code.replace(
  /const\s+(\w+)\s*=\s*require\("([^"]+)"\)\.(\w+)([^\n;]*);?/g,
  (_m, name, modPath, exportName, tail) => {
    // `const L = require("ajv-formats/dist/formats").fastFormats["date-time"]`
    // → import { fastFormats } from "ajv-formats/dist/formats"; const L = fastFormats["date-time"];
    requireImports.add(`import { ${exportName} } from "${modPath}";`);
    return `const ${name} = ${exportName}${tail};`;
  }
);

// Bail if any unrewritten require() survives — would crash at runtime, better
// to fail the build than to ship a broken validator.
if (/\brequire\s*\(/.test(code)) {
  console.error('[moxy] ERROR: unrewritten require() call found in standalone validator:');
  console.error(code.match(/[^\n]*\brequire\s*\([^\n]*/g)?.join('\n'));
  process.exit(1);
}

code = [...requireImports].join('\n') + '\n' + code;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, code, 'utf-8');

console.log(`[moxy] compiled schema → ${path.relative(repoRoot, outPath)} (${code.length} bytes)`);
