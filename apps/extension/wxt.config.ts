import { defineConfig } from 'wxt';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = fileURLToPath(new URL('./', import.meta.url));
const workspaceRoot = resolve(extensionRoot, '../..');

function buildFingerprint(): string {
  const hash = createHash('sha256');
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (!entry.name.includes('.test.'))
        hash.update(relative(workspaceRoot, path).replaceAll('\\', '/')).update(readFileSync(path));
    }
  };
  for (const directory of ['src', 'entrypoints']) scan(join(extensionRoot, directory));
  scan(join(workspaceRoot, 'packages/core/src'));
  for (const path of ['package.json', 'wxt.config.ts'])
    hash.update(readFileSync(join(extensionRoot, path)));
  hash.update(readFileSync(join(workspaceRoot, 'package-lock.json')));
  return hash.digest('hex').slice(0, 16);
}

export default defineConfig({
  // Keep the unpacked extension path stable when the source workspace moves.
  outDir: '../../.output',
  zip: { name: 'cueweave' },
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    define: { 'import.meta.env.CUEWEAVE_BUILD_ID': JSON.stringify(buildFingerprint()) },
    build: {
      modulePreload: false,
    },
  }),
  manifest: {
    name: 'CueWeave - 句织',
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    description: '把碎片字幕编织成完整语义。',
    permissions: ['activeTab', 'storage'],
    host_permissions: ['*://www.youtube.com/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    web_accessible_resources: [
      {
        resources: ['fonts/*.woff2'],
        matches: ['*://www.youtube.com/*'],
      },
    ],
    action: {
      default_title: 'CueWeave',
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
      },
    },
  },
});
