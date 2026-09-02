import { deduplicateRollingCues } from './dedupe';
import { normalizeCues } from './normalize';
import type { DisplayCue, NormalizedCue, RawCue, SourceToken, TokenWindow } from './types';

const STRONG_ENDING = /[.!?。！？…]["'”’）】》]*$/u;
const SOFT_ENDING = /[,;:，；：]["'”’）】》]*$/u;
const NO_LEADING_SPACE = /^[,.;:!?，。；：！？…）】》]/u;
const BREAK_BEFORE = new Set([
  'and',
  'as',
  'because',
  'but',
  'if',
  'or',
  'so',
  'that',
  'then',
  'when',
  'while',
  'which',
  'who',
]);

interface DisplayLimits {
  maxCharacters: number;
  maxDurationMs: number;
}

const DEFAULT_DISPLAY_LIMITS: Readonly<DisplayLimits> = {
  maxCharacters: 84,
  maxDurationMs: 6_500,
};

function textParts(value: string): string[] {
  return value.split(/\s+/u).filter(Boolean);
}

function joinTokenText(tokens: readonly SourceToken[]): string {
  return tokens.reduce((result, token) => {
    if (!result) return token.text;
    return NO_LEADING_SPACE.test(token.text) ? `${result}${token.text}` : `${result} ${token.text}`;
  }, '');
}

function fallbackTokens(cue: NormalizedCue, parts: readonly string[]): SourceToken[] {
  const durationMs = Math.max(1, cue.endMs - cue.startMs);
  return parts.map((text, index) => {
    const startMs = cue.startMs + Math.floor((durationMs * index) / parts.length);
    const endMs = cue.startMs + Math.floor((durationMs * (index + 1)) / parts.length);
    return {
      id: `${cue.id}:token:${index}`,
      cueId: cue.id,
      startMs,
      endMs: Math.max(startMs + 1, endMs),
      text,
    };
  });
}

function tokensForCue(cue: NormalizedCue): SourceToken[] {
  const parts = textParts(cue.normalizedText);
  if (parts.length === 0) return [];

  if (cue.words?.length === parts.length) {
    return cue.words.map((word, index) => ({
      ...word,
      cueId: cue.id,
      text: parts[index] ?? word.text,
    }));
  }

  return fallbackTokens(cue, parts);
}

export function buildSourceTokens(cues: readonly RawCue[]): SourceToken[] {
  return deduplicateRollingCues(normalizeCues(cues)).flatMap(tokensForCue);
}

function splitSentences(tokens: readonly SourceToken[]): SourceToken[][] {
  const sentences: SourceToken[][] = [];
  let current: SourceToken[] = [];

  for (const token of tokens) {
    current.push(token);
    if (STRONG_ENDING.test(token.text)) {
      sentences.push(current);
      current = [];
    }
  }

  if (current.length > 0) sentences.push(current);
  return sentences;
}

function fits(tokens: readonly SourceToken[], limits: DisplayLimits): boolean {
  const first = tokens[0];
  const last = tokens.at(-1);
  if (!first || !last) return true;
  return (
    joinTokenText(tokens).length <= limits.maxCharacters &&
    last.endMs - first.startMs <= limits.maxDurationMs
  );
}

function chooseBreakIndex(tokens: readonly SourceToken[], maximumEnd: number): number {
  const minimumEnd = Math.max(1, Math.floor(maximumEnd * 0.45));
  let best = maximumEnd;

  for (let index = minimumEnd; index <= maximumEnd; index += 1) {
    const token = tokens[index - 1];
    const next = tokens[index];
    if (
      token &&
      (SOFT_ENDING.test(token.text) || BREAK_BEFORE.has(next?.text.toLocaleLowerCase() ?? ''))
    ) {
      best = index;
    }
  }

  return best;
}

function chunkSentence(tokens: readonly SourceToken[], limits: DisplayLimits): SourceToken[][] {
  const chunks: SourceToken[][] = [];
  let remaining = [...tokens];

  while (remaining.length > 0) {
    if (fits(remaining, limits)) {
      chunks.push(remaining);
      break;
    }

    let maximumEnd = 1;
    for (let end = 2; end <= remaining.length; end += 1) {
      if (!fits(remaining.slice(0, end), limits)) break;
      maximumEnd = end;
    }

    const breakIndex = chooseBreakIndex(remaining, maximumEnd);
    chunks.push(remaining.slice(0, breakIndex));
    remaining = remaining.slice(breakIndex);
  }

  return chunks;
}

export function createLocalDisplayCues(
  tokens: readonly SourceToken[],
  overrides: Partial<DisplayLimits> = {},
): DisplayCue[] {
  const limits = { ...DEFAULT_DISPLAY_LIMITS, ...overrides };
  const sentences = splitSentences(tokens);
  const displayCues: DisplayCue[] = [];

  for (const sentence of sentences) {
    const chunks = chunkSentence(sentence, limits);
    chunks.forEach((chunk, chunkIndex) => {
      const first = chunk[0];
      const last = chunk.at(-1);
      if (!first || !last) return;

      displayCues.push({
        id: `display:${first.id}:${last.id}`,
        sourceTokenIds: chunk.map((token) => token.id),
        startMs: first.startMs,
        endMs: last.endMs,
        sourceText: joinTokenText(chunk),
        translation: '',
        sentenceEnd: chunkIndex === chunks.length - 1,
        status: 'fallback',
      });
    });
  }

  return displayCues;
}

export function createTokenWindows(
  tokens: readonly SourceToken[],
  options: { targetTokens?: number; maxTokens?: number; maxDurationMs?: number } = {},
): TokenWindow[] {
  const targetTokens = options.targetTokens ?? 90;
  const maxTokens = options.maxTokens ?? 140;
  const maxDurationMs = options.maxDurationMs ?? 30_000;
  const windows: TokenWindow[] = [];
  let current: SourceToken[] = [];

  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (!first || !last) return;
    windows.push({
      id: `window:${first.id}:${last.id}`,
      startMs: first.startMs,
      endMs: last.endMs,
      tokens: current,
    });
    current = [];
  };

  for (const token of tokens) {
    current.push(token);
    const first = current[0];
    const reachedTarget = current.length >= targetTokens && STRONG_ENDING.test(token.text);
    const reachedHardLimit =
      current.length >= maxTokens || (first ? token.endMs - first.startMs >= maxDurationMs : false);
    if (reachedTarget || reachedHardLimit) flush();
  }

  flush();
  return windows;
}
