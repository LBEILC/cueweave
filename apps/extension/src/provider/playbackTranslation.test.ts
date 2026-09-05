import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubtitleJsonRequest, translatePlaybackWindow } from './chatCompletions';
import { SubtitleResponseError } from '@cueweave/core/provider/completeOutput';
import type { ProviderSettings } from '@cueweave/core/provider/types';

const settings: ProviderSettings = {
  baseUrl: 'https://relay.test/v1',
  apiKey: 'test-key',
  model: 'test',
  protocol: 'chat-completions',
};
const tokens = [{ id: 't', cueId: 'c', startMs: 0, endMs: 2000, text: 'Hello.' }];
const output = {
  units: [{ startIndex: 0, endIndex: 0, translation: '你好', sentenceEnd: true }],
  corrections: [],
  terminology: [],
};
const completion = (value: unknown = output, finish = 'stop') =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }],
    }),
  );
const runtime = (fetchMock: typeof fetch) => ({
  fetch: fetchMock,
  assertPermission: async () => {},
});
afterEach(() => vi.useRealTimers());

describe('production first-pass transport', () => {
  it('uses the tested prompt and 8192 output budget, with no mandatory review call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    const cues = await translatePlaybackWindow(
      settings,
      tokens,
      undefined,
      undefined,
      {},
      { before: 'Before.', after: 'After.' },
      runtime(fetchMock),
    );
    expect(cues[0]!.translation).toBe('你好');
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.max_completion_tokens).toBe(8192);
    expect(body.messages[1].content).toContain('首轮输出前在内部完成语义和显示边界检查');
    expect(body.messages[1].content).toContain('After.');
  });
  it('retains Responses support and rejects incomplete Responses output', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'incomplete', output_text: JSON.stringify(output) })),
      );
    await expect(
      createSubtitleJsonRequest(
        { ...settings, protocol: 'responses' },
        undefined,
        undefined,
        runtime(fetchMock),
      )('first-pass', 'test', {}),
    ).rejects.toBeInstanceOf(SubtitleResponseError);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://relay.test/v1/responses');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).max_output_tokens).toBe(8192);
  });
  it('never accepts parseable but explicitly truncated output as complete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(output, 'length'));
    await expect(
      createSubtitleJsonRequest(
        settings,
        undefined,
        undefined,
        runtime(fetchMock),
      )('first-pass', 'test', {}),
    ).rejects.toBeInstanceOf(SubtitleResponseError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('automatically retries one transient network failure and no more', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const progress = vi.fn();
    const job = createSubtitleJsonRequest(
      settings,
      undefined,
      progress,
      runtime(fetchMock),
    )('first-pass', 'test', {});
    const check = expect(job).rejects.toMatchObject({ code: 'network' });
    await vi.runAllTimersAsync();
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith('retrying');
  });
  it('recovers a transient failure without a separate subtitle repair call', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(completion());
    const job = translatePlaybackWindow(
      settings,
      tokens,
      undefined,
      undefined,
      {},
      undefined,
      runtime(fetchMock),
    );
    await vi.runAllTimersAsync();
    expect((await job)[0]!.translation).toBe('你好');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not retry an invalid key or an already cancelled request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(
      translatePlaybackWindow(
        settings,
        tokens,
        undefined,
        undefined,
        {},
        undefined,
        runtime(fetchMock),
      ),
    ).rejects.toMatchObject({ code: 'authentication' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockClear();
    await expect(
      translatePlaybackWindow(
        settings,
        tokens,
        undefined,
        controller.signal,
        {},
        undefined,
        runtime(fetchMock),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not publish an incomplete window after structural recovery fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({ units: [] }));
    await expect(
      translatePlaybackWindow(
        settings,
        tokens,
        undefined,
        undefined,
        {},
        undefined,
        runtime(fetchMock),
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
