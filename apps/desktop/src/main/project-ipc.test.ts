import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { registerProjectIpc } from './project-ipc';
import { APP_URL } from './security';
import { DESKTOP_CHANNELS } from '../shared/bridge';
import type { MediaRegistry } from './media';
import type { DesktopServiceHost } from './service-host';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  choose: vi.fn(),
  project: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/test-only-unused' },
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, request: unknown) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  dialog: { showOpenDialog: mocks.choose, showSaveDialog: mocks.choose },
}));
describe('project resource authorization', () => {
  const frame = { url: APP_URL };
  const sender = {
    sender: { id: 7, mainFrame: frame },
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.choose.mockReset();
    mocks.project.mockReset();
    registerProjectIpc({
      window: { isDestroyed: () => false, webContents: { id: 7 } } as unknown as BrowserWindow,
      rendererUrl: APP_URL,
      media: { getPath: () => null } as unknown as MediaRegistry,
      service: { project: mocks.project } as unknown as DesktopServiceHost,
    });
  });
  it('rejects subframes, other windows, and renderer-controlled paths before dialogs or IO', async () => {
    const invoke = mocks.handlers.get(DESKTOP_CHANNELS.project)!;
    for (const source of [
      { ...sender, senderFrame: { url: APP_URL } },
      { ...sender, sender: { ...sender.sender, id: 99 } },
    ])
      expect(await invoke(source as IpcMainInvokeEvent, { action: 'open' })).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    expect(await invoke(sender, { action: 'open', path: 'C:/private' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it('rejects projects and media that were never authorized in this window', async () => {
    const invoke = mocks.handlers.get(DESKTOP_CHANNELS.project)!;
    expect(
      await invoke(sender, { action: 'undo', projectId: 'foreign-project', baseRevision: 0 }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await invoke(sender, { action: 'create', mediaId: 'foreign-media' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });
});
