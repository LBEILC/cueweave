import { describe, expect, it, vi } from 'vitest';
import {
  PlaybackPlan,
  parsePlaybackSeam,
  sourceNeighbors,
  windowsFromSnapshot,
} from '@cueweave/core/provider/playbackPlan';
import { PlaybackPlanClient } from './playbackPlanClient';
import { PlaybackPlans } from '../cache/playbackPlans';
import { ProviderError, type ProviderSettings } from '@cueweave/core/provider/types';
import {
  isOpenPlaybackPlanMessage,
  isPreparePlaybackWindowMessage,
  validSourceTokens,
} from './messages';

const tokens = Array.from({ length: 120 }, (_, i) => ({
  id: `t${i}`,
  cueId: 'c',
  text: i % 30 === 29 ? 'end.' : 'word',
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
}));
const response = (cut: number, length: number) =>
  JSON.stringify({
    windows: [
      { endIndex: cut - 1, reason: 'clause' },
      { endIndex: length - 1, reason: 'end' },
    ],
  });
const unchanged = async (_stage: string, prompt: string) => {
  const input = JSON.parse(prompt.split('\n').find((s) => s.startsWith('{"neighbors"'))!);
  const cut = JSON.parse(prompt.split('\n').at(-1)!).originalEndIndex + 1;
  return response(cut, input.tokens.length);
};
const settings: ProviderSettings = {
  baseUrl: 'https://example.test/v1',
  model: 'test',
  apiKey: 'secret-not-persisted',
  protocol: 'auto',
};

