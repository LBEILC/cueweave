/** Sparse, source-grounded edits. Evidence validation is structural, not a semantic judge. */
export const REVISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['edits'],
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'sourceQuote', 'problem', 'translation'],
        properties: {
          id: { type: 'integer', minimum: 0 },
          sourceQuote: { type: 'string', minLength: 1 },
          problem: { type: 'string', minLength: 1 },
          translation: { type: 'string', minLength: 1, maxLength: 96 },
        },
      },
    },
  },
};

export function applySubtitleReview(
  output: unknown,
  units: readonly { id: number; source: string; translation: string }[],
  verbatimTerms: readonly string[] = [],
): Map<number, string> {
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (
    !record(output) ||
    Object.keys(output).some((k) => k !== 'edits') ||
    !Array.isArray(output.edits)
  )
    throw new Error('对照修订必须返回 edits 数组。');
  const translations = new Map(units.map((u) => [u.id, u.translation]));
  const changed = new Set<number>();
  for (const edit of output.edits) {
    if (
      !record(edit) ||
      Object.keys(edit).some((k) => !['id', 'sourceQuote', 'problem', 'translation'].includes(k)) ||
      !Number.isSafeInteger(edit.id) ||
      changed.has(edit.id as number) ||
      typeof edit.sourceQuote !== 'string' ||
      !edit.sourceQuote.trim() ||
      typeof edit.problem !== 'string' ||
      !edit.problem.trim() ||
      typeof edit.translation !== 'string' ||
      !edit.translation.trim()
    )
      throw new Error('对照修订包含重复 ID、空译文或缺失问题证据。');
    const unit = units.find((u) => u.id === edit.id);
    if (!unit) throw new Error('对照修订引用了未知 ID。');
    changed.add(unit.id);
    // A byte-identical proposal is not a revision and needs no evidence to apply.
    if (unit.translation === edit.translation) continue;
    if (!unit.source.includes(edit.sourceQuote))
      throw new Error('对照修订引用了未知 ID 或不属于该条原文的证据。');
    if (copiesSourceOverChinese(unit, edit.translation, verbatimTerms))
      throw new Error('对照修订将已有中文译文退回整段英文原文，保留初稿。');
    translations.set(unit.id, edit.translation);
  }
  return translations;
}

/** A conservative regression guard, not a general detector of translation quality. */
export function copiesSourceOverChinese(
  unit: { source: string; translation: string },
  revised: string,
  verbatimTerms: readonly string[] = [],
): boolean {
  const normalize = (text: string) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  // Short names, technical identifiers and already-English drafts can legitimately stay verbatim.
  if (
    !/\p{Script=Han}/u.test(unit.translation) ||
    /\p{Script=Han}/u.test(revised) ||
    (unit.source.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu)?.length ?? 0) < 4
  )
    return false;
  const source = normalize(unit.source);
  return source === normalize(revised) && !verbatimTerms.some((term) => normalize(term) === source);
}
