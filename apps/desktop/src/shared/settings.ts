export type ThemePreference = 'system' | 'light' | 'dark';
export type ApiProtocol = 'auto' | 'chat-completions' | 'responses';
export interface ProviderConfig {
  baseUrl: string;
  model: string;
  protocol: ApiProtocol;
}
export interface SettingsSnapshot {
  theme: ThemePreference;
  provider: ProviderConfig;
  keyStatus: 'missing' | 'saved' | 'session' | 'unavailable';
  encryptionAvailable: boolean;
}
export type SettingsCommand =
  | { action: 'draft'; dirty: boolean }
  | { action: 'read' }
  | { action: 'theme'; theme: ThemePreference }
  | { action: 'save'; provider: ProviderConfig; key?: string; removeKey?: boolean }
  | { action: 'test' }
  | { action: 'cancel-test' };
export interface SettingsReply {
  settings: SettingsSnapshot;
  message?: string;
}

export function validProvider(value: unknown): value is ProviderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    Object.keys(p).length === 3 &&
    typeof p.baseUrl === 'string' &&
    p.baseUrl.length <= 2048 &&
    typeof p.model === 'string' &&
    p.model.length <= 200 &&
    !/[\r\n]/u.test(p.model) &&
    !p.model.includes(String.fromCharCode(0)) &&
    ['auto', 'chat-completions', 'responses'].includes(p.protocol as string)
  );
}
export function isSettingsCommand(value: unknown): value is SettingsCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const keys = Object.keys(c);
  if (c.action === 'draft') return keys.length === 2 && typeof c.dirty === 'boolean';
  if (['read', 'test', 'cancel-test'].includes(c.action as string)) return keys.length === 1;
  if (c.action === 'theme')
    return keys.length === 2 && ['system', 'light', 'dark'].includes(c.theme as string);
  return (
    c.action === 'save' &&
    keys.every((k) => ['action', 'provider', 'key', 'removeKey'].includes(k)) &&
    validProvider(c.provider) &&
    (c.key === undefined ||
      (typeof c.key === 'string' &&
        c.key.length <= 8192 &&
        !/[\r\n]/u.test(c.key) &&
        !c.key.includes(String.fromCharCode(0)))) &&
    (c.removeKey === undefined || typeof c.removeKey === 'boolean') &&
    !(c.removeKey && c.key)
  );
}

export function normalizeProvider(provider: ProviderConfig): ProviderConfig {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/u, '');
  if (baseUrl) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('请输入完整的服务地址。');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        '远程服务请使用 HTTPS；本机服务可使用 HTTP。地址不能包含密钥、查询参数或片段。',
      );
  }
  return { baseUrl, model: provider.model.trim(), protocol: provider.protocol };
}
