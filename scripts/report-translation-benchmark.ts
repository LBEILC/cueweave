import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { DisplayCue, SourceToken } from '@cueweave/core/subtitle';
import { hash, PROJECT_ROOT, writeJson } from './eval/io';
import { writeFile } from 'node:fs/promises';

interface Reference {
  id: string;
  label: string;
  inputSha256: string;
  referenceTranslation: string;
  meaningUnits: Array<{ id: string; meaning: string }>;
  acceptableVariants: string[];
  boundaryNotes: string[];
}
interface Judgment {
  id: string;
  meaningVerdicts: Array<'pass' | 'partial' | 'fail' | 'unavailable' | 'context-only'>;
  fluency: number;
  verdict: 'usable' | 'needs-polish' | 'needs-fix' | 'incomplete';
  notes: string;
  issues: Array<{
    category: string;
    severity: 'major' | 'minor';
    cueIndices: number[];
    observation: string;
  }>;
}
interface SummaryRow {
  id: string;
  split: string;
  tier: string;
  videoId: string;
  status: string;
  verdict: Judgment['verdict'];
  meaningTally: Record<Judgment['meaningVerdicts'][number], number>;
  possible: number;
  fluency: number;
  scoredCues: number;
  fullyScoredCues: number;
  displayWarningCues: number;
  missingScoreTokens: number;
  issues: Judgment['issues'];
}

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    references: {
      type: 'string',
      default: '.fixtures/translation-benchmark/references/v1/references.json',
    },
    judgments: { type: 'string' },
    out: { type: 'string' },
  },
});
async function main(): Promise<void> {
  if (!values.run || !values.judgments || !values.out)
    throw new Error('需要 --run、--judgments、--out；这是离线报告工具，不调用模型');
  const directory = path.resolve(values.run);
  const output = path.resolve(values.out);
  if (!path.relative(PROJECT_ROOT, output).replaceAll('\\', '/').startsWith('.eval/'))
    throw new Error('评审产物必须保存在项目 .eval/ 下');
  const refText = await readFile(values.references, 'utf8');
  const refs = JSON.parse(refText) as { version: string; status: string; cases: Reference[] };
  const lock = JSON.parse(
    await readFile(path.join(path.dirname(values.references), 'reference-lock.json'), 'utf8'),
  ) as { sha256: string };
  if (lock.sha256 !== hash(refText)) throw new Error('参考译文已改变，不能冒充已冻结版本');
  const judgmentsText = await readFile(values.judgments, 'utf8');
  const review = JSON.parse(judgmentsText) as {
    runFingerprint: string;
    runResultSha256: string;
    referenceSha256: string;
    reviewer: string;
    cases: Judgment[];
  };
  const runText = await readFile(path.join(directory, 'result.json'), 'utf8');
  const run = JSON.parse(runText) as {
    fingerprint: string;
    status: string;
    identity: { model: string; entrypoint: string };
    selected: Array<{ id: string; split: string; tier: string }>;
    results: Record<
      string,
      Array<{
        status: string;
        inputSha256: string;
        cues: DisplayCue[];
        missingScoreTokens: string[];
        durationMs: number;
        attempts: Array<{ status: string; stages: string[]; error?: string }>;
      }>
    >;
  };
  if (
    run.status === 'running' ||
    run.fingerprint !== review.runFingerprint ||
    hash(refText) !== review.referenceSha256
  )
    throw new Error('评审与冻结的运行/参考不匹配，或运行尚未结束');
  if (review.runResultSha256 !== hash(runText))
    throw new Error('评审与运行输出快照不匹配；续跑或修改结果后需要重新评审');
  if (
    review.cases.length !== run.selected.length ||
    new Set(review.cases.map((c) => c.id)).size !== review.cases.length
  )
    throw new Error('评审存在缺失或重复片段');
  const runSummary = JSON.parse(
    await readFile(path.join(directory, 'summary.json'), 'utf8'),
  ) as object;
  const rows: SummaryRow[] = [];
  const sections: string[] = [];
  const label = {
    pass: '保留',
    partial: '部分保留',
    fail: '错误/遗漏',
    unavailable: '未产出',
    'context-only': '边界上下文，不计分',
  };
  const verdictLabel = {
    usable: '基本可用',
    'needs-polish': '需润色/展示优化',
    'needs-fix': '关键问题需修复',
    incomplete: '输出不完整',
  };
  for (const item of run.selected) {
    const ref = refs.cases.find((r) => r.id === item.id);
    const judgment = review.cases.find((r) => r.id === item.id);
    const result = run.results[item.id]?.at(-1);
    if (!ref || !judgment || !result) throw new Error(`缺少参考、结果或评审：${item.id}`);
    const inputText = await readFile(path.join(directory, 'inputs', `${item.id}.json`), 'utf8');
    if (hash(inputText) !== ref.inputSha256 || result.inputSha256 !== ref.inputSha256)
      throw new Error(`输入指纹不一致：${item.id}`);
    if (
      judgment.meaningVerdicts.length !== ref.meaningUnits.length ||
      judgment.meaningVerdicts.some((v) => !(v in label))
    )
      throw new Error(`语义要点评审数量或枚举错误：${item.id}`);
    if (!Number.isInteger(judgment.fluency) || judgment.fluency < 1 || judgment.fluency > 5)
      throw new Error('流畅度必须为 1–5 分');
    const input = JSON.parse(inputText) as {
      videoId: string;
      timing: string;
      tokens: SourceToken[];
      scoreTokenIds: string[];
    };
    const scored = new Set(input.scoreTokenIds);
    const cues = result.cues
      .map((cue, index) => ({ cue, index }))
      .filter(({ cue }) => cue.sourceTokenIds.some((id) => scored.has(id)));
    const fullyScored = cues.filter(({ cue }) => cue.sourceTokenIds.every((id) => scored.has(id)));
    const warnings = fullyScored.flatMap(({ cue, index }) => {
      const chars = Array.from(cue.translation.replace(/\s+/gu, '')).length;
      const ms = cue.endMs - cue.startMs;
      const reasons = [
        chars > 30 ? `${chars}字` : '',
        ms < 800 ? `${ms}ms闪现` : '',
        ms > 6500 ? `${(ms / 1000).toFixed(2)}秒长驻留` : '',
        chars / (ms / 1000) > 11 ? '每秒超过11字符' : '',
      ].filter(Boolean);
      return reasons.length ? [{ index, reasons }] : [];
    });
    const tally = { pass: 0, partial: 0, fail: 0, unavailable: 0, 'context-only': 0 };
    judgment.meaningVerdicts.forEach((v) => tally[v]++);
    const possible = ref.meaningUnits.length - tally['context-only'];
    if (result.status !== 'success' && judgment.verdict !== 'incomplete')
      throw new Error('不完整输出不能标记可用');
    for (const issue of judgment.issues)
      if (
        issue.cueIndices.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= result.cues.length)
      )
        throw new Error(`无效证据字幕索引：${item.id}`);
    rows.push({
      id: item.id,
      split: item.split,
      tier: item.tier,
      videoId: input.videoId,
      status: result.status,
      verdict: judgment.verdict,
      meaningTally: tally,
      possible,
      fluency: judgment.fluency,
      scoredCues: cues.length,
      fullyScoredCues: fullyScored.length,
      displayWarningCues: warnings.length,
      missingScoreTokens: result.missingScoreTokens.length,
      issues: judgment.issues,
    });
    sections.push(
      `## ${item.id} · ${ref.label}`,
      '',
      `结论：${verdictLabel[judgment.verdict]}。参考语义要点 ${tally.pass}/${possible} 完整保留，${tally.partial} 项部分保留，${tally.fail} 项错误/遗漏，${tally.unavailable} 项因未产出无法评价；已有译文流畅度 ${judgment.fluency}/5。`,
      '',
      judgment.notes,
      '',
      '### 参考译文',
      '',
      ref.referenceTranslation,
      '',
      '### 逐项核对',
      '',
      ...ref.meaningUnits.map(
        (unit, i) => `- **${label[judgment.meaningVerdicts[i]!]}**：${unit.meaning}`,
      ),
      '',
      '### 发现的问题',
      '',
      ...(judgment.issues.length
        ? judgment.issues.map(
            (issue) =>
              `- **${issue.severity} / ${issue.category}**${issue.cueIndices.length ? `（字幕索引 ${issue.cueIndices.join('、')}）` : ''}：${issue.observation}`,
          )
        : ['未发现需要单列的错误。']),
      '',
      '### 模型最终输出与对应原文',
      '',
      ...cues.flatMap(({ cue, index }) => [
        `**[${index}] ${(cue.startMs / 1000).toFixed(2)}–${(cue.endMs / 1000).toFixed(2)} 秒**`,
        '',
        `原文：${cue.sourceText}`,
        '',
        `译文：${cue.translation}`,
        '',
      ]),
      '### 参考边界与可接受变体',
      '',
      ...[...ref.acceptableVariants, ...ref.boundaryNotes].map((s) => `- ${s}`),
      '',
      `仅完全落在计分范围内的字幕计展示风险：${warnings.length}/${fullyScored.length}。风险不是语义错误；${input.timing} 不能证明实测音画同步。`,
      '',
      ...warnings.map((w) => `- 字幕 ${w.index}：${w.reasons.join('；')}`),
      '',
      ...result.attempts.filter((a) => a.error).map((a) => `- 运行失败证据：${a.error}`),
      '',
    );
  }
  const primary = rows.filter((r) => r.tier === 'primary');
  const sum = (items: typeof rows) => ({
    cases: items.length,
    complete: items.filter((r) => r.status === 'success').length,
    meaningPass: items.reduce((s, r) => s + r.meaningTally.pass, 0),
    meaningPossible: items.reduce((s, r) => s + r.possible, 0),
    partial: items.reduce((s, r) => s + r.meaningTally.partial, 0),
    fail: items.reduce((s, r) => s + r.meaningTally.fail, 0),
    unavailable: items.reduce((s, r) => s + r.meaningTally.unavailable, 0),
    displayWarningCues: items.reduce((s, r) => s + r.displayWarningCues, 0),
    fullyScoredCues: items.reduce((s, r) => s + r.fullyScoredCues, 0),
  });
  const summary = {
    referenceSha256: hash(refText),
    judgmentsSha256: hash(judgmentsText),
    reviewer: review.reviewer,
    runFingerprint: run.fingerprint,
    runResultSha256: hash(runText),
    runSummary,
    primary: sum(primary),
    development: sum(primary.filter((r) => r.split === 'development')),
    holdout: sum(primary.filter((r) => r.split === 'holdout')),
    diagnostic: sum(rows.filter((r) => r.tier === 'diagnostic')),
    cases: rows,
  };
  const md = [
    '# 当前翻译模型与算法：参考译文基线评审',
    '',
    `模型：${run.identity.model}。实际入口：${run.identity.entrypoint}。参考版本：${refs.version}。`,
    '',
    '参考译文由助手先行冻结，本报告也是助手逐条评审，未经过独立人工复核。原文是最终依据；不是逐字相似度评分，也不是通用准确率。计分边界外的补全不额外要求。',
    '',
    '这是一次运行的快照。候选原始响应与最终交付不同：表格评最终交付，数字校验误拦截等原因另行说明。流畅度只评价已有译文，不抵消未产出或关键错误。',
    '',
    `主集完整产出 ${summary.primary.complete}/${summary.primary.cases}；参考要点完整保留 ${summary.primary.meaningPass}/${summary.primary.meaningPossible}，部分保留 ${summary.primary.partial}，错误/遗漏 ${summary.primary.fail}，未产出 ${summary.primary.unavailable}。`,
    '',
    '| 片段 | 划分 | 结论 | 完整保留要点 | 译文流畅度 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.split}/${r.tier} | ${verdictLabel[r.verdict]} | ${r.meaningTally.pass}/${r.possible} | ${r.fluency}/5 |`,
    ),
    '',
    '主集与 ASR 诊断集分别汇总，避免同内容重复计权。切片计数及每段语义要点数量不同，不能直接将汇总比例视为跨领域模型准确率。',
    '',
    ...sections,
  ];
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await writeJson(path.join(output, 'summary.json'), summary);
  await writeFile(path.join(output, 'REPORT.md'), md.join('\n') + '\n');
  console.log(
    JSON.stringify({
      primary: summary.primary,
      diagnostic: summary.diagnostic,
      report: path.join(output, 'REPORT.md'),
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
