import type { SourceToken } from './types';

const TRANSCRIPT_EVIDENCE_STOP_WORDS = new Set([
  'A',
  'And',
  'But',
  'He',
  'I',
  'If',
  'It',
  'Like',
  'Mhm',
  'No',
  'Now',
  'Oh',
  'Okay',
  'Right',
  'She',
  'So',
  'That',
  'The',
  'Then',
  'There',
  'They',
  'This',
  'Uh',
  'Um',
  'We',
  'Well',
  'What',
  'When',
  'Where',
  'Which',
  'Who',
  'Why',
  'Yeah',
  'Yes',
  'You',
]);

export function extractTranscriptEvidenceTerms(
  tokens: readonly SourceToken[],
  limit = 80,
): string[] {
  const candidates = tokens.map((token) => {
    const match = token.text
      .normalize('NFKC')
      .match(/[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*/u)?.[0];
    return match &&
      !TRANSCRIPT_EVIDENCE_STOP_WORDS.has(match) &&
      (/[A-Z]/u.test(match) || /\d/u.test(match))
      ? match
      : undefined;
  });
  const counts = new Map<string, { value: string; count: number }>();
  const remember = (value: string | undefined) => {
    if (!value) return;
    const key = value.toLocaleLowerCase();
    const existing = counts.get(key);
    counts.set(key, { value: existing?.value ?? value, count: (existing?.count ?? 0) + 1 });
  };
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index];
    const next = candidates[index + 1];
    remember(current);
    if (current && next) remember(`${current} ${next}`);
  }
  return [...counts.values()]
    .filter((candidate) => candidate.count >= 2)
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, Math.max(0, limit))
    .map((candidate) => candidate.value);
}

function normalizedPhrase(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function extractUnitTechnicalEntities(sourceText: string): string[] {
  const entities = new Map<string, string>();
  const remember = (value: string | undefined) => {
    if (!value || TRANSCRIPT_EVIDENCE_STOP_WORDS.has(value)) return;
    const key = normalizedPhrase(value);
    if (key) entities.set(key, entities.get(key) ?? value);
  };

  const technicalContext =
    /\b(?:models?|versions?|famil(?:y|ies)|series|called|named|codenamed|products?|systems?)(?:\s+(?:of|called|named))?\s+([A-Z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*)/gu;
  for (const match of sourceText.matchAll(technicalContext)) remember(match[1]);

  const identifiers = sourceText.match(/[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*/gu) ?? [];
  for (const identifier of identifiers) {
    if (
      /[a-z][A-Z]/u.test(identifier) ||
      ((/[A-Z]/u.test(identifier) || /\d/u.test(identifier)) && /\d|[-_]/u.test(identifier)) ||
      (/[A-Z]/u.test(identifier) && /\./u.test(identifier))
    ) {
      remember(identifier);
    }
  }
  return [...entities.values()];
}
