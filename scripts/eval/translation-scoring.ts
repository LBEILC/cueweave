import { hash } from './io';

/** A versioned internal rubric, not a human-calibrated accuracy metric. */
export const TRANSLATION_RUBRIC = {
  version: 'translation-quality-v1',
  status: 'provisional-not-human-calibrated',
  weights: { accuracy: 40, completeness: 25, alignment: 20, fluency: 15 },
  levels: {
    accuracy: [
      '核心意思普遍错误或无法理解',
      '核心命题翻错，含关键否定、条件、数字或对象错误',
      '至少一处实质含义错误，或多处局部偏差',
      '仅局部轻微含义偏差，不改变核心命题',
      '未发现实义错误，允许等价表达和保守保留不确定 ASR 名称',
    ],
    completeness: [
      '计分内容基本未表达',
      '大部分计分信息遗漏、增译或重复',
      '至少一项重要信息遗漏、增译或重复，或多项次要问题',
      '只有次要信息遗漏、增译或无意义重复',
      '计分范围的实际信息完整，无无依据增译或重复',
    ],
    alignment: [
      '来源归属或显示顺序普遍混乱，无法跟读',
      '多处明显跨条错位、说话人错配或不可读切分',
      '至少一处实质归属错位或明显妨碍跟读的切分',
      '轻微衔接或阅读节奏问题，不明显改变理解',
      '原文与译文逐条对应，切分和衔接可读；不等同于听音同步验收',
    ],
    fluency: [
      '中文基本不可理解',
      '大量不通顺表达，需要反复猜测',
      '多处明显生硬、指代或术语不一致，但大意可读',
      '少量生硬措辞或轻微不一致',
      '自然清楚且术语一致，不要求特定措辞风格',
    ],
  },
  severity: {
    minor: '局部表达或次要细节问题，不改变核心命题',
    major: '改变或遗漏实质信息，或明显破坏来源归属及阅读',
    critical: '翻反核心否定/条件、关键数字/主体等，使结论或行为理解反转',
  },
  formula: 'sum(level / 4 * weight); round only for display; no latency or cost in score',
  gates:
    'missing scored input => incomplete/no total; critical or major => needs-fix regardless of total; otherwise provisional quality bands',
  aggregation:
    'equal case mean within each video, then equal video mean; split/tier separate; any unscored case => no group total',
} as const;
export const TRANSLATION_RUBRIC_HASH = hash(TRANSLATION_RUBRIC);
export type Dimension = keyof typeof TRANSLATION_RUBRIC.weights;
export const DIMENSIONS = Object.keys(TRANSLATION_RUBRIC.weights) as Dimension[];
export interface ScoreIssue {
  id: string;
  dimensions: Dimension[];
  severity: 'minor' | 'major' | 'critical';
  sourceTokenIds: string[];
  cueIndices: number[];
  sourceQuote: string;
  translationQuote: string;
  explanation: string;
}
export interface ScoreCard {
  ratings: Record<Dimension, { level: number | null; rationale: string; issueIds: string[] }>;
  issues: ScoreIssue[];
}
export interface ScoringInput {
  tokens: Array<{ id: string; text: string }>;
  scoreTokenIds: string[];
}
export interface ScoringCue {
  sourceTokenIds: string[];
  translation: string;
}
const normalized = (s: string) => s.replace(/\s+/gu, ' ').trim();
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`评分校验：${message}`);
}
const unique = (items: unknown[]) => new Set(items).size === items.length;

