import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { hash, PROJECT_ROOT } from './eval/io';

interface Result {
  status: string;
  durationMs: number;
  firstUsableMs?: number;
  missingScoreTokens: string[];
  attempts: Array<{
    requests: Array<{ durationMs: number; usage?: { input: number; output: number } | null }>;
  }>;
}
interface Run {
  status: string;
  identity: {
    mode: string;
    model: string;
    baseUrl: string;
    protocol: string;
    pipelineHash: string;
    datasetHash: string;
    policyVersion: string;
  };
  selected: Array<{ id: string; sha256: string }>;
  results: Record<string, Result[]>;
}
const { values, positionals } = parseArgs({
  options: { out: { type: 'string' } },
  allowPositionals: true,
});
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    (sorted[Math.floor(sorted.length / 2)]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2
  );
};
async function main() {
  if (!values.out || positionals.length < 2)
    throw new Error('需要 --out .eval/<report.md> 和至少两个运行目录');
  const out = path.resolve(values.out);
  if (!path.relative(PROJECT_ROOT, out).replaceAll('\\', '/').startsWith('.eval/'))
    throw new Error('报告必须保存在 .eval/ 下');
  const runs = await Promise.all(
    positionals.map(async (directory) => ({
      directory,
      run: JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')) as Run,
    })),
  );
  const comparisonKey = (run: Run) => hash({ ...run.identity, mode: undefined });
  const expected = comparisonKey(runs[0]!.run);
  for (const { run } of runs) {
    if (
      !['speed', 'balanced', 'quality'].includes(run.identity.mode) ||
      !['completed', 'completed-with-errors'].includes(run.status)
    )
      throw new Error('只比较已完成的速度、均衡或质量运行');
    if (comparisonKey(run) !== expected || hash(run.selected) !== hash(runs[0]!.run.selected))
      throw new Error('输入、模型、源码或其他运行条件不同，不可合并比较');
  }
  if (new Set(runs.map(({ run }) => run.identity.mode)).size < 2)
    throw new Error('需要两个策略的结果');
  const rows = [
    '# 翻译策略对照',
    '',
    `模型：${runs[0]!.run.identity.model}。同输入、同源码；按下方列出的运行汇总。`,
    '',
    '表中为重复运行的中位数。首次可用表示离线串行流程首次返回字幕的时间；整段耗时包含规划和恢复。完整产出不代表语义正确，不能据此声称质量百分比或真实播放器等待时间。',
    '',
    '| 片段 | 策略 | 轮数 | 首次可用（秒） | 整段耗时（秒） | 请求数 | 完整产出 | 缺失计分词元 |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  const metrics = [];
  for (const selected of runs[0]!.run.selected) {
    for (const mode of ['speed', 'balanced', 'quality'].filter((mode) =>
      runs.some(({ run }) => run.identity.mode === mode),
    )) {
      const results = runs
        .filter(({ run }) => run.identity.mode === mode)
        .map(({ run }) => run.results[selected.id]?.at(-1));
      if (results.some((r) => !r)) throw new Error(`缺少片段 ${selected.id}`);
      const items = results as Result[];
      const item = {
        id: selected.id,
        mode,
        repeats: items.length,
        firstUsableMs: median(
          items.flatMap((r) => (r.firstUsableMs === undefined ? [] : [r.firstUsableMs])),
        ),
        durationMs: median(items.map((r) => r.durationMs)),
        requestCount: median(
          items.map((r) => r.attempts.reduce((sum, a) => sum + a.requests.length, 0)),
        ),
        complete: items.filter((r) => r.status === 'success').length,
        missingScoreTokens: items.reduce((sum, r) => sum + r.missingScoreTokens.length, 0),
      };
      metrics.push(item);
      rows.push(
        `| ${item.id} | ${mode} | ${item.repeats} | ${item.firstUsableMs === null ? '无' : (item.firstUsableMs / 1000).toFixed(2)} | ${(item.durationMs! / 1000).toFixed(2)} | ${item.requestCount} | ${item.complete}/${item.repeats} | ${item.missingScoreTokens} |`,
      );
    }
  }
  rows.push(
    '',
    '## 数据来源',
    '',
    ...positionals.map((p) => `- ${p}`),
    '',
    '语义质量需结合原文单独评审。本报告不调用模型，也不读取参考译文。',
    '',
  );
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, rows.join('\n'));
  await writeFile(`${out}.json`, JSON.stringify({ runs: positionals, metrics }, null, 2) + '\n');
  console.log(out);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
