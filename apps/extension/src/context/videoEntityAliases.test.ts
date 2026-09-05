import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearVideoEntityAliases,
  readVideoEntityAliases,
  writeVideoEntityAliases,
} from './videoEntityAliases';

let storageState: Record<string, unknown>;

beforeEach(() => {
  storageState = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.map((key) => [key, storageState[key]])),
        set: async (values: Record<string, unknown>) => {
          storageState = { ...storageState, ...values };
        },
        remove: async (key: string) => {
          delete storageState[key];
        },
      },
    },
  });
});

describe('video entity alias cache', () => {
  it('returns aliases only for the matching transcript fingerprint', async () => {
    await writeVideoEntityAliases('video-a', 'fingerprint-a', [
      { source: ' CHBT ', translation: ' ChatGPT ' },
    ]);

    await expect(readVideoEntityAliases('video-a', 'fingerprint-a')).resolves.toEqual([
      { source: 'CHBT', translation: 'ChatGPT' },
    ]);
    await expect(readVideoEntityAliases('video-a', 'fingerprint-b')).resolves.toBeUndefined();
  });

  it('clears one video without removing another video result', async () => {
    await writeVideoEntityAliases('video-a', 'fingerprint-a', [
      { source: 'CHBT', translation: 'ChatGPT' },
    ]);
    await writeVideoEntityAliases('video-b', 'fingerprint-b', [
      { source: 'JPT', translation: 'ChatGPT' },
    ]);

    await clearVideoEntityAliases('video-a');

    await expect(readVideoEntityAliases('video-a', 'fingerprint-a')).resolves.toBeUndefined();
    await expect(readVideoEntityAliases('video-b', 'fingerprint-b')).resolves.toEqual([
      { source: 'JPT', translation: 'ChatGPT' },
    ]);
  });
});
