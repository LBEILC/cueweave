import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { DisplayCue, SourceToken } from '../domain/subtitle';
import {
  createTranslationCacheKey,
  selectLruEvictionKeys,
  TranslationCache,
} from './translationCache';

const tokens: SourceToken[] = [
  {
    id: 'token-1',
    cueId: 'cue-1',
    text: 'Hello',
    startMs: 0,
    endMs: 400,
  },
];

function cue(id: string): DisplayCue {
  return {
    id,
    sourceTokenIds: ['token-1'],
    startMs: 0,
    endMs: 400,
    sourceText: 'Hello',
    translation: '你好',
    sentenceEnd: true,
    status: 'translated',
  };
}

describe('translation cache key', () => {
  it('is stable for identical effective inputs and changes with the model', async () => {
    const identity = {
      videoId: 'video-1',
      languageCode: 'en',
      windowId: 'window-1',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      protocol: 'auto' as const,
      promptVersion: 'prompt-v1',
      segmentationVersion: 'display-v1',
      tokens,
    };

    const first = await createTranslationCacheKey(identity);
    const second = await createTranslationCacheKey({ ...identity, tokens: [...tokens] });
    const changed = await createTranslationCacheKey({ ...identity, model: 'model-b' });
    const changedProtocol = await createTranslationCacheKey({
      ...identity,
      protocol: 'responses',
    });

    expect(second).toBe(first);
    expect(changed).not.toBe(first);
    expect(changedProtocol).not.toBe(first);
    expect(first).toMatch(/^translation-v1:[a-f0-9]{64}$/u);
  });
});

describe('selectLruEvictionKeys', () => {
  it('evicts oldest entries until both limits are satisfied', () => {
    expect(
      selectLruEvictionKeys(
        [
          { key: 'old', lastAccessedAt: 1, byteSize: 4 },
          { key: 'middle', lastAccessedAt: 2, byteSize: 4 },
          { key: 'new', lastAccessedAt: 3, byteSize: 4 },
        ],
        2,
        7,
      ),
    ).toEqual(['old', 'middle']);
  });
});

describe('TranslationCache', () => {
  it('persists verified cues and applies LRU eviction', async () => {
    let time = 0;
    const cache = new TranslationCache({
      databaseName: `cueweave-test-${crypto.randomUUID()}`,
      maxEntries: 2,
      maxBytes: 10_000,
      now: () => {
        time += 1;
        return time;
      },
      indexedDb: indexedDB,
    });

    await cache.put('a', [cue('a')]);
    await cache.put('b', [cue('b')]);
    await expect(cache.get('a')).resolves.toEqual([cue('a')]);
    await cache.put('c', [cue('c')]);

    await expect(cache.get('a')).resolves.toEqual([cue('a')]);
    await expect(cache.get('b')).resolves.toBeUndefined();
    await expect(cache.get('c')).resolves.toEqual([cue('c')]);
    cache.close();
  });

  it('ignores unverified cue arrays', async () => {
    const cache = new TranslationCache({
      databaseName: `cueweave-test-${crypto.randomUUID()}`,
      indexedDb: indexedDB,
    });

    await cache.put('empty', []);
    await expect(cache.get('empty')).resolves.toBeUndefined();
    cache.close();
  });
});
