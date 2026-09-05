import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { hash, PROJECT_ROOT } from './eval/io';
import {
  DIMENSIONS,
  TRANSLATION_RUBRIC,
  TRANSLATION_RUBRIC_HASH,
} from './eval/translation-scoring';

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    out: { type: 'string' },
    references: {
      type: 'string',
      default: '.fixtures/translation-benchmark/references/v1/references.json',
    },
  },
});
async function main() {
  if (!values.run || !values.out)
    throw new Error('需要 --run 和 --out .eval/<新目录>；只生成待填评审，不打分、不调用模型');
  const out = path.resolve(values.out);
  if (!path.relative(PROJECT_ROOT, out).replaceAll('\\', '/').startsWith('.eval/'))
    throw new Error('评审材料必须保存在 .eval/ 下');
  const runText = await readFile(path.join(values.run, 'result.json'), 'utf8');
  const run = JSON.parse(runText);
  if (!['completed', 'completed-with-errors'].includes(run.status)) throw new Error('运行尚未完成');
  const refText = await readFile(values.references!, 'utf8');
  const refs = JSON.parse(refText);
  const lock = JSON.parse(
    await readFile(path.join(path.dirname(values.references!), 'reference-lock.json'), 'utf8'),
  );
  if (lock.sha256 !== hash(refText)) throw new Error('参考快照与冻结哈希不匹配');
  const candidate = randomUUID();
  const cases = [];
  const templateCases = [];
  const seen = new Set<string>();
  for (const selected of run.selected) {
    if (
      typeof selected.id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/u.test(selected.id) ||
      seen.has(selected.id)
    )
      throw new Error('片段 ID 无效或重复');
    seen.add(selected.id);
    const ref = refs.cases.find((r: { id: string }) => r.id === selected.id);
    const result = run.results[selected.id]?.at(-1);
    const inputText = await readFile(
      path.join(values.run, 'inputs', `${selected.id}.json`),
      'utf8',
    );
    if (
      !ref ||
      !result ||
      hash(inputText) !== ref.inputSha256 ||
      result.inputSha256 !== ref.inputSha256
    )
      throw new Error(`输入/参考/结果不一致：${selected.id}`);
    const input = JSON.parse(inputText);
    cases.push({
      id: selected.id,
      timing: input.timing,
      tokens: input.tokens,
      scoreTokenIds: input.scoreTokenIds,
      reference: {
        referenceTranslation: ref.referenceTranslation,
        meaningUnits: ref.meaningUnits,
        acceptableVariants: ref.acceptableVariants,
        boundaryNotes: ref.boundaryNotes,
      },
      cues: result.cues.map(
        (
          cue: {
            sourceTokenIds: string[];
            sourceText: string;
            originalText?: string;
            translation: string;
            startMs: number;
            endMs: number;
          },
          index: number,
        ) => ({
          index,
          sourceTokenIds: cue.sourceTokenIds,
          sourceText: cue.sourceText,
          originalText: cue.originalText,
          translation: cue.translation,
          startMs: cue.startMs,
          endMs: cue.endMs,
        }),
      ),
    });
    templateCases.push({
      id: selected.id,
      meaningVerdicts: ref.meaningUnits.map(() => null),
      notes: '',
      issues: [],
      scoreCard: {
        ratings: Object.fromEntries(
          DIMENSIONS.map((d) => [d, { level: null, rationale: '', issueIds: [] }]),
        ),
        issues: [],
      },
    });
  }
  if (!cases.length) throw new Error('没有评审片段');
  const packet = {
    candidate,
    rubric: TRANSLATION_RUBRIC,
    rubricSha256: TRANSLATION_RUBRIC_HASH,
    referenceStatus: refs.status,
    instructions:
      '原文为最终依据；只评 scoreTokenIds，其他来源仅作上下文。等级有证据才填写，缺失不是满分。隐去档位、模型、耗时和处理过程；这只是匿名材料，独立评审与候选随机呈现由评审组织者负责。',
    cases,
  };
  const template = {
    rubricVersion: TRANSLATION_RUBRIC.version,
    rubricSha256: TRANSLATION_RUBRIC_HASH,
    reviewStatus: 'draft',
    reviewer: '',
    reviewerType: null,
    candidate,
    runFingerprint: run.fingerprint,
    runResultSha256: hash(runText),
    referenceSha256: hash(refText),
    cases: templateCases,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out);
  await writeFile(path.join(out, 'packet.json'), JSON.stringify(packet, null, 2) + '\n');
  await writeFile(
    path.join(out, 'judgments.template.json'),
    JSON.stringify(template, null, 2) + '\n',
  );
  await writeFile(
    path.join(out, 'coordinator.json'),
    JSON.stringify(
      {
        candidate,
        runDirectory: path.resolve(values.run),
        identity: run.identity,
        packetSha256: hash(packet),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `已生成 ${cases.length} 段待填评审；仅向评审者提供 packet.json 和 judgments.template.json，不提供 coordinator.json。`,
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
