import type { DisplayCue, SourceToken, TokenWindow } from '@cueweave/core/subtitle';
import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import { repairDisplayBoundaries } from './boundary-repair';
import type { JsonRequest } from './resilient-translation';
import { assertExactCoverage } from './window-experiment';

export function continuousWindowGroups(
  all: readonly SourceToken[],
  selected: readonly TokenWindow[],
) {
  const positions = new Map(all.map((token, index) => [token.id, index]));
  const ordered = [...selected].sort(
    (a, b) =>
      (positions.get(a.tokens[0]?.id ?? '') ?? -1) - (positions.get(b.tokens[0]?.id ?? '') ?? -1),
  );
  const groups: TokenWindow[][] = [];
  let previousEnd = -2;
  for (const window of ordered) {
    const start = positions.get(window.tokens[0]?.id ?? '');
    if (start === undefined || !window.tokens.length)
      throw new Error('连续规划窗口不在原文中或为空。');
    const end = start + window.tokens.length - 1;
    assertExactCoverage(all.slice(start, end + 1), [window]);
    if (start <= previousEnd) throw new Error('连续规划包含重复或重叠窗口。');
    if (start === previousEnd + 1) groups.at(-1)!.push(window);
    else groups.push([window]);
    previousEnd = end;
  }
  return groups;
}

export interface JointBoundaryResult {
  rightTokenId: string;
  status: 'reviewed' | 'already-joined' | 'unavailable';
  result?: Awaited<ReturnType<typeof repairDisplayBoundaries>>;
}

export async function repairAcrossSeams(
  initial: readonly DisplayCue[],
  all: readonly SourceToken[],
  context: AiSubtitleContext,
  rightTokenIds: readonly string[],
  request: JsonRequest,
  checkpoint: (
    cues: DisplayCue[],
    details: JointBoundaryResult[],
  ) => Promise<void> = async () => {},
) {
  let cues = [...initial];
  const details: JointBoundaryResult[] = [];
  const sourcePositions = new Map(all.map((token, i) => [token.id, i]));
  const anchors = [...new Set(rightTokenIds)].sort(
    (a, b) => (sourcePositions.get(a) ?? -1) - (sourcePositions.get(b) ?? -1),
  );
  for (const [index, rightTokenId] of anchors.entries()) {
    const right = cues.findIndex((c) => c.sourceTokenIds.includes(rightTokenId));
    const position = sourcePositions.get(rightTokenId);
    if (right < 0 || position === undefined) {
      details.push({ rightTokenId, status: 'unavailable' });
    } else if (cues[right]!.sourceTokenIds[0] !== rightTokenId) {
      details.push({ rightTokenId, status: 'already-joined' });
    } else if (right === 0 || cues[right - 1]!.sourceTokenIds.at(-1) !== all[position - 1]?.id) {
      details.push({ rightTokenId, status: 'unavailable' });
    } else {
      const start = Math.max(0, right - 3),
        end = Math.min(cues.length, right + 3);
      const before = cues.slice(start, end);
      const result = await repairDisplayBoundaries(
        before,
        all,
        context,
        [all[position]!.startMs],
        (stage, prompt, schema) => request(`joint-${index}-${stage}`, prompt, schema),
      );
      // Both sides commit as one source span; stale cue indices are never reused after a merge.
      if (
        JSON.stringify(result.cues.flatMap((c) => c.sourceTokenIds)) !==
        JSON.stringify(before.flatMap((c) => c.sourceTokenIds))
      )
        throw new Error('跨窗修复改变了原文覆盖，未提交该范围。');
      cues = [...cues.slice(0, start), ...result.cues, ...cues.slice(end)];
      details.push({ rightTokenId, status: 'reviewed', result });
    }
    await checkpoint(cues, details);
  }
  return { cues, details };
}
