import type { NormalizedCue, RawCue } from './types';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const NOISE_LABELS = new Set([
  'applause',
  'cheering',
  'inaudible',
  'laugh',
  'laughter',
  'laughs',
  'music',
  'noise',
  'silence',
  '掌声',
  '欢呼',
  '笑声',
  '音乐',
  '噪音',
]);

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (entity, body: string) => {
    if (body.startsWith('#')) {
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const digits = body.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function extractSpeaker(value: string): { speaker?: string; text: string } {
  const markerMatch = value.match(/^>{2,}\s*/u);
  if (!markerMatch) {
    return { text: value };
  }

  const withoutMarker = value.slice(markerMatch[0].length);
  const namedSpeaker = withoutMarker.match(/^([\p{L}\p{N}][\p{L}\p{N} ._-]{0,30}):\s+/u);

  if (namedSpeaker) {
    return {
      speaker: namedSpeaker[1]?.trim() || 'speaker-change',
      text: withoutMarker.slice(namedSpeaker[0].length),
    };
  }

  return { speaker: 'speaker-change', text: withoutMarker };
}

function normalizePunctuation(value: string): string {
  return value
    .replace(/\.{3,}/gu, '…')
    .replace(/([!?。！？,，])\1+/gu, '$1')
    .replace(/\s+([,.;:!?，。；：！？])/gu, '$1')
    .replace(/([（【])\s+/gu, '$1')
    .replace(/\s+([）】])/gu, '$1');
}

function isNoiseText(value: string): boolean {
  const match = value.match(/^\[\s*([^\]]+)\s*\]$/u);
  return match ? NOISE_LABELS.has(match[1]?.trim().toLowerCase() ?? '') : false;
}

export function normalizeCue(cue: RawCue): NormalizedCue {
  const decoded = decodeHtmlEntities(cue.text)
    .replace(/<br\s*\/?\s*>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  const speakerResult = extractSpeaker(decoded);
  const normalizedText = normalizePunctuation(speakerResult.text).trim();

  return {
    ...cue,
    normalizedText,
    sourceCueIds: [cue.id],
    ...(speakerResult.speaker ? { speaker: speakerResult.speaker } : {}),
    isNoise: isNoiseText(normalizedText),
  };
}

export function normalizeCues(cues: readonly RawCue[]): NormalizedCue[] {
  return cues.map(normalizeCue);
}
