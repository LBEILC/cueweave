// Acceptance-only upstream fixture. The production IPC, settings, scheduler and core run unchanged.
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { registerAppIpc } from '../src/main/ipc';
import { registerSettingsIpc } from '../src/main/settings-ipc';
import { SettingsStore } from '../src/main/settings-store';
import { OnlineTranslator } from '../src/main/online-translator';
import type { MediaRegistry } from '../src/main/media';
import type { DesktopServiceHost } from '../src/main/service-host';
import type { SiteAuthManager } from '../src/main/site-auth';
import { parseSubtitleTracks } from '../src/services/link';
export async function install(videoUrl: string, content: string) {
  const window = BrowserWindow.getAllWindows()[0]!;
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (s) => safeStorage.encryptString(s),
    decryptString: (s) => safeStorage.decryptString(s),
  });
  await settings.load();
  for (const channel of [
    'app:info',
    'app:font-license',
    'media:pick',
    'media:drop',
    'media:probe',
    'link:inspect',
    'link:import-start',
    'link:import-cancel',
    'subtitle:online-load',
    'subtitle:online-translation',
    'player:subtitle-pick',
    'site-login:open',
    'site-login:status',
    'site-login:clear',
    'settings:command',
  ])
    ipcMain.removeHandler(`cueweave:${channel}`);
  const rendererUrl = window.webContents.getURL();
  registerSettingsIpc({ window, rendererUrl, store: settings });
  registerAppIpc({
    window,
    rendererUrl,
    appInfo: { name: '句织', version: 'acceptance' },
    fontLicensePath: '',
    settings,
    translator: new OnlineTranslator(join(app.getPath('userData'), 'online-translation-cache')),
    media: {
      registerRemoteVariants: () =>
        ['1080', '720'].map((id) => ({
          id,
          label: `${id}p · H.264`,
          videoCodec: 'h264',
          videoUrl: videoUrl + (id === '720' ? '?quality=720' : ''),
        })),
    } as unknown as MediaRegistry,
    auth: {
      withCookieFile: (_url: string, _enabled: boolean, operation: () => Promise<unknown>) =>
        operation(),
    } as unknown as SiteAuthManager,
    service: {
      inspectLink: async (url: string) => ({
        kind: 'website',
        url,
        title: url.includes('second') ? '另一段英语视频' : '英语访谈 · 跟播验收',
        source: 'YouTube',
        durationSeconds: 3,
        resolvedVariants: [{}],
        resolvedSubtitles: parseSubtitleTracks({
          language: 'en',
          subtitles: {
            en: [{ name: 'English', url: 'https://www.youtube.com/api/timedtext?lang=en' }],
          },
          automatic_captions: {
            'en-orig': [{ name: 'English', url: 'https://www.youtube.com/api/timedtext?lang=en' }],
            fr: [{ name: 'French', url: 'https://www.youtube.com/api/timedtext?lang=en&tlang=fr' }],
          },
        }),
      }),
      fetchSubtitle: async () => ({ name: 'English（自动）', content }),
    } as unknown as DesktopServiceHost,
  });
}
