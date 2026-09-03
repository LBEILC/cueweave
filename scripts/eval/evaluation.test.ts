import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DisplayCue, SourceToken } from '../../src/domain/subtitle';
import { translateTokenWindow } from '../../src/provider/chatCompletions';
import { alignRuns, cueWarnings, summarize } from './analysis';
import { hash, readRun, writeJson } from './io';
import { renderReport, writeComparison, writeReport } from './report';
import { canReuse, contextForWindow, runEvaluation } from './runner';
import type { RunOptions } from './runner';
import { createRuntime, responseUsage } from './trace';
import type { Attempt, EvalRun } from './types';

const settings = {
  apiKey: 'secret-for-tests',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-only',
  protocol: 'chat-completions' as const,
};
const tokens: SourceToken[] = ['Hello', 'world.', 'Version', '5.6.'].map((text, i) => ({
  id: `w${i}`,
  cueId: 'c0',
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
  text,
}));
function cue(start: number, end: number, translation = '你好世界'): DisplayCue {
  return {
    id: `cue-${start}`,
    sourceTokenIds: tokens.slice(start, end + 1).map((token) => token.id),
    startMs: tokens[start]!.startMs,
    endMs: tokens[end]!.endMs,
    sourceText: tokens
      .slice(start, end + 1)
      .map((token) => token.text)
      .join(' '),
    translation,
    sentenceEnd: true,
    status: 'translated',
  };
}
function attempt(cues: DisplayCue[] = []): Attempt {
  return {
    id: 'attempt-1',
    contextHash: 'hash',
    status: 'success',
    startedAt: '2026-01-01',
    durationMs: 0,
    stages: [],
    diagnostics: [],
    requests: [],
    cues,
  };
}
function run(cues = [cue(0, 3)]): EvalRun {
  return {
    schema: 1,
    id: 'run-a',
    name: 'test A',
    videoId: 'test-video',
    languageCode: 'en',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    status: 'completed',
    fingerprint: 'fingerprint',
    gitRevision: 'test',
    tokens,
    windows: [{ id: 'window', startMs: 0, endMs: 4000, tokens }],
    entityAttempts: [],
    aliases: [],
    results: { window: [attempt(cues)] },
    cases: [],
    identity: {
      inputHash: 'input',
      pipelineHash: 'pipeline',
      model: 'test',
      baseUrl: 'https://example.invalid',
      protocol: 'chat-completions',
      mode: 'pipeline',
      context: {},
      windowIds: ['window'],
      promptVersion: 'test',
      segmentationVersion: 'test',
      entityVersion: 'test',
    },
  };
}
const completion = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }),
  );
const temporary = () => mkdtemp(path.join(tmpdir(), 'cueweave-eval-test-'));

