import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'CueWeave - 句织',
    description: '把碎片字幕编织成完整语义。',
    permissions: ['activeTab', 'storage'],
    host_permissions: ['*://www.youtube.com/*'],
    action: {
      default_title: 'CueWeave',
    },
  },
});
