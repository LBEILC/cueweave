import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(join(desktopDirectory, 'package.json'), 'utf8'));
const installer = join(desktopDirectory, `dist/package/CueWeave-${manifest.version}-x64.exe`);
const installRoot = join(desktopDirectory, '../../.impeccable/review/desktop-d0/installed');
await mkdir(installRoot, { recursive: true });

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, { windowsHide: true, stdio: 'inherit', ...options });
  const code = await new Promise((resolveCode, reject) => {
    child.once('error', reject);
    child.once('exit', resolveCode);
  });
  assert.equal(code, 0, `${executable} exited with ${code}`);
}

await stat(installer);
await run(installer, ['/S', `/D=${installRoot}`]);
const installedExecutable = join(installRoot, 'CueWeave.exe');
await stat(installedExecutable);
await run(process.execPath, [join(desktopDirectory, 'scripts/d0-acceptance.mjs')], {
  env: {
    ...process.env,
    CUEWEAVE_D0_EXECUTABLE: installedExecutable,
    CUEWEAVE_D0_EVIDENCE: 'installer-acceptance.json',
  },
});
const uninstaller = join(installRoot, 'Uninstall CueWeave.exe');
await stat(uninstaller);
await run(uninstaller, ['/S']);
let removed = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    await stat(installedExecutable);
  } catch {
    removed = true;
    break;
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}
assert.equal(removed, true, 'Uninstaller left the installed executable behind');
process.stdout.write(
  'Installer acceptance passed: silent install, packaged D0 checks, and uninstall.\n',
);
