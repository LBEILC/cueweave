import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import { translateFirstPass } from '@cueweave/core/provider/firstPass';
import { readRun, writeJson, hash, redact } from './eval/io';
import { createRuntime } from './eval/trace';
import type { Attempt } from './eval/types';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    out: { type: 'string' },
    'token-file': { type: 'string' },
    'dry-run': { type: 'boolean' },
  },
});
let secret = '';
async function main() {
  if (!values.from || !values.out) throw new Error('需要 --from 来源运行目录和 --out 新输出目录。');
  const run = await readRun(values.from),
    windows = [0, 5, 6, 21].map((i) => run.windows[i]!);
  const selected = await Promise.all(
    windows.map(async (window) => {
      const prior = run.results[window.id]?.[0];
      if (prior?.status !== 'success') throw new Error('所选窗口尚未完成，不能比较输出额度。');
      const records = await Promise.all(
        prior.requests.map((r) =>
          readFile(path.join(values.from!, 'requests', `${r.id}.json`), 'utf8').then(JSON.parse),
        ),
      );
      const first = records.find((r) => r.scope.endsWith(':first-pass'));
      if (!first) throw new Error('来源窗口没有首轮请求。');
      return { window, prior, first };
    }),
  );
  console.info(`相同提示词输出额度对照 · ${selected.length} 个窗口 · 每窗一次新请求`);
  if (values['dry-run']) return;
  if (!values['token-file']) throw new Error('缺少 --token-file。');
  secret = (await readFile(values['token-file'], 'utf8')).trim();
  if (!secret) throw new Error('密钥文件为空。');
  const directory = path.resolve(values.out);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory);
  await mkdir(path.join(directory, 'requests'));
  const budget = { used: 0, limit: selected.length, exhausted: false };
  const rows = [];
  await writeJson(path.join(directory, 'manifest.json'), {
    from: path.resolve(values.from),
    windows: windows.map((w) => w.id),
    change:
      'Identical saved request body, except max_completion_tokens is 8192 immediately. One new call per window; no retry or extra semantic repair. Concurrent full run and upstream variability prevent a controlled latency claim.',
  });
  for (const { window, prior, first } of selected) {
    const active: Attempt = {
      id: randomUUID(),
      contextHash: prior.contextHash,
      status: 'running',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      stages: ['direct-8192'],
      diagnostics: [],
      requests: [],
      cues: [],
    };
    const runtime = createRuntime(directory, active, window.id, secret, budget);
    const body = { ...first.request, max_completion_tokens: 8192 };
    const begin = performance.now();
    try {
      const response = await runtime.fetch!(first.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json(),
        choice = payload.choices?.[0];
      if (choice?.finish_reason !== 'stop' || !choice?.message?.content)
        throw new Error(`响应未完整结束：${choice?.finish_reason}`);
      const dataLines = (body.messages[1].content as string).split('\n').flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      const context = dataLines.find((d) => d && !Array.isArray(d) && 'previousCues' in d) as
        AiSubtitleContext | undefined;
      const nearby = dataLines.find((d) => d && !Array.isArray(d) && 'timing' in d)?.neighbors;
      if (!context || !nearby) throw new Error('请求缺少可还原的上下文。');
      const result = await translateFirstPass(window.tokens, context, nearby, async (stage) => {
        if (stage !== 'first-pass') throw new Error('此对照不追加内容恢复请求。');
        return choice.message.content;
      });
      active.cues = result.cues;
      active.status = result.missingTokenIds.length ? 'partial' : 'success';
      active.diagnostics = result.diagnostics.map((message) => ({ kind: 'fallback', message }));
    } catch (error) {
      active.status = 'failed';
      active.error = redact(String(error), secret);
    }
    active.durationMs = Math.round(performance.now() - begin);
    const originalCalls = prior.requests.filter((_, index) => index < 2);
    rows.push({
      windowId: window.id,
      startMs: window.startMs,
      endMs: window.endMs,
      sourceRequestId: first.id,
      promptHash: hash(first.request.messages),
      oldDurationMs: originalCalls.reduce((sum, r) => sum + r.durationMs, 0),
      oldUsage: originalCalls.reduce((sum, r) => sum + (r.usage?.total ?? 0), 0),
      oldRequestCount: originalCalls.length,
      direct: active,
    });
    await writeJson(
      path.join(directory, 'result.json'),
      { rows, newRequests: budget.used },
      secret,
    );
    console.info(
      JSON.stringify({
        startMs: window.startMs,
        status: active.status,
        oldMs: rows.at(-1)!.oldDurationMs,
        newMs: active.durationMs,
        oldTokens: rows.at(-1)!.oldUsage,
        newTokens: active.requests[0]?.usage?.total,
      }),
    );
    if (active.status === 'failed') break;
  }
}
main().catch((error) => {
  console.error(redact(String(error), secret));
  process.exitCode = 1;
});
