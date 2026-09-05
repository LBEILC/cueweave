import { dialog, ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import { testProviderConnection } from '@cueweave/core/provider/chatCompletions';
import { ProviderError } from '@cueweave/core/provider/types';
import { DESKTOP_CHANNELS, desktopError } from '../shared/bridge';
import { isSettingsCommand } from '../shared/settings';
import { isTrustedSender } from './security';
import type { SettingsStore } from './settings-store';

export function registerSettingsIpc(options: {
  window: BrowserWindow;
  rendererUrl: string;
  store: SettingsStore;
  loadError?: string | undefined;
}) {
  const { window, store } = options;
  let testing: AbortController | undefined;
  let saving = false;
  let dirty = false;
  ipcMain.handle(DESKTOP_CHANNELS.settings, async (event, command: unknown) => {
    if (
      window.isDestroyed() ||
      !isTrustedSender(
        {
          windowId: event.sender.id,
          frameUrl: event.senderFrame?.url ?? '',
          isMainFrame: event.senderFrame === event.sender.mainFrame,
        },
        { windowId: window.webContents.id, rendererUrl: options.rendererUrl },
      )
    )
      return desktopError('FORBIDDEN');
    if (!isSettingsCommand(command)) return desktopError('INVALID_REQUEST');
    try {
      if (command.action === 'draft') {
        dirty = command.dirty;
        return { ok: true, value: { settings: store.snapshot() } };
      }
      if (options.loadError) throw new Error(options.loadError);
      if (command.action === 'read') return { ok: true, value: { settings: store.snapshot() } };
      if (command.action === 'cancel-test') {
        testing?.abort();
        return { ok: true, value: { settings: store.snapshot() } };
      }
      if (command.action === 'test') {
        if (testing || saving) throw new Error('上一个操作仍在进行，请稍候。');
        const settings = store.snapshot();
        if (!settings.provider.baseUrl || !settings.provider.model)
          throw new Error('请先填写并保存服务地址和模型。');
        const apiKey = store.key();
        if (!apiKey) throw new Error('请先填写并保存 API Key。');
        const controller = new AbortController();
        testing = controller;
        const timeout = AbortSignal.timeout(20_000);
        const safeFetch: typeof fetch = async (input, init) => {
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          );
          if (url.origin !== new URL(settings.provider.baseUrl).origin)
            throw new Error('Unexpected origin');
          const response = await fetch(input, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.any([
              controller.signal,
              timeout,
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
          // Limit diagnostics even when a misconfigured endpoint returns an enormous document.
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            if (reader)
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 1024 * 1024)
                  throw new ProviderError('invalid-response', 'Response too large');
                chunks.push(value);
              }
          } finally {
            await reader?.cancel().catch(() => {});
          }
          return new Response(bytes ? Buffer.concat(chunks) : null, {
            status: response.status,
            headers: response.headers,
          });
        };
        try {
          await testProviderConnection({ ...settings.provider, apiKey }, { fetch: safeFetch });
          return {
            ok: true,
            value: { settings: store.snapshot(), message: '连接成功，模型已返回有效响应。' },
          };
        } catch (error) {
          if (controller.signal.aborted) throw new Error('连接测试已取消。');
          if (timeout.aborted) throw new Error('连接测试超时，请检查地址或稍后重试。');
          const messages: Record<string, string> = {
            authentication: '认证失败，请检查 API Key。',
            'model-not-found': '模型不可用，请检查模型名称和访问权限。',
            'rate-limited': '服务限流或额度不足，请稍后重试或检查账户额度。',
            'invalid-response': '服务未返回有效模型响应，请检查接口协议和服务地址。',
          };
          throw new Error(
            error instanceof ProviderError
              ? (messages[error.code] ?? '无法连接模型服务，请检查网络、地址和接口协议。')
              : '无法连接模型服务，请检查网络、地址和接口协议。',
          );
        } finally {
          if (testing === controller) testing = undefined;
        }
      }
      if (saving || testing) throw new Error('上一个操作仍在进行，请稍候。');
      saving = true;
      try {
        const settings = await store.update(
          command.action === 'theme' ? { theme: command.theme } : command,
        );
        nativeTheme.themeSource = settings.theme;
        return { ok: true, value: { settings } };
      } finally {
        saving = false;
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'SETTINGS_ERROR',
          message: error instanceof Error ? error.message : '设置操作未完成，请重试。',
        },
      };
    }
  });
  const dispose = () => {
    testing?.abort();
    ipcMain.removeHandler(DESKTOP_CHANNELS.settings);
  };
  dispose.beforeClose = async () => {
    if (saving) return false;
    if (!dirty) return true;
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: '设置尚未保存',
      message: '返回设置保存，或放弃修改并退出。',
      buttons: ['返回设置', '放弃修改并退出'],
      defaultId: 0,
      cancelId: 0,
    });
    return answer.response === 1;
  };
  return dispose;
}
