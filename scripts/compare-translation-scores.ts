import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { hash, PROJECT_ROOT } from './eval/io';
import { type aggregateScores, TRANSLATION_RUBRIC_HASH } from './eval/translation-scoring';

type Group = ReturnType<typeof aggregateScores>;
interface Summary {
  rubricSha256: string;
  referenceSha256: string;
  runIdentity: { model: string; mode?: string; entrypoint: string };
  reviewer: string;
  reviewerType: string;
  runFingerprint: string;
  quality: Record<string, Group>;
  runSummary: { requestCount?: number };
  cases: Array<{
    id: string;
    inputSha256: string;
    videoId: string;
    split: string;
    tier: string;
    durationMs: number;
    firstUsableMs: number | null;
  }>;
}
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' } },
});
const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return (s[Math.floor(s.length / 2)]! + s[Math.floor((s.length - 1) / 2)]!) / 2;
};
const text = (value: string) => value.replace(/[|\r\n]/gu, ' ');
async function main() {
  if (!values.out || positionals.length < 2)
    throw new Error('需要 --out .eval/<新目录> 和至少两份已评分报告目录');
  const out = path.resolve(values.out);
  if (!path.relative(PROJECT_ROOT, out).replaceAll('\\', '/').startsWith('.eval/'))
    throw new Error('比较报告必须保存在 .eval/ 下');
  const reports = await Promise.all(
    positionals.map(async (directory) => ({
      directory,
      report: JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8')) as Summary,
    })),
  );
  const scope = (r: Summary) =>
    hash(
      r.cases
        .map(({ id, inputSha256, videoId, split, tier }) => ({
          id,
          inputSha256,
          videoId,
          split,
          tier,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  for (const { report } of reports) {
    if (report.rubricSha256 !== TRANSLATION_RUBRIC_HASH || !report.quality)
      throw new Error('只能比较同一评分标准的正式报告，不能把历史未评分报告当作零分');
    if (
      report.referenceSha256 !== reports[0]!.report.referenceSha256 ||
      scope(report) !== scope(reports[0]!.report)
    )
      throw new Error('参考、输入或计分范围不一致，不能比较总分');
  }
  const lines = [
    '# 翻译核心质量对照',
    '',
    '同一评分标准与输入范围；模型、策略与评审者可能不同，见每行及完整 JSON。每份报告单列，不挑最好轮次、不混合评审者分数。分数不是准确率，严重错误与不完整结果单列；耗时为离线串行测量。',
    '',
    '| 候选 | 评审来源 | 范围 | 视频宏平均 /100 | critical / major / minor | 不完整 / 需修复片段 |',
    '| --- | --- | --- | ---: | --- | --- |',
  ];
  const details: string[] = [];
  for (const { directory, report } of reports) {
    for (const [groupName, group] of Object.entries(report.quality)) {
      if (!group.cases) continue;
      lines.push(
        `| ${text(`${report.runIdentity.model} / ${report.runIdentity.mode ?? report.runIdentity.entrypoint}`)} | ${text(`${report.reviewerType}: ${report.reviewer}`)} | ${groupName} | ${group.total === null ? '不可给分' : group.total.toFixed(2)} | ${group.critical} / ${group.major} / ${group.minor} | ${group.incompleteCases} / ${group.needsFixCases} |`,
      );
    }
    details.push(
      '',
      `来源：${text(directory)}；运行 ${report.runFingerprint}。首次可用中位 ${median(report.cases.flatMap((c) => (c.firstUsableMs === null ? [] : [c.firstUsableMs]))) ?? '无'} ms；首次可用记录 ${report.cases.filter((c) => c.firstUsableMs !== null).length}/${report.cases.length}；整段耗时中位 ${median(report.cases.map((c) => c.durationMs)) ?? '无'} ms；全运行请求 ${report.runSummary.requestCount ?? '未记录'} 次。`,
      '',
    );
  }
  lines.push('', '## 运行与成本', ...details);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out);
  await writeFile(path.join(out, 'REPORT.md'), lines.join('\n') + '\n');
  await writeFile(
    path.join(out, 'comparison.json'),
    JSON.stringify({ rubricSha256: TRANSLATION_RUBRIC_HASH, reports }, null, 2) + '\n',
  );
  console.log(path.join(out, 'REPORT.md'));
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
