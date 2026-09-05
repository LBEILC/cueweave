import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { registerSettingsIpc } from './settings-ipc';
import type { SettingsStore } from './settings-store';
import { DESKTOP_CHANNELS } from '../shared/bridge';
import { APP_URL } from './security';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, command: unknown) => Promise<unknown>>(),
  fetch: vi.fn(),
  key: vi.fn(),
  update: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: IpcMainInvokeEvent, command: unknown) => Promise<unknown>,
    ) => mocks.handlers.set(channel, fn),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  nativeTheme: { themeSource: 'system' },
  dialog: { showMessageBox: mocks.dialog },
}));
const snapshot = {
  theme: 'system',
  provider: { baseUrl: 'https://example.test/v1', model: 'model', protocol: 'chat-completions' },
  keyStatus: 'saved',
  encryptionAvailable: true,
};
const frame = { url: APP_URL };
const event = {
  sender: { id: 7, mainFrame: frame },
  senderFrame: frame,
} as unknown as IpcMainInvokeEvent;
function invoke(command: unknown, source = event) {
  return mocks.handlers.get(DESKTOP_CHANNELS.settings)!(source, command);
}
let dispose: ReturnType<typeof registerSettingsIpc>;
beforeEach(() => {
  mocks.handlers.clear();
  mocks.fetch.mockReset();
  mocks.key.mockReset().mockReturnValue('fixture-secret');
  mocks.update.mockReset().mockResolvedValue(snapshot);
  mocks.dialog.mockReset().mockResolvedValue({ response: 0 });
  vi.stubGlobal('fetch', mocks.fetch);
  dispose = registerSettingsIpc({
    window: { isDestroyed: () => false, webContents: { id: 7 } } as unknown as BrowserWindow,
    rendererUrl: APP_URL,
    store: {
      snapshot: () => snapshot,
      key: mocks.key,
      update: mocks.update,
    } as unknown as SettingsStore,
  });
});
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});
describe('desktop settings IPC', () => {
  it('rejects untrusted frames before reading credentials or invoking requests', async () => {
    expect(
      await invoke({ action: 'test' }, {
        ...event,
        senderFrame: { url: APP_URL },
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await invoke({ action: 'read', path: '/private' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('uses the saved origin and disallows redirects', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'READY' } }] })),
    );
    expect(await invoke({ action: 'test' })).toMatchObject({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'Bearer fixture-secret' }),
      }),
    );
  });
  it('does not echo server error content or credentials', async () => {
    mocks.fetch.mockResolvedValue(new Response('fixture-secret', { status: 401 }));
    const reply = await invoke({ action: 'test' });
    expect(reply).toMatchObject({ ok: false, error: { message: '认证失败，请检查 API Key。' } });
    expect(JSON.stringify(reply)).not.toContain('fixture-secret');
  });
  it('limits response size', async () => {
    mocks.fetch.mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
    expect(await invoke({ action: 'test' })).toMatchObject({
      ok: false,
      error: { message: '服务未返回有效模型响应，请检查接口协议和服务地址。' },
    });
  });
  it('cancels in-flight tests and rejects overlapping saves', async () => {
    mocks.fetch.mockImplementation(
      (_input, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const testing = invoke({ action: 'test' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(await invoke({ action: 'theme', theme: 'dark' })).toMatchObject({ ok: false });
    await invoke({ action: 'cancel-test' });
    expect(await testing).toMatchObject({ ok: false, error: { message: '连接测试已取消。' } });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('protects unsaved drafts on window close', async () => {
    await invoke({ action: 'draft', dirty: true });
    expect(await dispose.beforeClose()).toBe(false);
    mocks.dialog.mockResolvedValueOnce({ response: 1 });
    expect(await dispose.beforeClose()).toBe(true);
    await invoke({ action: 'draft', dirty: false });
    expect(await dispose.beforeClose()).toBe(true);
  });
});
