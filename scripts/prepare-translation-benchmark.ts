import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceTokens, extractTranscriptEvidenceTerms } from '@cueweave/core/subtitle';
import { parseJson3Captions } from '../apps/extension/src/platform/youtube/captions';

interface Source {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channel: string;
  split: 'development' | 'holdout';
  genre: string;
  languageCode: string;
  trackKind: 'manual' | 'asr';
  rawPath: string;
  sha256: string;
}
interface Case {
  id: string;
  sourceId: string;
  label: string;
  fromMs: number;
  toMs: number;
  contextMs: number;
  tier: 'primary' | 'diagnostic';
  pairOf?: string;
  smoke: boolean;
  tags: string[];
  checks: string[];
}
interface Manifest {
  schema: number;
  version: string;
  sources: Source[];
  cases: Case[];
}

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestFile = path.join(root, 'test/benchmarks/translation/manifest.json');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const timestamp = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1_000)).padStart(2, '0')}`;

function localPath(relative: string): string {
  const resolved = path.resolve(root, relative);
  const inside = path.relative(root, resolved);
  assert(!inside.startsWith('..') && !path.isAbsolute(inside), `路径不在项目内：${relative}`);
  return resolved;
}

async function main(): Promise<void> {
  const [command = 'check', ...args] = process.argv.slice(2);
  assert(['build', 'check', 'list'].includes(command), '命令必须是 build、check 或 list');
  assert(
    args.length === 0 || (args.length === 2 && args[0] === '--out'),
    '用法：node --import tsx scripts/prepare-translation-benchmark.ts build|check|list [--out .fixtures/translation-benchmark/v1]',
  );
  const output = localPath(args[1] ?? '.fixtures/translation-benchmark/v1');
  assert(
    path.relative(root, output).replaceAll('\\', '/').startsWith('.fixtures/'),
    '测试字幕产物必须放在 Git 忽略的 .fixtures/ 下',
  );
  const manifestText = await readFile(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText) as Manifest;
  assert(manifest.schema === 1 && manifest.sources.length > 0, '测试集清单格式无效');
  const sourceIds = new Set<string>();
  const splits = new Map<string, string>();
  for (const source of manifest.sources) {
    assert(!sourceIds.has(source.id), `重复来源：${source.id}`);
    sourceIds.add(source.id);
    assert(/^[A-Za-z0-9_-]{11}$/u.test(source.videoId), '无效 YouTube ID');
    assert(['development', 'holdout'].includes(source.split), '无效数据划分');
    assert(['manual', 'asr'].includes(source.trackKind), '无效字幕来源类型');
    assert(
      !splits.has(source.videoId) || splits.get(source.videoId) === source.split,
      `同一视频泄漏到不同划分：${source.videoId}`,
    );
    splits.set(source.videoId, source.split);
  }
  const caseIds = new Set<string>();
  for (const sample of manifest.cases) {
    assert(/^[a-z0-9-]+$/u.test(sample.id) && !caseIds.has(sample.id), '无效或重复片段 ID');
    caseIds.add(sample.id);
    assert(sourceIds.has(sample.sourceId), `未知来源：${sample.sourceId}`);
    assert(
      [sample.fromMs, sample.toMs, sample.contextMs].every(Number.isSafeInteger) &&
        sample.fromMs >= 0 &&
        sample.toMs > sample.fromMs &&
        sample.contextMs >= 15_000,
      `无效片段范围：${sample.id}`,
    );
    assert(['primary', 'diagnostic'].includes(sample.tier), '无效片段层级');
    const source = manifest.sources.find((item) => item.id === sample.sourceId)!;
    assert(!sample.smoke || source.split === 'development', '冒烟测试不得包含保留集');
    assert(sample.checks.length > 0 && sample.tags.length > 0, '片段缺少评审标准');
    if (sample.tier === 'diagnostic') {
      const pair = manifest.cases.find((item) => item.id === sample.pairOf);
      assert(pair && pair.tier === 'primary', '对照片段缺少主样本');
      const pairSource = manifest.sources.find((item) => item.id === pair.sourceId)!;
      assert(
        source.videoId === pairSource.videoId &&
          sample.fromMs === pair.fromMs &&
          sample.toMs === pair.toMs,
        'ASR 对照必须来自同视频同时间范围',
      );
    }
    for (const other of manifest.cases) {
      if (other.id >= sample.id || other.sourceId !== sample.sourceId) continue;
      assert(
        sample.toMs <= other.fromMs || other.toMs <= sample.fromMs,
        `同来源计分片段重叠：${sample.id} / ${other.id}`,
      );
    }
  }
  if (command === 'list') {
    for (const sample of manifest.cases) {
      const source = manifest.sources.find((item) => item.id === sample.sourceId)!;
      console.log(
        `${source.split} / ${sample.tier} / ${sample.id}: ${timestamp(sample.fromMs)}–${timestamp(sample.toMs)} ${sample.label}`,
      );
    }
    return;
  }

  // Build full-track tokens first: preserve production rolling-caption deduplication and IDs.
  const sourceData = new Map<
    string,
    { tokens: ReturnType<typeof buildSourceTokens>; hasSegmentOffsets: boolean }
  >();
  for (const source of manifest.sources) {
    const raw = await readFile(localPath(source.rawPath));
    assert(hash(raw) === source.sha256, `原始字幕指纹不匹配：${source.id}；不得静默换用新轨道`);
    const payload = JSON.parse(raw.toString('utf8')) as Parameters<typeof parseJson3Captions>[0];
    const tokens = buildSourceTokens(parseJson3Captions(payload));
    assert(
      tokens.length > 0 && new Set(tokens.map((token) => token.id)).size === tokens.length,
      '原文词元为空或重复',
    );
    assert(
      tokens.every((token) => Number.isFinite(token.startMs) && token.endMs > token.startMs),
      '词元时间无效',
    );
    sourceData.set(source.id, {
      tokens,
      hasSegmentOffsets: Boolean(
        payload.events?.some((event) =>
          event.segs?.some((segment) => (segment.tOffsetMs ?? 0) > 0),
        ),
      ),
    });
  }
  const files = new Map<string, string>();
  const records: object[] = [];
  const review = [
    '# 翻译测试集 v1：本地原文审阅',
    '',
    '计分范围之外的前后词元只用于上下文。这里没有模型译文或标准答案。',
    '',
  ];
  for (const sample of manifest.cases) {
    const source = manifest.sources.find((item) => item.id === sample.sourceId)!;
    const data = sourceData.get(source.id)!;
    // Membership is determined by token start time, half-open [fromMs, toMs).
    const score = data.tokens.filter(
      (token) => token.startMs >= sample.fromMs && token.startMs < sample.toMs,
    );
    assert(score.length >= 10, `片段词元不足：${sample.id}`);
    assert(sample.toMs <= data.tokens.at(-1)!.endMs, `片段超出字幕范围：${sample.id}`);
    const first = data.tokens.findIndex((token) => token.id === score[0]!.id);
    const last = data.tokens.findIndex((token) => token.id === score.at(-1)!.id);
    assert(last - first + 1 === score.length, `计分词元不连续：${sample.id}`);
    const before = data.tokens
      .slice(0, first)
      .filter((token) => token.endMs > sample.fromMs - sample.contextMs);
    const after = data.tokens
      .slice(last + 1)
      .filter((token) => token.startMs < sample.toMs + sample.contextMs);
    const tokens = [...before, ...score, ...after];
    assert(before.length > 0 && after.length > 0, `缺少双侧上下文：${sample.id}`);
    const input = {
      schema: 1,
      sourceId: source.id,
      videoId: source.videoId,
      languageCode: source.languageCode,
      trackKind: source.trackKind,
      timing: data.hasSegmentOffsets
        ? 'segment-offsets-with-possible-interpolation'
        : 'cue-times-with-interpolated-tokens',
      sourceSha256: source.sha256,
      scoreRange: { fromMs: sample.fromMs, toMs: sample.toMs, membership: 'token-start-half-open' },
      scoreTokenIds: score.map((token) => token.id),
      tokens,
      context: {
        videoTitle: source.title,
        channelName: source.channel,
        transcriptEvidence: extractTranscriptEvidenceTerms(tokens),
        terminology: [],
        entityAliases: [],
        previousCues: [],
        correctionEnabled: true,
      },
    };
    const content = json(input);
    files.set(`cases/${sample.id}.input.json`, content);
    records.push({
      id: sample.id,
      split: source.split,
      tier: sample.tier,
      smoke: sample.smoke,
      input: `cases/${sample.id}.input.json`,
      sha256: hash(content),
      scoreTokens: score.length,
      contextTokens: before.length + after.length,
      nominalDurationMs: sample.toMs - sample.fromMs,
      actualScoreStartMs: score[0]!.startMs,
      actualScoreEndMs: score.at(-1)!.endMs,
      referenceStatus: 'source-text-reviewed; no-human-translation-gold; audio-not-audited',
    });
    files.set(
      `cases/${sample.id}.review.json`,
      json({
        id: sample.id,
        label: sample.label,
        tags: sample.tags,
        checks: sample.checks,
        pairOf: sample.pairOf ?? null,
        translationGold: null,
        reviewer: null,
        semanticErrors: null,
        entityNumberErrors: null,
        boundaryErrors: null,
        fluencyScore: null,
        preference: null,
        notes: '',
      }),
    );
    review.push(
      `## ${sample.id} · ${sample.label} · ${source.split} / ${sample.tier}`,
      '',
      `[${source.title}](${source.url}&t=${Math.floor(sample.fromMs / 1000)}s)`,
      '',
      `前文：${before.map((token) => token.text).join(' ')}`,
      '',
      `计分原文：${score.map((token) => token.text).join(' ')}`,
      '',
      `后文：${after.map((token) => token.text).join(' ')}`,
      '',
      ...sample.checks.map((check) => `- ${check}`),
      '',
    );
  }
  files.set('REVIEW.md', `${review.join('\n')}\n`);
  files.set(
    'index.json',
    json({
      schema: 1,
      version: manifest.version,
      manifestSha256: hash(manifestText),
      parserSha256: hash(
        await readFile(path.join(root, 'apps/extension/src/platform/youtube/captions.ts')),
      ),
      tokenBuilderSha256: hash(
        await readFile(path.join(root, 'packages/core/src/domain/subtitle/tokens.ts')),
      ),
      preprocessingSha256: Object.fromEntries(
        await Promise.all(
          [
            'scripts/prepare-translation-benchmark.ts',
            'packages/core/src/domain/subtitle/normalize.ts',
            'packages/core/src/domain/subtitle/dedupe.ts',
            'packages/core/src/domain/subtitle/evidence.ts',
          ].map(async (file) => [file, hash(await readFile(path.join(root, file)))]),
        ),
      ),
      cases: records,
    }),
  );
  if (command === 'build') {
    await mkdir(path.dirname(output), { recursive: true });
    // Never overwrite a frozen dataset or its review records.
    await mkdir(output);
    await mkdir(path.join(output, 'cases'));
    for (const [name, content] of files)
      await writeFile(path.join(output, name), content, { flag: 'wx' });
  } else {
    for (const [name, content] of files) {
      // Review templates are editable annotations, not canonical model inputs.
      if (name.endsWith('.review.json')) continue;
      assert(
        (await readFile(path.join(output, name), 'utf8')) === content,
        `本地数据已变化：${name}；新建版本，勿覆盖旧快照`,
      );
    }
  }
  const primary = manifest.cases.filter((sample) => sample.tier === 'primary');
  const minutes = primary.reduce((sum, sample) => sum + sample.toMs - sample.fromMs, 0) / 60_000;
  console.log(
    `${command}: ${splits.size} 个视频，${primary.length} 个主样本，${manifest.cases.length - primary.length} 个对照样本，主样本 ${minutes.toFixed(2)} 分钟`,
  );
  console.log(`本地测试集：${output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
