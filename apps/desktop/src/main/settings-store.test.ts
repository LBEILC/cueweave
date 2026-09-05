import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore, type SecretStorage } from './settings-store';
import { isSettingsCommand, normalizeProvider } from '../shared/settings';
import { DEFAULT_SUBTITLE_APPEARANCE } from '../shared/subtitle-appearance';

const folders: string[] = [];
const secrets: SecretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`cipher:${value.split('').reverse().join('')}`),
  decryptString: (value) => value.toString().slice(7).split('').reverse().join(''),
};
const provider = {
  baseUrl: 'https://example.com/v1',
  model: 'test-model',
  protocol: 'auto' as const,
};
async function fixture(storage = secrets) {
  const dir = await mkdtemp(join(tmpdir(), 'cueweave-settings-unit-'));
  folders.push(dir);
  const path = join(dir, 'settings.json');
  const store = new SettingsStore(path, storage);
  await store.load();
  return { path, store };
}
afterEach(async () => {
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
});
describe('desktop settings storage', () => {
  it('loads legacy settings with subtitle defaults and persists display preferences independently of credentials', async () => {
    const { path, store } = await fixture();
    await store.update({ provider, key: 'display-test-secret' });
    expect(store.snapshot().subtitles).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
    const subtitles = {
      ...DEFAULT_SUBTITLE_APPEARANCE,
      sizePercent: 125,
      positionPercent: 12,
      backgroundEnabled: false,
    };
    await store.update({ subtitles });
    const reopened = new SettingsStore(path, secrets);
    expect((await reopened.load()).subtitles).toEqual(subtitles);
    expect(reopened.key()).toBe('display-test-secret');
  });
  it('persists encrypted credentials and theme without exposing the key in snapshots', async () => {
    const { path, store } = await fixture();
    await Promise.all([
      store.update({ provider, key: 'secret-fixture' }),
      store.update({ theme: 'dark' }),
    ]);
    const bytes = await readFile(path, 'utf8');
    expect(bytes).not.toContain('secret-fixture');
    expect(JSON.stringify(store.snapshot())).not.toContain('secret-fixture');
    const reopened = new SettingsStore(path, secrets);
    expect(await reopened.load()).toMatchObject({ theme: 'dark', keyStatus: 'saved', provider });
    expect(reopened.key()).toBe('secret-fixture');
    await reopened.update({ provider: { ...provider, model: 'other-model' } });
    expect(reopened.key()).toBe('secret-fixture');
    await reopened.update({ provider: { ...provider, baseUrl: 'https://different.example/v1' } });
    expect(reopened.key()).toBe('');
  });
  it('keeps keys in session memory when encryption is unavailable', async () => {
    const storage = { ...secrets, isEncryptionAvailable: () => false };
    const { path, store } = await fixture(storage);
    expect(await store.update({ provider, key: 'memory-only-fixture' })).toMatchObject({
      keyStatus: 'session',
    });
    expect(await readFile(path, 'utf8')).not.toContain('memory-only');
    expect(store.key()).toBe('memory-only-fixture');
    const reopened = new SettingsStore(path, storage);
    expect(await reopened.load()).toMatchObject({ keyStatus: 'missing' });
    await store.update({ removeKey: true });
    expect(store.key()).toBe('');
  });
  it('preserves unreadable settings instead of overwriting them', async () => {
    const { path } = await fixture();
    await writeFile(path, '{broken');
    const store = new SettingsStore(path, secrets);
    await expect(store.load()).rejects.toThrow('原文件已保留');
    await expect(store.update({ theme: 'dark' })).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });
  it('does not acknowledge a failed disk replacement', async () => {
    const { path, store } = await fixture();
    await mkdir(path);
    await expect(store.update({ theme: 'dark' })).rejects.toThrow('设置未保存');
    expect(store.snapshot().theme).toBe('system');
  });
  it('reports an inaccessible encrypted key while allowing replacement', async () => {
    const { path, store } = await fixture();
    await store.update({ provider, key: 'old-key' });
    const reopened = new SettingsStore(path, {
      ...secrets,
      decryptString: () => {
        throw new Error('OS refused');
      },
    });
    expect(await reopened.load()).toMatchObject({ keyStatus: 'unavailable' });
    await reopened.update({ removeKey: true });
    expect(reopened.snapshot().keyStatus).toBe('missing');
  });
});
describe('settings request boundary', () => {
  it('rejects extra fields and invalid credentials', () => {
    for (const command of [
      { action: 'read', path: '/private' },
      { action: 'save', provider, key: 'a\nb' },
      { action: 'theme', theme: 'unknown' },
      { action: 'save', provider, key: 'key', removeKey: true },
    ])
      expect(isSettingsCommand(command)).toBe(false);
  });
  it('allows HTTPS and explicit loopback HTTP without URL secrets', () => {
    for (const baseUrl of [
      'http://remote.example/v1',
      'https://user:secret@example.com',
      'https://example.com/?key=secret',
      'file:///tmp/key',
      'https://example.com/#secret',
    ])
      expect(() => normalizeProvider({ ...provider, baseUrl })).toThrow();
    for (const baseUrl of [
      'http://localhost:1234/v1',
      'http://127.0.0.1:1234/v1',
      'http://[::1]:1234/v1',
      provider.baseUrl,
    ])
      expect(normalizeProvider({ ...provider, baseUrl }).baseUrl).toBe(baseUrl);
  });
});