describe('evaluation trace and shared provider', () => {
  it('runs without browser globals and records raw output, repairs and usage without credentials', async () => {
    const directory = await temporary();
    await mkdir(path.join(directory, 'requests'));
    const current = attempt();
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion({ units: [] }))
      .mockResolvedValueOnce(
        completion({
          units: [{ startIndex: 0, endIndex: 3, translation: '你好世界 5.6', sentenceEnd: true }],
        }),
      );
    const runtime = createRuntime(
      directory,
      current,
      'window',
      settings.apiKey,
      { used: 0, limit: 10, exhausted: false },
      fakeFetch,
    );
    const cues = await translateTokenWindow(settings, tokens, undefined, undefined, {}, runtime);
    expect(cues[0]?.translation).toContain('5.6');
    expect(current.requests).toHaveLength(2);
    expect(current.diagnostics.some((item) => item.kind === 'validation-error')).toBe(true);
    const logs = await Promise.all(
      (await readdir(path.join(directory, 'requests'))).map((file) =>
        readFile(path.join(directory, 'requests', file), 'utf8'),
      ),
    );
    expect(logs.join('')).not.toContain(settings.apiKey);
    expect(logs.join('')).not.toContain('Authorization');
    expect(
      logs.some((log) => JSON.parse(log).response.choices[0].message.content === '{"units":[]}'),
    ).toBe(true);
    expect(current.requests[0]?.usage?.total).toBe(30);
  });
  it('redacts echoed secrets and never exceeds the request budget', async () => {
    const directory = await temporary();
    await mkdir(path.join(directory, 'requests'));
    const current = attempt();
    const budget = { used: 0, limit: 1, exhausted: false };
    const runtime = createRuntime(
      directory,
      current,
      'window',
      settings.apiKey,
      budget,
      async () => new Response(settings.apiKey, { status: 401 }),
    );
    await runtime.fetch!('https://example.invalid', {
      body: JSON.stringify({ data: settings.apiKey }),
    });
    await expect(runtime.fetch!('https://example.invalid')).rejects.toThrow('请求上限');
    expect(budget.used).toBe(1);
    const raw = await readFile(
      path.join(directory, 'requests', `${current.requests[0]!.id}.json`),
      'utf8',
    );
    expect(raw).not.toContain(settings.apiKey);
    expect(raw).toContain('[REDACTED]');
    expect(current.requests[0]?.status).toBe(401);
  });
  it('keeps missing usage distinct from zero and supports both protocols', () => {
    expect(responseUsage({})).toBeNull();
    expect(responseUsage({ usage: { input_tokens: 0, output_tokens: 0 } })?.total).toBe(0);
    expect(responseUsage({ usage: { prompt_tokens: 12, completion_tokens: 8 } })?.total).toBe(20);
  });
  it('recovers request traces written after the last window checkpoint', async () => {
    const directory = await temporary();
    await mkdir(path.join(directory, 'requests'));
    await writeJson(path.join(directory, 'result.json'), run());
    await writeJson(path.join(directory, 'requests', 'abc-123.json'), {
      id: 'abc-123',
      attemptId: 'attempt-1',
      startedAt: '2026-01-01',
      durationMs: 900,
      status: 200,
      usage: { input: 20, output: 5, total: 25 },
    });
    const recovered = await readRun(directory);
    expect(recovered.results.window?.[0]?.requests).toHaveLength(1);
    expect(summarize(recovered).reportedUsage?.total).toBe(25);
  });
});

describe('source alignment and quality signals', () => {
  it('groups two different subtitle splits by overlapping source tokens', () => {
    const a = run([cue(0, 1), cue(2, 3)]);
    const b = run([cue(0, 0), cue(1, 1), cue(2, 3)]);
    const groups = alignRuns(a, b);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.left).toHaveLength(1);
    expect(groups[0]?.right).toHaveLength(2);
    expect(groups[0]?.different).toBe(true);
    expect(groups[1]?.different).toBe(false);
  });
  it('rejects different input and retains missing windows as visible spans', () => {
    const b = run();
    b.results = {};
    expect(alignRuns(run(), b)[0]?.rightMissing).toBe(true);
    expect(summarize(b).missingTokens).toBe(4);
    b.identity.inputHash = 'other';
    expect(() => alignRuns(run(), b)).toThrow('同一份原始字幕');
  });
  it('separates length/decimal warnings from structural validity and manual judgment', () => {
    const long = cue(0, 3, '这是一个需要人工审阅但不应该直接判定翻译错误的很长很长的字幕句子');
    expect(cueWarnings(long)).toContain('数字含点写法变化 待核对');
    const baseline = run([long]);
    baseline.cases = [{ id: 'test', label: 'test', startMs: 0, endMs: 4000, review: '人工核对' }];
    expect(summarize(baseline).missingTokens).toBe(0);
    expect(summarize(baseline).caseChecks[0]?.status).toBe('待人工评审');
    expect(summarize(baseline).reportedUsage).toBeNull();
  });
});

