import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { MediaRegistry } from './media';
import type { DesktopServiceHost } from './service-host';
import type { SiteAuthManager } from './site-auth';
import { registerAppIpc } from './ipc';
import { APP_URL } from './security';
import { DESKTOP_CHANNELS } from '../shared/bridge';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  openPath: vi.fn(),
  showOpenDialog: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, request: unknown) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  shell: { openPath: mocks.openPath },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));

describe('fixed desktop IPC', () => {
  const frame = { url: APP_URL };
  const source = {
    sender: { id: 7, mainFrame: frame },
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  let dispose: () => void;
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.openPath.mockReset();
    mocks.showOpenDialog.mockReset();
    dispose = registerAppIpc({
      window: { isDestroyed: () => false, webContents: { id: 7 } } as unknown as BrowserWindow,
      rendererUrl: APP_URL,
      appInfo: { name: 'CueWeave', version: 'test-version' },
      fontLicensePath: '/bundled/fonts/MiSans-LICENSE.pdf',
      media: {
        register: vi.fn(),
        getPath: vi.fn(),
        getPlayableSource: vi.fn((id: string) =>
          id === 'registered-asset' ? 'C:\\media\\sample.mp4' : null,
        ),
      } as unknown as MediaRegistry,
      service: { probeMedia: vi.fn() } as unknown as DesktopServiceHost,
      auth: {
        withCookieFile: vi.fn(
          (_url: string, _enabled: boolean, operation: (path?: string) => Promise<unknown>) =>
            operation(),
        ),
        status: vi.fn(async (site: string) => ({ site, signedIn: false })),
        open: vi.fn(async (site: string) => ({ site, signedIn: true })),
        clear: vi.fn(async (site: string) => ({ site, signedIn: false })),
      } as unknown as SiteAuthManager,
    });
  });

  it('returns only public app info', async () => {
    expect(await mocks.handlers.get(DESKTOP_CHANNELS.appInfo)!(source, {})).toEqual({
      ok: true,
      value: { name: 'CueWeave', version: 'test-version' },
    });
  });

  it('rejects malformed or path-bearing requests before performing actions', async () => {
    for (const request of [
      undefined,
      null,
      1,
      'path',
      [],
      new Date(),
      { path: '/private' },
      { channel: 'other' },
    ]) {
      const result = await mocks.handlers.get(DESKTOP_CHANNELS.fontLicense)!(source, request);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it('rejects another window and a subframe with the same URL', async () => {
    for (const event of [
      { ...source, sender: { ...source.sender, id: 9 } },
      { ...source, senderFrame: { url: APP_URL } },
      { ...source, senderFrame: null },
    ]) {
      expect(
        await mocks.handlers.get(DESKTOP_CHANNELS.fontLicense)!(event as IpcMainInvokeEvent, {}),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it('opens only the bundled license and sanitizes internal failures', async () => {
    mocks.openPath.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('/private/secret'));
    expect(await mocks.handlers.get(DESKTOP_CHANNELS.fontLicense)!(source, {})).toEqual({
      ok: true,
      value: null,
    });
    expect(mocks.openPath).toHaveBeenCalledWith('/bundled/fonts/MiSans-LICENSE.pdf');
    const failure = await mocks.handlers.get(DESKTOP_CHANNELS.fontLicense)!(source, {});
    expect(failure).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(JSON.stringify(failure)).not.toContain('/private/secret');
  });

  it('does not expose a selected subtitle path when reading fails', async () => {
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\private\\captions\\episode.srt'],
    });

    const result = await mocks.handlers.get(DESKTOP_CHANNELS.playerSubtitlePick)!(source, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('C:\\private');
  });

  it('accepts only explicit app login modes', async () => {
    for (const request of [
      { url: 'https://www.youtube.com/watch?v=test' },
      { url: 'https://www.youtube.com/watch?v=test', authMode: 'edge' },
      { url: 'https://www.youtube.com/watch?v=test', authMode: 'none', extra: true },
    ]) {
      const result = await mocks.handlers.get(DESKTOP_CHANNELS.linkInspect)!(source, request);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
  });

  it('accepts only supported sites for login management', async () => {
    for (const request of [{}, { site: 'vimeo' }, { site: 'youtube', extra: true }]) {
      const result = await mocks.handlers.get(DESKTOP_CHANNELS.siteLoginStatus)!(source, request);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(
      await mocks.handlers.get(DESKTOP_CHANNELS.siteLoginStatus)!(source, { site: 'bilibili' }),
    ).toEqual({ ok: true, value: { site: 'bilibili', signedIn: false } });
  });

  it('does not accept an online subtitle id that was not issued by inspection', async () => {
    const result = await mocks.handlers.get(DESKTOP_CHANNELS.onlineSubtitleLoad)!(source, {
      id: 'untrusted-track',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('removes handlers when the window closes', () => {
    dispose();
    expect(mocks.handlers.size).toBe(0);
  });
});
