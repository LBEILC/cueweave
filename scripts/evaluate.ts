import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import { DEFAULT_PROVIDER_SETTINGS, normalizeBaseUrl } from '@cueweave/core/provider/settings';
import { redact } from './eval/io';
import { runEvaluation } from './eval/runner';
import type { EvalCase } from './eval/types';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean' },
    input: { type: 'string' },
    run: { type: 'string' },
    model: { type: 'string' },
    'base-url': { type: 'string' },
    protocol: { type: 'string' },
    'token-file': { type: 'string' },
    mode: { type: 'string', default: 'pipeline' },
    context: { type: 'string' },
    cases: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    limit: { type: 'string' },
    'max-requests': { type: 'string', default: '600' },
    resume: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    left: { type: 'string' },
    right: { type: 'string' },
    out: { type: 'string' },
  },
});

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`缺少 ${flag}。运行 --help 查看用法。`);
  return value;
}
function positive(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error('窗口数量和请求上限必须是正整数。');
  return number;
}
function time(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/u.test(value))
    throw new Error('时间请使用秒数、mm:ss 或 hh:mm:ss。');
  return value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * 1000;
}
async function json(file: string | undefined): Promise<unknown> {
  return file ? JSON.parse(await readFile(file, 'utf8')) : undefined;
}
function contextFile(value: unknown): AiSubtitleContext {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('上下文文件必须是 JSON 对象。');
  const record = value as Record<string, unknown>;
  const allowed = [
    'videoTitle',
    'channelName',
    'videoDescription',
    'correctionEnabled',
    'terminology',
    'entityAliases',
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key)))
    throw new Error(`上下文仅接受：${allowed.join('、')}。评测标签不能作为上下文。`);
  for (const key of ['videoTitle', 'channelName', 'videoDescription']) {
    if (record[key] !== undefined && typeof record[key] !== 'string')
      throw new Error(`${key} 必须是字符串。`);
  }
  if (record.correctionEnabled !== undefined && typeof record.correctionEnabled !== 'boolean')
    throw new Error('correctionEnabled 必须是布尔值。');
  for (const key of ['terminology', 'entityAliases']) {
    const terms = record[key];
    if (
      terms !== undefined &&
      (!Array.isArray(terms) ||
        terms.some(
          (term) =>
            !term || typeof term.source !== 'string' || typeof term.translation !== 'string',
        ))
    )
      throw new Error(`${key} 必须是包含 source、translation 字符串的数组。`);
  }
  return record as AiSubtitleContext;
}
function caseFile(value: unknown): EvalCase[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        typeof item.label !== 'string' ||
        typeof item.review !== 'string' ||
        !Number.isFinite(item.startMs) ||
        !Number.isFinite(item.endMs) ||
        item.startMs < 0 ||
        item.endMs <= item.startMs ||
        ['required', 'forbidden'].some(
          (key) =>
            item[key] !== undefined &&
            (!Array.isArray(item[key]) ||
              item[key].some((text: unknown) => typeof text !== 'string')),
        ),
    )
  )
    throw new Error(
      '检查案例文件：每项需要 id、label、review、startMs、endMs，可选 required / forbidden 字符串数组。',
    );
  return value as EvalCase[];
}

let secret = '';
try {
  const command = positionals[0];
  if (values.help || !command) {
    console.info(
      `CueWeave 字幕评测\n\nrun --input <JSON3 fixture> --run <新目录> [--model <模型>] [--base-url <地址>]\n    [--protocol chat-completions|responses|auto] [--token-file <文件>]\n    [--mode pipeline|translation] [--context <JSON>] [--cases <JSON>]\n    [--from 13:00] [--to 14:00] [--limit 3] [--max-requests 600] [--resume] [--dry-run]\nreport --run <运行目录>\ncompare --left <运行A目录> --right <运行B目录> --out <新报告目录>\n\n密钥只读取 --token-file 或 CUEWEAVE_LLM_TOKEN 环境变量。\n续跑需保持原输入、模型、上下文、范围和源码不变。详见 docs/EVALUATION.md。`,
    );
  } else if (command === 'run') {
    const mode = values.mode;
    if (mode !== 'pipeline' && mode !== 'translation')
      throw new Error('--mode 请选择 pipeline 或 translation。');
    const protocol = values.protocol ?? 'chat-completions';
    if (!['chat-completions', 'responses', 'auto'].includes(protocol))
      throw new Error('--protocol 无效。');
    const baseUrl = normalizeBaseUrl(values['base-url'] ?? DEFAULT_PROVIDER_SETTINGS.baseUrl);
    const url = new URL(baseUrl);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Base URL 只接受 HTTP(S) 地址，不可包含账号、查询参数或片段。');
    if (!values['dry-run']) {
      secret = values['token-file']
        ? (await readFile(values['token-file'], 'utf8')).trim()
        : (process.env.CUEWEAVE_LLM_TOKEN ?? '').trim();
      if (!secret)
        throw new Error(
          '未提供密钥。请使用 --token-file 或 CUEWEAVE_LLM_TOKEN；检查范围可使用 --dry-run。',
        );
    }
    const fromMs = time(values.from, 0);
    const toMs = time(values.to, Infinity);
    if (fromMs >= toMs) throw new Error('--to 必须晚于 --from。');
    const directory = path.resolve(required(values.run, '--run'));
    const run = await runEvaluation({
      input: path.resolve(required(values.input, '--input')),
      directory,
      settings: {
        apiKey: secret,
        baseUrl,
        model: values.model ?? DEFAULT_PROVIDER_SETTINGS.model,
        protocol: protocol as 'chat-completions' | 'responses' | 'auto',
      },
      mode,
      context: contextFile(await json(values.context)),
      cases: caseFile(await json(values.cases)),
      fromMs,
      toMs,
      limit: positive(values.limit, Infinity),
      maxRequests: positive(values['max-requests'], 600),
      resume: values.resume ?? false,
      dryRun: values['dry-run'] ?? false,
    });
    if (run) {
      const { writeReport } = await import('./eval/report');
      await writeReport(directory);
      console.info(`评测状态：${run.status}。报告：${path.join(directory, 'report.html')}`);
      if (run.status !== 'completed') process.exitCode = 2;
    }
  } else if (command === 'report') {
    const { writeReport } = await import('./eval/report');
    await writeReport(path.resolve(required(values.run, '--run')));
  } else if (command === 'compare') {
    const { writeComparison } = await import('./eval/report');
    await writeComparison(
      path.resolve(required(values.left, '--left')),
      path.resolve(required(values.right, '--right')),
      path.resolve(required(values.out, '--out')),
    );
  } else throw new Error('未知命令。运行 --help 查看用法。');
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error), secret));
  process.exitCode = 1;
}
