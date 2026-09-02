import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    build: {
      modulePreload: false,
    },
  }),
  manifest: {
    name: 'CueWeave - 句织',
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
    },
  },
});