describe('resume and context isolation', () => {
  it('reuses only validated output with identical effective context', () => {
    const successful = attempt();
    expect(canReuse(successful, 'hash')).toBe(true);
    expect(canReuse(successful, 'new')).toBe(false);
    expect(canReuse({ ...successful, status: 'failed' }, 'hash')).toBe(false);
    const baseline = run();
    baseline.aliases = [{ source: 'CHBT', translation: 'ChatGPT' }];
    baseline.identity.mode = 'translation';
    baseline.identity.context = { terminology: [], entityAliases: [] };
    expect(contextForWindow(baseline, 1).entityAliases).toEqual([]);
    expect(contextForWindow(baseline, 1).previousCues).toEqual([]);
    baseline.identity.mode = 'pipeline';
    expect(contextForWindow(baseline, 1).previousCues).toHaveLength(1);
    expect(hash(contextForWindow(baseline, 1))).not.toBe(hash(contextForWindow(baseline, 0)));
  });
  it('writes outputs, resumes without requests, rejects changed input and preserves history', async () => {
    const directory = await temporary();
    const input = path.join(directory, 'input.json');
    await writeJson(input, {
      videoId: 'test-video',
      languageCode: 'en',
      events: [{ tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'Hello world.' }] }],
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      completion({
        units: [{ startIndex: 0, endIndex: 1, translation: '你好世界', sentenceEnd: true }],
      }),
    );
    const options: RunOptions = {
      input,
      directory: path.join(directory, 'run'),
      settings,
      mode: 'pipeline',
      context: { correctionEnabled: false },
      cases: [],
      fromMs: 0,
      toMs: Infinity,
      limit: Infinity,
      maxRequests: 5,
      resume: false,
      dryRun: false,
      fetcher,
    };
    const first = await runEvaluation(options);
    expect(first?.status).toBe('completed');
    await writeReport(options.directory);
    expect(await readFile(path.join(options.directory, 'bilingual.srt'), 'utf8')).toContain(
      '你好世界',
    );
    await runEvaluation({ ...options, resume: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      runEvaluation({ ...options, resume: true, settings: { ...settings, model: 'another' } }),
    ).rejects.toThrow('续跑输入不一致');
    const existing = await readRun(options.directory);
    const id = existing.windows[0]!.id;
    existing.results[id]![0]!.status = 'failed';
    await writeJson(path.join(options.directory, 'result.json'), existing);
    const retried = await runEvaluation({ ...options, resume: true });
    expect(retried?.results[id]).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(runEvaluation(options)).rejects.toThrow();
    await writeComparison(options.directory, options.directory, path.join(directory, 'comparison'));
    await expect(
      writeComparison(options.directory, options.directory, path.join(directory, 'comparison')),
    ).rejects.toThrow();
  });
  it('pauses on service authentication errors without processing every window', async () => {
    const directory = await temporary();
    const input = path.join(directory, 'input.json');
    await writeJson(input, {
      videoId: 'test',
      languageCode: 'en',
      events: [{ tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'Hello world.' }] }],
    });
    const result = await runEvaluation({
      input,
      directory: path.join(directory, 'run'),
      settings,
      mode: 'pipeline',
      context: { correctionEnabled: false },
      cases: [],
      fromMs: 0,
      toMs: Infinity,
      limit: Infinity,
      maxRequests: 2,
      resume: false,
      dryRun: false,
      fetcher: async () => new Response('', { status: 401 }),
    });
    expect(result?.status).toBe('paused');
  });
});

describe('safe reports', () => {
  it('escapes untrusted model output and distinguishes incomplete exports', async () => {
    const baseline = run([cue(0, 3, '</script><img src=x onerror=alert(1)>')]);
    const html = await renderReport(baseline);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).toContain('MiSans-LICENSE.pdf');
    const directory = await temporary();
    baseline.windows.push({ id: 'missing', startMs: 4000, endMs: 5000, tokens: [] });
    await writeJson(path.join(directory, 'result.json'), baseline);
    await writeReport(directory);
    expect(await readdir(directory)).toContain('translation.partial.srt');
    expect(await readdir(directory)).not.toContain('translation.srt');
    baseline.results = {};
    await writeJson(path.join(directory, 'result.json'), baseline);
    await writeReport(directory);
    expect(await readdir(directory)).not.toContain('translation.partial.srt');
    expect(await readdir(path.join(directory, 'exports-history'))).toHaveLength(1);
  });
});
