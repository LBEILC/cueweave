import { readFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseSubtitleAppearance,
  validSubtitleAppearance,
  type SubtitleAppearance,
} from '../shared/subtitle-appearance';
import {
  normalizeProvider,
  validProvider,
  type SettingsSnapshot,
  type ProviderConfig,
  type ThemePreference,
} from '../shared/settings';

export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface StoredSettings {
  subtitles?: SubtitleAppearance;
  version: 1;
  theme: ThemePreference;
  provider: ProviderConfig;
  encryptedKey?: string;
}
export class SettingsStore {
  private data: StoredSettings = {
    version: 1,
    theme: 'system',
    provider: { baseUrl: '', model: '', protocol: 'auto' },
  };
  private sessionKey = '';
  private loaded = false;
  private queue = Promise.resolve();
  constructor(
    private path: string,
    private secrets: SecretStorage,
  ) {}
  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const value = JSON.parse(raw) as StoredSettings;
      if (
        value.version !== 1 ||
        !['system', 'light', 'dark'].includes(value.theme) ||
        !validProvider(value.provider) ||
        (value.subtitles !== undefined && !validSubtitleAppearance(value.subtitles)) ||
        (value.encryptedKey !== undefined && typeof value.encryptedKey !== 'string')
      )
        throw new Error();
      normalizeProvider(value.provider);
      this.data = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('无法读取设置文件，请重启应用后重试。原文件已保留。');
    }
    this.loaded = true;
    return this.snapshot();
  }
  snapshot(): SettingsSnapshot {
    if (!this.loaded) throw new Error('设置尚未加载，请重试。');
    let keyStatus: SettingsSnapshot['keyStatus'] = this.sessionKey ? 'session' : 'missing';
    if (!this.sessionKey && this.data.encryptedKey) {
      try {
        keyStatus = this.key() ? 'saved' : 'unavailable';
      } catch {
        keyStatus = 'unavailable';
      }
    }
    return {
      subtitles: parseSubtitleAppearance(this.data.subtitles),
      theme: this.data.theme,
      provider: { ...this.data.provider },
      keyStatus,
      encryptionAvailable: this.secrets.isEncryptionAvailable(),
    };
  }
  key() {
    if (this.sessionKey) return this.sessionKey;
    if (!this.data.encryptedKey) return '';
    if (!this.secrets.isEncryptionAvailable())
      throw new Error('无法解锁已保存的密钥，请重新输入。');
    try {
      return this.secrets.decryptString(Buffer.from(this.data.encryptedKey, 'base64'));
    } catch {
      throw new Error('无法解锁已保存的密钥，请重新输入。');
    }
  }
  update(change: {
    subtitles?: SubtitleAppearance;
    theme?: ThemePreference;
    provider?: ProviderConfig;
    key?: string;
    removeKey?: boolean;
  }) {
    const pending = this.queue.then(async () => {
      if (!this.loaded) throw new Error('设置尚未加载，请重试。');
      const next = { ...this.data, ...(change.theme ? { theme: change.theme } : {}) };
      if (change.subtitles) next.subtitles = parseSubtitleAppearance(change.subtitles);
      let sessionKey = this.sessionKey;
      if (change.provider) {
        next.provider = normalizeProvider(change.provider);
        // Credentials never silently follow a newly entered service address.
        if (next.provider.baseUrl !== this.data.provider.baseUrl) {
          delete next.encryptedKey;
          sessionKey = '';
        }
      }
      if (change.removeKey) {
        delete next.encryptedKey;
        sessionKey = '';
      }
      if (change.key?.trim()) {
        if (this.secrets.isEncryptionAvailable()) {
          try {
            next.encryptedKey = this.secrets.encryptString(change.key.trim()).toString('base64');
          } catch {
            throw new Error('无法加密密钥，请重试或重新启动应用。原配置未更改。');
          }
          sessionKey = '';
        } else {
          delete next.encryptedKey;
          sessionKey = change.key.trim();
        }
      }
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(this.path), { recursive: true });
        const file = await open(temp, 'wx', 0o600);
        try {
          await file.writeFile(JSON.stringify(next));
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temp, this.path);
      } catch {
        throw new Error('设置未保存，请检查磁盘空间和目录权限后重试。');
      } finally {
        await rm(temp, { force: true }).catch(() => {});
      }
      this.data = next;
      this.sessionKey = sessionKey;
      return this.snapshot();
    });
    this.queue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
}
