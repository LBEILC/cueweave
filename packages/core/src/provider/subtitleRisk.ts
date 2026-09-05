import type { DisplayCue } from '../domain/subtitle/types';

const compact = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** Join only short, adjacent fragments; time and text budgets keep this a display repair. */
export function joinableSubtitleBoundary(left: DisplayCue, right: DisplayCue): boolean {
  if (
    right.startMs - left.endMs > 600 ||
    right.endMs - left.startMs > 8000 ||
    left.translation.length + right.translation.length > 72
  )
    return false;
  const a = left.sourceText.trim(),
    b = right.sourceText.trim();
  const filler = /^(?:mhm|uh|um|hmm|well)[.!?,]?$/iu.test(a);
  if (/[.!?]["'”’)]*$/u.test(a) && !filler) return false;
  const unfinished =
    /\b(?:and|or|but|because|although|if|that|which|who|to|of|for|with|by|is|are|was|were|be|been|can|may|might|will|would|should|could|not|a|an|the|gonna)[,;:]?$/iu.test(
      a,
    );
  const continuation = /^(?:against|of|with|from|to|for|into|about|than)\b/iu.test(b);
  return filler || unfinished || continuation || right.endMs - right.startMs < 800;
}

/** Risk hints only: never reject a translation based on a lexical heuristic. */
export function subtitleRevisionReasons(cues: readonly DisplayCue[]): string[] {
  const reasons: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    if (cue.endMs - cue.startMs > 10000 && cue.sourceText.split(/\s+/u).length >= 28)
      reasons.push(`条目 ${i} 时间范围超过 10 秒且原文较长，检查是否含多重命题或可共同分段的边界`);
    const next = cues[i + 1];
    if (!next) continue;
    const left = compact(cue.translation),
      right = compact(next.translation);
    const repeatedSource = cue.sourceText
      .toLowerCase()
      .split(/\s+/u)
      .some(
        (_, start, words) =>
          words.length - start >= 4 &&
          next.sourceText.toLowerCase().includes(words.slice(start, start + 4).join(' ')),
      );
    if (repeatedSource) continue;
    for (let start = 0; start <= left.length - 10; start++) {
      if (right.includes(left.slice(start, start + 10))) {
        reasons.push(`条目 ${i} 与 ${i + 1} 有较长相同译文，核对原文是否确实重复或含义被提前/延后`);
        break;
      }
    }
  }
  return reasons;
}
