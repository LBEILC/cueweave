import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(root, '.fixtures/desktop/translation-storage-check.cjs');
await mkdir(resolve(root, '.fixtures/desktop'), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./translation-storage-check.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3'],
});
const require = createRequire(import.meta.url);
const result = await promisify(execFile)(require('electron'), [output], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
