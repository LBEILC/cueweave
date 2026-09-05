import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OnlineTranslator } from './online-translator';
import { validOnlineTranslationCommand } from '../shared/online-translation';
import { parseSubtitleTracks } from '../services/link';
import { normalizeRollingCues } from '@cueweave/core/provider/rollingCues';
import type { ProviderSettings } from '@cueweave/core/provider/types';
const directories: string[] = [];
const instances: OnlineTranslator[] = [];
afterEach(async () => {
  instances.forEach((i) => i.dispose());
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const provider: ProviderSettings = {
  baseUrl: 'https://model.test/v1',
  model: 'm1',
  protocol: 'responses',
  apiKey: 'never-persist-this-key',
};
const source = Array.from({ length: 100 }, (_, index) => ({
  id: String(index + 1),
  startMs: index * 5000,
  endMs: index * 5000 + 4900,
  text: `Original line ${index + 1}.`,
}));
async function setup(translate: ConstructorParameters<typeof OnlineTranslator>[1]) {
  const directory = await mkdtemp(join(tmpdir(), 'cueweave-online-test-'));
  directories.push(directory);
  const translator = new OnlineTranslator(directory, translate);
  instances.push(translator);
  return { translator, directory };
}
describe('online playback translation', () => {
  it('prioritizes a seek, limits lookahead, reuses cached results, and separates model identity', async () => {
    const translate = vi.fn<NonNullable<ConstructorParameters<typeof OnlineTranslator>[1]>>(
      async (_p, _s, window) =>
        window.map((c: (typeof source)[number]) => ({ id: c.id, translation: `译文 ${c.id}` })),
    );
    const { translator, directory } = await setup(translate);
    await translator.start('source', source, provider, 'zh-CN', 250000);
    await vi.waitFor(() => expect(translator.tick('source', 250000).state).toBe('ready'));
    expect(translate.mock.calls[0]![2][0]!.id).toBe('51');
    expect(
      translate.mock.calls
        .flatMap((c) => c[2])
        .every((c) => c.startMs <= 340000 && c.startMs >= 250000),
    ).toBe(true);
    translator.stop('source');
    const count = translate.mock.calls.length;
    await translator.start('new-authorization', source, provider, 'zh-CN', 250000);
    expect(translate).toHaveBeenCalledTimes(count);
    translator.stop('new-authorization');
    const cache = await readFile(join(directory, (await readdir(directory))[0]!), 'utf8');
    expect(cache).not.toContain(provider.apiKey);
    await translator.start('new-model', source, { ...provider, model: 'm2' }, 'zh-CN', 250000);
    await vi.waitFor(() => expect(translator.tick('new-model', 250000).state).toBe('ready'));
    expect(translate.mock.calls.length).toBeGreaterThan(count);
  });
  it('aborts old work on seeking and never commits a stale result after stopping', async () => {
    let release: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const translate = vi.fn<NonNullable<ConstructorParameters<typeof OnlineTranslator>[1]>>(
      async (_p, _s, window, _l, s) => {
        signal = s;
        await new Promise<void>((resolve) => {
          release = resolve;
          s.addEventListener('abort', () => resolve(), { once: true });
        });
        return window.map((c: (typeof source)[number]) => ({ id: c.id, translation: 'stale' }));
      },
    );
    const { translator } = await setup(translate);
    await translator.start('s', source, provider, 'zh-CN', 0);
    translator.tick('s', 350000);
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    expect(translate.mock.calls[1]![2][0]!.id).toBe('71');
    translator.stop('s');
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(translator.tick('s', 350000)).toMatchObject({
      completed: 0,
      state: 'paused',
      translations: {},
    });
  });
  it('stops on provider errors instead of repeatedly billing on poll', async () => {
    const translate = vi.fn().mockRejectedValue(new Error('secret response'));
    const { translator } = await setup(translate);
    await translator.start('s', source, provider, 'zh-CN', 0);
    await vi.waitFor(() => expect(translator.tick('s', 0).state).toBe('failed'));
    for (let i = 0; i < 10; i++) translator.tick('s', 100000);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translator.tick('s', 0).error).not.toContain('secret');
  });
  it('accepts only fixed authorized command shapes', () => {
    const start = {
      action: 'start',
      sourceId: 'a'.repeat(36),
      positionMs: 0,
      targetLanguage: 'zh-CN',
    };
    expect(validOnlineTranslationCommand(start)).toBe(true);
    for (const change of [
      { apiKey: 'secret' },
      { cues: source },
      { path: 'file' },
      { positionMs: NaN },
      { positionMs: -1 },
      { targetLanguage: '__proto__' },
    ])
      expect(validOnlineTranslationCommand({ ...start, ...change })).toBe(false);
  });
  it('chooses original automatic English without platform-translated tracks and falls back to manual', () => {
    const original = [{ name: 'English', url: 'https://www.youtube.com/api/timedtext?lang=en' }];
    const translated = [
      { name: 'French', url: 'https://www.youtube.com/api/timedtext?lang=en&tlang=fr' },
    ];
    expect(
      parseSubtitleTracks({
        language: 'en',
        subtitles: { en: original },
        automatic_captions: { fr: translated, en: original, 'en-orig': original },
      }),
    ).toEqual([{ language: 'en-orig', label: 'English（自动）', kind: 'automatic' }]);
    expect(
      parseSubtitleTracks({
        language: 'en',
        subtitles: { en: original },
        automatic_captions: { fr: translated },
      })[0]?.kind,
    ).toBe('manual');
    expect(parseSubtitleTracks({ automatic_captions: { fr: translated } })).toEqual([]);
  });
  it('removes overlapping roll-up text but preserves repeated speech at distinct times', () => {
    const cues = normalizeRollingCues([
      { id: '1', startMs: 0, endMs: 3000, text: 'Hello there.' },
      { id: '2', startMs: 2000, endMs: 5000, text: 'Hello there.\nWelcome back.' },
      { id: '3', startMs: 6000, endMs: 8000, text: 'Welcome back.' },
    ]);
    expect(cues.map((c) => c.text)).toEqual(['Hello there.', 'Welcome back.', 'Welcome back.']);
    expect(cues[0]?.endMs).toBe(2000);
    expect(cues[2]?.startMs).toBe(6000);
  });
});
