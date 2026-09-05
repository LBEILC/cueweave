import { describe, expect, it } from 'vitest';
import { requestCompleteOutput, TruncatedOutputError } from './complete-output';

const payload = (finish_reason: string, content: string) => ({
  choices: [{ finish_reason, message: { content } }],
});
describe('bounded output recovery', () => {
  it('retries a truncated response once with a larger output allowance', async () => {
    const limits: number[] = [];
    expect(
      await requestCompleteOutput(async (limit, retry) => {
        limits.push(limit);
        return retry ? payload('stop', '{"units":[]}') : payload('length', '{"units":[');
      }),
    ).toBe('{"units":[]}');
    expect(limits).toEqual([4096, 8192]);
  });
  it('does not accept even valid JSON when the model explicitly reports truncation', async () => {
    let calls = 0;
    await expect(
      requestCompleteOutput(async () => {
        calls += 1;
        return payload('length', '{}');
      }),
    ).rejects.toBeInstanceOf(TruncatedOutputError);
    expect(calls).toBe(2);
  });
  it('does not retry network failures or incomplete non-length responses', async () => {
    let calls = 0;
    await expect(
      requestCompleteOutput(async () => {
        calls += 1;
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
    expect(calls).toBe(1);
    await expect(requestCompleteOutput(async () => payload('stop', ''))).rejects.toThrow('空内容');
    await expect(
      requestCompleteOutput(async () => payload('content_filter', '{}')),
    ).rejects.toThrow('未正常结束');
  });
});
