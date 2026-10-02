// Bundle one src module with esbuild (as the build does) so the unit tests can import its exports in Node.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
export async function load(rel) {
  const r = await build({ entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', external: ['@muclient/sdk'] });
  const dir = join(ROOT, 'node_modules', '.cache', 'ext-help-test');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${rel.replace(/\W+/g, '_')}-${process.pid}-${++n}.mjs`);
  writeFileSync(out, r.outputFiles[0].contents);
  return import(pathToFileURL(out).href);
}