describe('live rolling windows', () => {
  it('rolls the pending right window forward and freezes both edges of translated windows', async () => {
    const plan = new PlaybackPlan(tokens);
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(33, 60))
      .mockResolvedValueOnce(response(27, 57));
    const first = await plan.prepare(0, request);
    expect(first.tokens.map((t) => t.id)).toEqual(tokens.slice(0, 33).map((t) => t.id));
    await plan.prepare(1, request);
    expect(plan.window(0)).toEqual(first);
    expect(request).toHaveBeenCalledTimes(2);
    expect(windowsFromSnapshot(tokens, plan.snapshot()).flatMap((w) => w.tokens)).toEqual(tokens);
  });
  it('seeks directly to a distant window without planning all preceding windows', async () => {
    const plan = new PlaybackPlan([
      ...tokens,
      ...tokens.map((t) => ({
        ...t,
        id: `${t.id}b`,
        startMs: t.startMs + 120000,
        endMs: t.endMs + 120000,
      })),
    ]);
    const request = vi.fn(unchanged);
    const target = await plan.prepare(6, request);
    expect(target.startMs).toBe(180000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(plan.snapshot().finalized.slice(0, 5)).toEqual([false, false, false, false, false]);
    await plan.prepare(5, request);
    expect(plan.window(6)).toEqual(target);
  });
  it('serializes simultaneous neighboring requests without gaps or duplicate seam calls', async () => {
    const plan = new PlaybackPlan(tokens);
    const request = vi.fn(unchanged);
    const [a, b] = await Promise.all([plan.prepare(0, request), plan.prepare(1, request)]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(a.tokens.at(-1)!.endMs).toBe(b.tokens[0]!.startMs);
    expect(plan.snapshot().revision).toBe(2);
  });
  it('restores persisted boundaries without calling the model again', async () => {
    const plan = new PlaybackPlan(tokens);
    await plan.prepare(1, unchanged);
    const restored = new PlaybackPlan(tokens, plan.snapshot());
    const request = vi.fn();
    await restored.prepare(1, request);
    expect(request).not.toHaveBeenCalled();
    expect(restored.snapshot()).toEqual(plan.snapshot());
  });
  it('keeps an invalid or unavailable plan usable but never swallows cancellation or credentials errors', async () => {
    for (const content of ['{}', response(1, 60), response(30, 59)]) {
      const plan = new PlaybackPlan(tokens);
      const diagnostic = vi.fn();
      await plan.prepare(0, async () => content, undefined, undefined, diagnostic);
      expect(plan.window(0).tokens).toEqual(tokens.slice(0, 30));
      expect(diagnostic).toHaveBeenCalledOnce();
    }
    for (const code of ['cancelled', 'authentication', 'permission-missing'] as const) {
      const plan = new PlaybackPlan(tokens);
      await expect(
        plan.prepare(0, async () => {
          throw new ProviderError(code, code);
        }),
      ).rejects.toMatchObject({ code });
      expect(plan.snapshot().finalized[0]).toBe(false);
    }
  });
  it('does not commit a result arriving after cancellation', async () => {
    const plan = new PlaybackPlan(tokens),
      controller = new AbortController();
    await expect(
      plan.prepare(
        0,
        async () => {
          controller.abort();
          return response(33, 60);
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(plan.snapshot().ends[0]).toBe(30);
    expect(plan.snapshot().finalized[0]).toBe(false);
  });
  it('rejects malformed snapshots and plans; handles short videos without a planning request', async () => {
    const plan = new PlaybackPlan(tokens, {
      ends: [30, 30, 90, 120],
      finalized: [true, true, true, true],
      revision: 10,
    });
    expect(plan.snapshot().revision).toBe(0);
    expect(() => parsePlaybackSeam(response(50, 60), tokens.slice(0, 60))).toThrow();
    const request = vi.fn();
    expect((await new PlaybackPlan(tokens.slice(0, 4)).prepare(0, request)).tokens).toHaveLength(4);
    expect(request).not.toHaveBeenCalled();
  });
  it('passes only read-only surrounding source within 15 seconds', () => {
    const context = sourceNeighbors(tokens, tokens.slice(30, 60));
    expect(context.before.split(' ')).toHaveLength(15);
    expect(context.after.split(' ')).toHaveLength(15);
  });
});

describe('plan persistence and message lifecycle', () => {
  function store() {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: async (keys: string[] | null) =>
        Object.fromEntries(Object.entries(data).filter(([k]) => !keys || keys.includes(k))),
      set: async (values: Record<string, unknown>) => {
        Object.assign(data, structuredClone(values));
      },
      remove: async (keys: string[]) => {
        for (const k of keys) delete data[k];
      },
    };
  }
  it('persists no credentials and isolates model, video and source revisions', async () => {
    const storage = store(),
      plans = new PlaybackPlans(storage);
    const first = await plans.open('video', 'en', tokens, settings);
    await plans.get(first.key)!.prepare(0, unchanged, undefined, plans.saver(first.key));
    expect(JSON.stringify(storage.data)).not.toContain(settings.apiKey);
    const restored = await new PlaybackPlans(storage).open('video', 'en', tokens, {
      ...settings,
      apiKey: 'other',
    });
    expect(restored.key).toBe(first.key);
    expect(restored.snapshot.finalized[0]).toBe(true);
    for (const [video, source, config] of [
      ['other', tokens, settings],
      ['video', tokens.slice(1), settings],
      ['video', tokens, { ...settings, model: 'other' }],
    ] as const) {
      expect((await plans.open(video, 'en', source, config)).key).not.toBe(first.key);
    }
  });
  it('does not restore cleared plan data from an old in-flight save', async () => {
    const storage = store(),
      plans = new PlaybackPlans(storage);
    const result = await plans.open('video', 'en', tokens, settings);
    const staleSave = plans.saver(result.key),
      oldPlan = plans.get(result.key)!;
    await plans.clear('video');
    await plans.open('video', 'en', tokens, settings);
    await oldPlan.prepare(0, unchanged, undefined, staleSave);
    expect(storage.data).toEqual({});
  });
  it('reopens a suspended background once and restores its saved plan', async () => {
    let opens = 0,
      prepares = 0;
    const plan = new PlaybackPlan(tokens);
    const client = new PlaybackPlanClient(tokens, 'video', 'en', async (message) => {
      if ('tokens' in message) {
        opens++;
        return { ok: true, key: 'k', snapshot: plan.snapshot() };
      }
      prepares++;
      if (prepares === 1)
        return {
          ok: false,
          expired: true,
          error: { code: 'invalid-response', message: 'expired' },
        };
      await plan.prepare(0, unchanged);
      return { ok: true, key: 'k', snapshot: plan.snapshot() };
    });
    expect((await client.prepare(0, 'session', 'current')).tokens).toHaveLength(30);
    expect([opens, prepares]).toEqual([2, 2]);
  });
  it('never sends work for a video left while the plan was opening', async () => {
    const send = vi.fn(async () => ({
      ok: true as const,
      key: 'k',
      snapshot: new PlaybackPlan(tokens).snapshot(),
    }));
    const client = new PlaybackPlanClient(tokens, 'video', 'en', send);
    await expect(client.prepare(0, 'old', 'current', () => false)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('validates full source data and control messages at the background boundary', () => {
    expect(validSourceTokens(tokens)).toBe(true);
    // YouTube ASR cues can overlap; their supplied token order is still authoritative.
    expect(
      validSourceTokens([
        { ...tokens[0], startMs: 100, endMs: 900 },
        { ...tokens[1], startMs: 90, endMs: 500 },
      ]),
    ).toBe(true);
    for (const bad of [
      [...tokens, tokens[0]],
      [{ ...tokens[0], startMs: NaN }],
      [{ ...tokens[0], endMs: -1 }],
    ])
      expect(validSourceTokens(bad)).toBe(false);
    expect(
      isOpenPlaybackPlanMessage({
        type: 'cueweave:open-playback-plan',
        videoId: 'v',
        languageCode: 'en',
        tokens,
      }),
    ).toBe(true);
    expect(
      isPreparePlaybackWindowMessage({
        type: 'cueweave:prepare-playback-window',
        key: `cueweave.playback-plan.${'a'.repeat(64)}`,
        index: 0,
        sessionId: 's',
        priority: 'current',
      }),
    ).toBe(true);
    expect(
      isPreparePlaybackWindowMessage({ type: 'cueweave:prepare-playback-window', index: -1 }),
    ).toBe(false);
  });
});
