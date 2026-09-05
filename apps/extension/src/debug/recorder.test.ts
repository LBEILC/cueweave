import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebugRecorder } from './recorder';
import { DEBUG_POLICY, DEBUG_STORAGE_KEY } from './types';
import { redactDebug } from './redact';

afterEach(() => vi.unstubAllGlobals());
const settings = {
  apiKey: 'private-example-key',
  baseUrl: 'https://provider.example/v1',
  model: 'model-a',
  protocol: 'auto' as const,
};
const scope = {
  videoId: 'video-a',
  tabId: 1,
  windowId: 'playback:2',
  startMs: 60000,
  endMs: 90000,
};
function memory() {
  const values: Record<string, unknown> = {};
  const storage = {
    get: async () => structuredClone(values),
    set: vi.fn(async (next: object) => {
      Object.assign(values, structuredClone(next));
    }),
  };
  return { values, storage };
}

describe('debug recorder', () => {
  it('is off by default and does not install a transport or persist events', async () => {
    const { storage } = memory();
    const recorder = new DebugRecorder(storage);
    const capture = await recorder.capture(scope, settings);
    expect(capture.runtime.fetch).toBeUndefined();
    await capture.record('event', { text: 'not persisted' });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('preserves successful and HTTP error responses, removes credentials before storage, and survives a worker restart', async () => {
    const { storage, values } = memory();
    const recorder = new DebugRecorder(storage);
    await recorder.setEnabled(true);
    const capture = await recorder.capture(scope, settings);
    const body = {
      choices: [{ message: { content: '错误译文' } }],
      usage: { completion_tokens: 4 },
      echo: settings.apiKey,
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(body)))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'rate limit', secret: 'server-secret' }), {
            status: 429,
          }),
        ),
    );
    const first = await capture.runtime.fetch!(
      'https://provider.example/v1/chat/completions?key=abc',
      {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: 'a', messages: [{ content: 'hello' }] }),
      },
    );
    expect(await first.json()).toEqual(body);
    const second = await capture.runtime.fetch!('https://provider.example/v1/responses', {
      body: '{}',
    });
    expect(second.status).toBe(429);
    const persisted = JSON.stringify(values);
    for (const secret of [settings.apiKey, 'server-secret', 'Bearer', 'key=abc', 'Authorization'])
      expect(persisted).not.toContain(secret);
    const restarted = new DebugRecorder(storage);
    const records = (await restarted.read()).records;
    expect(records).toHaveLength(2);
    expect(records[0]!.data).toMatchObject({
      status: 200,
      state: 'completed',
      protocol: 'chat-completions',
      response: { usage: { completion_tokens: 4 } },
    });
    expect(records[1]!.data).toMatchObject({ status: 429, protocol: 'responses' });
  });

  it('retains the original failed attempt and the later retry with distinct IDs', async () => {
    const { storage } = memory();
    const recorder = new DebugRecorder(storage);
    await recorder.setEnabled(true);
    const capture = await recorder.capture(scope, settings);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('{}')),
    );
    await expect(capture.runtime.fetch!('https://provider.example/v1/responses')).rejects.toThrow(
      'offline',
    );
    await capture.runtime.fetch!('https://provider.example/v1/responses');
    const records = (await recorder.read()).records;
    expect(records).toHaveLength(2);
    expect(records[0]!.data).toMatchObject({ state: 'failed', error: { message: 'offline' } });
    expect(records[0]!.id).not.toBe(records[1]!.id);
  });

  it('serializes parallel writers and discards old in-flight writes after off/on', async () => {
    const { storage } = memory();
    const recorder = new DebugRecorder(storage);
    await recorder.setEnabled(true);
    const a = await recorder.capture(scope, settings);
    const b = await recorder.capture({ ...scope, videoId: 'video-b' }, settings);
    await Promise.all([a.record('a', {}), b.record('b', {})]);
    expect((await recorder.read()).records.map((r) => r.kind)).toEqual(['a', 'b']);
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const request = a.runtime.fetch!('https://provider.example/v1/responses');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await recorder.read()).records.at(-1)!.data).toMatchObject({ state: 'pending' });
    await recorder.setEnabled(false);
    await recorder.setEnabled(true);
    finish(new Response('{}'));
    await request;
    await a.record('late', {});
    expect((await recorder.read()).records).toEqual([]);
  });

  it('does not break translation when local storage fails', async () => {
    const { storage } = memory();
    const recorder = new DebugRecorder(storage);
    await recorder.setEnabled(true);
    const capture = await recorder.capture(scope, settings);
    storage.set.mockRejectedValue(new Error('quota'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('valid response')));
    const response = await capture.runtime.fetch!('https://provider.example/v1/responses');
    expect(await response.text()).toBe('valid response');
    expect(recorder.lastError).toBeTruthy();
  });

  it('bounds bytes and age and reports oversized bodies without returning a truncated model response', async () => {
    const { storage, values } = memory();
    let now = 100_000;
    const recorder = new DebugRecorder(storage, () => now);
    await recorder.setEnabled(true);
    const capture = await recorder.capture(scope, settings);
    for (let i = 0; i < 12; i++)
      await capture.record('large', { index: i, text: '字'.repeat(100_000) });
    expect(
      new TextEncoder().encode(JSON.stringify(values[DEBUG_STORAGE_KEY])).byteLength,
    ).toBeLessThanOrEqual(DEBUG_POLICY.maxBytes);
    expect((await recorder.read()).evictedRecords).toBeGreaterThan(0);
    const longBody = 'x'.repeat(DEBUG_POLICY.maxResponseBytes + 1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(longBody)));
    expect(
      await (await capture.runtime.fetch!('https://provider.example/v1/responses')).text(),
    ).toHaveLength(longBody.length);
    expect((await recorder.read()).records.at(-1)!.data).toMatchObject({
      response: { omitted: 'response-size-limit' },
    });
    now += DEBUG_POLICY.maxAgeMs + 1;
    expect((await recorder.read()).records).toHaveLength(0);
    expect((await new DebugRecorder(storage, () => now).read()).records).toHaveLength(0);
  });
});

it('redacts nested JSON strings, URL credentials, bearer tokens and encoded secrets', () => {
  const value = redactDebug(
    {
      request: JSON.stringify({
        apiKey: 'arbitrary-value',
        text: 'https://user:password@example.com/v1?token=secret#fragment',
      }),
      response: 'Bearer another-token sk-1234567890 private%2Fkey private/key',
    },
    ['private/key'],
  );
  const text = JSON.stringify(value);
  for (const privateText of [
    'arbitrary-value',
    'user:',
    'password',
    'token=secret',
    '#fragment',
    'another-token',
    'sk-1234567890',
    'private%2Fkey',
    'private/key',
  ])
    expect(text).not.toContain(privateText);
});
