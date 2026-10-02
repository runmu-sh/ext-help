#!/usr/bin/env node
/**
 * Build src/index.ts into dist/index.js the way μClient bundles extensions: ESM, es2022, `vue`, `@muclient/sdk` and `@muclient/ui` external (the host's import
 * map supplies them), everything else bundled. Then check the `muclient` manifest with the host's rules.
 *
 *   node scripts/build.mjs            build + check
 *   node scripts/build.mjs --check    check the manifest only
 *   node scripts/build.mjs --sourcemap
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EXTERNAL = ['vue', '@muclient/sdk', '@muclient/ui'];
const args = new Set(process.argv.slice(2));

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let m;
try { m = validateManifest(pkg); } catch (e) { console.error(`package.json: ${e.message}`); process.exit(1); }

if (!args.has('--check')) {
  const { build } = await import('esbuild');
  const t0 = Date.now();
  const r = await build({
    entryPoints: [join(ROOT, m.source)], bundle: true, format: 'esm', target: 'es2022', write: false,
    external: EXTERNAL, legalComments: 'none', sourcemap: args.has('--sourcemap') ? 'inline' : false,
    logLevel: 'warning', absWorkingDir: ROOT,
  });
  const out = join(ROOT, m.entry);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, r.outputFiles[0].contents);
  console.log(`built ${m.entry} (${r.outputFiles[0].contents.length} bytes, ${Date.now() - t0} ms)`);
}
for (const [p, h] of Object.entries(m.wasm ?? {})) {
  if (!existsSync(join(ROOT, p))) console.warn(`note: ${p} is listed in muclient.wasm but not built yet (npm run build:wasm)`);
  else if (!h) console.warn(`note: ${p} has no sha256 in muclient.wasm; npm run build:wasm pins it`);
}
console.log(`manifest ok: ${m.id} ${m.version} (api ${m.api})`);
