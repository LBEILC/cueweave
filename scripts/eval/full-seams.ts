import { contextForWindow } from './runner';
import type { EvalRun } from './types';
import { assertExactCoverage, type Episode } from './window-experiment';

export function fullEpisodes(baseline: EvalRun): Episode[] {
  assertExactCoverage(baseline.tokens, baseline.windows);
  if (!baseline.tokens.length) throw new Error('全片评测没有字幕词元。');
  // Fix video evidence and aliases, but do not feed historical Chinese translations into this run.
  const context = contextForWindow({ ...baseline, windows: [], results: {} }, 0);
  const episodes: Episode[] = [];
  for (let index = 0; index < baseline.windows.length; index += 2) {
    const windows = baseline.windows.slice(index, index + 2);
    const tokens = windows.flatMap((w) => w.tokens);
    const id = `pair-${index / 2 + 1}`;
    episodes.push({
      id,
      windows,
      tokens,
      context,
      review: {
        id,
        label: `字幕组 ${index / 2 + 1}`,
        startMs: tokens[0]!.startMs,
        endMs: tokens.at(-1)!.endMs,
        review: '',
      },
    });
  }
  assertExactCoverage(
    baseline.tokens,
    episodes.flatMap((e) => e.windows),
  );
  return episodes;
}

export async function runWorkers<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('并发数必须为 1—4。');
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        await work(item);
      }
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
