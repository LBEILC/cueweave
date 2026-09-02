import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVideoGlossary, mergeVideoGlossary, readVideoGlossary } from './videoGlossary';

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

describe('video glossary', () => {
  it('sanitizes terms and keeps the latest translation for the same source', async () => {
    await mergeVideoGlossary('video-a', [
      { source: '  ChatGPT  ', translation: ' ChatGPT ' },
      { source: 'chatgpt', translation: '聊天生成预训练转换器' },
    ]);

    expect(await readVideoGlossary('video-a')).toEqual([
      { source: 'chatgpt', translation: '聊天生成预训练转换器' },
    ]);
  });

  it('isolates videos and clears only the requested glossary', async () => {
    await mergeVideoGlossary('video-a', [{ source: 'OpenAI', translation: 'OpenAI' }]);
    await mergeVideoGlossary('video-b', [{ source: 'Gemini', translation: 'Gemini' }]);

    await clearVideoGlossary('video-a');

    expect(await readVideoGlossary('video-a')).toEqual([]);
    expect(await readVideoGlossary('video-b')).toEqual([
      { source: 'Gemini', translation: 'Gemini' },
    ]);
  });
});
