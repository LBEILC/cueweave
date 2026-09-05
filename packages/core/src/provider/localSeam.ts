import type { SourceToken } from '../domain/subtitle/types';

/** Cheap source-only seam adjustment. This is a heuristic, not a semantic guarantee. */
export function localPlaybackSeam(tokens: readonly SourceToken[], original: number): number {
  return localPlaybackSeamDecision(tokens, original).cut;
}

export function localPlaybackSeamDecision(
  tokens: readonly SourceToken[],
  original: number,
): { cut: number; confident: boolean } {
  let best = original;
  let bestScore = 0;
  const anchor = tokens[original - 1];
  if (!anchor || original >= tokens.length) return { cut: original, confident: false };
  for (
    let cut = Math.max(1, original - 30);
    cut <= Math.min(tokens.length - 1, original + 30);
    cut++
  ) {
    const left = tokens[cut - 1]!;
    const right = tokens[cut]!;
    const distance = Math.abs(left.endMs - anchor.endMs);
    if (distance > 8000 || cut > 180 || tokens.length - cut > 180) continue;
    const beforeMs = left.endMs - tokens[0]!.startMs;
    const afterMs = tokens.at(-1)!.endMs - right.startMs;
    if (beforeMs < 12000 || afterMs < 12000 || beforeMs > 45000 || afterMs > 45000) continue;
    const word = left.text.toLowerCase().replace(/[^a-z]/g, '');
    if (
      /^(?:a|an|the|to|of|for|with|by|and|or|if|not|can|could|would|should|may|might|will|gonna)$/.test(
        word,
      )
    )
      continue;
    const strong =
      /[.!?]["'”’)]*$/.test(left.text) &&
      !/^(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|e\.g|i\.e|[A-Z])\.$/iu.test(left.text);
    const soft = /[,;:]["'”’)]*$/.test(left.text);
    const gap = right.startMs - left.endMs;
    const score = (strong ? 100 : soft ? 45 : gap >= 350 ? 25 : 0) - distance / 250;
    if (score > bestScore) {
      best = cut;
      bestScore = score;
    }
  }
  return { cut: best, confident: bestScore >= 65 };
}