export function scoreTranslation(card: ScoreCard, input: ScoringInput, cues: ScoringCue[]) {
  requireThat(card && card.ratings && Array.isArray(card.issues), '缺少 scoreCard');
  const tokenMap = new Map(input.tokens.map((t) => [t.id, t]));
  requireThat(
    input.scoreTokenIds.length &&
      unique(input.scoreTokenIds) &&
      input.scoreTokenIds.every((id) => tokenMap.has(id)),
    '计分来源范围无效',
  );
  requireThat(tokenMap.size === input.tokens.length, '输入来源 ID 重复');
  const scored = new Set(input.scoreTokenIds);
  const owners = new Map<string, number>();
  for (const cue of cues) {
    requireThat(
      Array.isArray(cue.sourceTokenIds) &&
        cue.sourceTokenIds.length &&
        cue.sourceTokenIds.every((id) => tokenMap.has(id)),
      '输出包含未知或空来源范围',
    );
    for (const id of cue.sourceTokenIds) owners.set(id, (owners.get(id) ?? 0) + 1);
  }
  requireThat(
    [...owners.values()].every((count) => count === 1),
    '输出重复覆盖来源，不能计算质量分',
  );
  const missingTokenIds = input.scoreTokenIds.filter((id) => !owners.has(id));
  const delivered = cues.some(
    (c) => c.sourceTokenIds.some((id) => scored.has(id)) && c.translation.trim(),
  );
  requireThat(
    cues.every((c) => c.translation.trim()),
    '输出包含空译文',
  );
  const byId = new Map<string, ScoreIssue>();
  for (const issue of card.issues) {
    requireThat(
      issue && typeof issue.id === 'string' && issue.id.trim() && !byId.has(issue.id),
      '问题 ID 为空或重复',
    );
    requireThat(
      Array.isArray(issue.dimensions) &&
        issue.dimensions.length &&
        unique(issue.dimensions) &&
        issue.dimensions.every((d) => DIMENSIONS.includes(d)),
      '问题维度无效',
    );
    requireThat(['minor', 'major', 'critical'].includes(issue.severity), '问题严重程度无效');
    requireThat(
      Array.isArray(issue.sourceTokenIds) &&
        issue.sourceTokenIds.length &&
        unique(issue.sourceTokenIds) &&
        issue.sourceTokenIds.every((id) => tokenMap.has(id)) &&
        issue.sourceTokenIds.some((id) => scored.has(id)),
      '问题必须关联计分原文，不能只扣上下文的分',
    );
    requireThat(
      Array.isArray(issue.cueIndices) &&
        unique(issue.cueIndices) &&
        issue.cueIndices.every((i) => Number.isInteger(i) && i >= 0 && i < cues.length),
      '问题字幕索引无效',
    );
    requireThat(
      typeof issue.sourceQuote === 'string' &&
        normalized(issue.sourceQuote) &&
        normalized(issue.sourceTokenIds.map((id) => tokenMap.get(id)!.text).join(' ')).includes(
          normalized(issue.sourceQuote),
        ),
      '原文证据与指定词元不符',
    );
    requireThat(
      typeof issue.translationQuote === 'string' &&
        typeof issue.explanation === 'string' &&
        issue.explanation.trim(),
      '缺少问题解释或译文证据',
    );
    if (issue.cueIndices.length) {
      requireThat(
        issue.cueIndices.some((i) =>
          cues[i]!.sourceTokenIds.some((id) => issue.sourceTokenIds.includes(id)),
        ),
        '译文证据与原文范围无关',
      );
      requireThat(
        normalized(issue.translationQuote) &&
          normalized(issue.cueIndices.map((i) => cues[i]!.translation).join(' ')).includes(
            normalized(issue.translationQuote),
          ),
        '译文引文与指定字幕不符',
      );
    } else {
      requireThat(
        issue.translationQuote === '' &&
          issue.sourceTokenIds.some((id) => missingTokenIds.includes(id)),
        '无字幕证据只能用于实际未产出的来源范围',
      );
    }
    byId.set(issue.id, issue);
  }
  requireThat(
    Object.keys(card.ratings).length === DIMENSIONS.length &&
      DIMENSIONS.every((d) => d in card.ratings),
    '必须包含且仅包含四个评分维度',
  );
  const points = {} as Record<Dimension, number | null>;
  for (const dimension of DIMENSIONS) {
    const rating = card.ratings[dimension];
    requireThat(
      rating &&
        typeof rating.rationale === 'string' &&
        rating.rationale.trim() &&
        Array.isArray(rating.issueIds) &&
        unique(rating.issueIds),
      `${dimension} 缺少评分依据`,
    );
    requireThat(
      rating.issueIds.every((id) => byId.has(id) && byId.get(id)!.dimensions.includes(dimension)),
      `${dimension} 引用未知或无关问题`,
    );
    if (!delivered && dimension !== 'completeness') {
      requireThat(rating.level === null, '无可用译文时不能评准确性、对应或自然度');
      points[dimension] = null;
      continue;
    }
    requireThat(
      Number.isInteger(rating.level) && rating.level! >= 0 && rating.level! <= 4,
      `${dimension} 必须完成 0–4 整数评分`,
    );
    if (!delivered) requireThat(rating.level === 0, '完全未产出时完整性为 0');
    if (dimension === 'completeness' && missingTokenIds.length)
      requireThat(rating.level! < 4, '有未产出来源时完整性不能满分');
    if (rating.level! < 4 && delivered)
      requireThat(rating.issueIds.length, `${dimension} 扣分必须关联证据`);
    for (const issue of card.issues.filter((i) => i.dimensions.includes(dimension))) {
      requireThat(rating.issueIds.includes(issue.id), `${dimension} 遗漏已记录问题`);
      const maximum = issue.severity === 'critical' ? 1 : issue.severity === 'major' ? 2 : 3;
      requireThat(rating.level! <= maximum, `${dimension} 分数与 ${issue.severity} 问题矛盾`);
    }
    points[dimension] = (rating.level! / 4) * TRANSLATION_RUBRIC.weights[dimension];
  }
  const total =
    missingTokenIds.length || !delivered
      ? null
      : DIMENSIONS.reduce((sum, d) => sum + points[d]!, 0);
  const critical = card.issues.filter((i) => i.severity === 'critical').length;
  const major = card.issues.filter((i) => i.severity === 'major').length;
  const minor = card.issues.filter((i) => i.severity === 'minor').length;
  const gate =
    total === null
      ? 'incomplete'
      : critical || major
        ? 'needs-fix'
        : total >= 90
          ? 'strong'
          : total >= 80
            ? 'usable'
            : total >= 70
              ? 'needs-improvement'
              : 'needs-fix';
  return {
    total,
    points,
    gate,
    critical,
    major,
    minor,
    missingTokenIds,
    coverage: (input.scoreTokenIds.length - missingTokenIds.length) / input.scoreTokenIds.length,
  };
}

export function aggregateScores(
  rows: Array<{ videoId: string; score: ReturnType<typeof scoreTranslation> }>,
) {
  const videos = [...new Set(rows.map((r) => r.videoId))].map((videoId) => {
    const cases = rows.filter((r) => r.videoId === videoId);
    return {
      videoId,
      cases: cases.length,
      total: cases.some((r) => r.score.total === null)
        ? null
        : cases.reduce((s, r) => s + r.score.total!, 0) / cases.length,
    };
  });
  return {
    cases: rows.length,
    videos,
    total:
      !videos.length || videos.some((v) => v.total === null)
        ? null
        : videos.reduce((s, v) => s + v.total!, 0) / videos.length,
    incompleteCases: rows.filter((r) => r.score.total === null).length,
    needsFixCases: rows.filter((r) => r.score.gate === 'needs-fix').length,
    critical: rows.reduce((s, r) => s + r.score.critical, 0),
    major: rows.reduce((s, r) => s + r.score.major, 0),
    minor: rows.reduce((s, r) => s + r.score.minor, 0),
  };
}
