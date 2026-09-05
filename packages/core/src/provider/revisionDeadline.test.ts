import { afterEach, expect, it, vi } from 'vitest';
import { translatePlaybackWindow } from './chatCompletions';

afterEach(() => vi.useRealTimers());
const source = [{ id: 't0', cueId: 'c0', text: 'Hello', startMs: 0, endMs: 1000 }];
const settings = {
  baseUrl: 'https://test.invalid/v1',
  apiKey: 'test',
  model: 'test',
  protocol: 'chat-completions' as const,
};
const initial = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              units: [{ startIndex: 0, endIndex: 0, translation: '你好', sentenceEnd: true }],
              corrections: [],
              terminology: [],
            }),
          },
        },
      ],
    }),
  );
const hanging = (_input: unknown, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    );
  });

it('times out quality revision once and returns the usable draft without retrying', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValueOnce(initial()).mockImplementation(hanging);
  const diagnostic = vi.fn();
  const job = translatePlaybackWindow(
    settings,
    source,
    undefined,
    undefined,
    { translationMode: 'quality' },
    undefined,
    { fetch: fetchMock, onDiagnostic: diagnostic },
  );
  await vi.advanceTimersByTimeAsync(25001);
  expect((await job)[0]?.translation).toBe('你好');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'stage', message: 'revision-failed' });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not deliver the draft if the user cancels during quality revision', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValueOnce(initial()).mockImplementation(hanging);
  const job = translatePlaybackWindow(
    settings,
    source,
    undefined,
    controller.signal,
    { translationMode: 'quality' },
    undefined,
    { fetch: fetchMock },
  );
  const check = expect(job).rejects.toMatchObject({ code: 'cancelled' });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await check;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
