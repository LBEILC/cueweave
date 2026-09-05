import type { SourceToken, TokenWindow } from '@cueweave/core/subtitle';
import type { JsonRequest } from './resilient-translation';
import { parseSeam, seamPrompt, SEAM_SCHEMA } from './seam-planner';
import { assertExactCoverage, surroundingSource, type Episode } from './window-experiment';

export interface RollingStep {
  originalBoundaryMs: number;
  boundaryMs: number;
  reason: string;
  fallback?: string;
}

export async function planRollingSeams(
  episode: Episode,
  all: readonly SourceToken[],
  request: JsonRequest,
  checkpoint: (windows: TokenWindow[], steps: RollingStep[]) => Promise<void> = async () => {},
) {
  assertExactCoverage(episode.tokens, episode.windows);
  if (!episode.windows.length) throw new Error('滚动规划缺少窗口。');
  const committed: TokenWindow[] = [],
    steps: RollingStep[] = [];
  let pending = episode.windows[0]!;
  for (let index = 1; index < episode.windows.length; index++) {
    const next = episode.windows[index]!;
    const pair = {
      ...episode,
      windows: [pending, next],
      tokens: [...pending.tokens, ...next.tokens],
    };
    let windows = pair.windows;
    const step: RollingStep = {
      originalBoundaryMs: pending.endMs,
      boundaryMs: pending.endMs,
      reason: '',
    };
    try {
      const parsed = parseSeam(
        await request(
          'rolling-seam',
          seamPrompt(pair, surroundingSource(all, pair.tokens)),
          SEAM_SCHEMA,
        ),
        pair,
      );
      windows = parsed.windows;
      step.boundaryMs = windows[0]!.endMs;
      step.reason = parsed.reasons[0]!;
    } catch (error) {
      step.fallback = error instanceof Error ? error.message : String(error);
    }
    committed.push(windows[0]!);
    // The right window is provisional; its right edge is planned with the next source window.
    pending = windows[1]!;
    steps.push(step);
    const snapshot = [...committed, pending, ...episode.windows.slice(index + 1)];
    assertExactCoverage(episode.tokens, snapshot);
    await checkpoint(snapshot, steps);
  }
  const windows = [...committed, pending];
  assertExactCoverage(episode.tokens, windows);
  return { windows, steps };
}
