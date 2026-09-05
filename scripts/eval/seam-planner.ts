import type { TokenWindow } from '@cueweave/core/subtitle';
import {
  parsePlan,
  plannerPrompt,
  PLAN_SCHEMA,
  type Episode,
  type surroundingSource,
} from './window-experiment';

export const SEAM_SCHEMA = {
  ...PLAN_SCHEMA,
  properties: { windows: { ...PLAN_SCHEMA.properties.windows, minItems: 2, maxItems: 2 } },
};

export function seamPrompt(
  episode: Episode,
  neighbors: ReturnType<typeof surroundingSource>,
): string {
  const cut = episode.windows[0]!.tokens.length - 1;
  return (
    plannerPrompt(episode.tokens, neighbors) +
    '\n\n本轮只修正两个翻译窗口之间的接缝，不对全文做多段规划。必须恰好返回两个窗口。目标是在原接缝附近找到最合适的语义结束位置，允许前移或后移。每窗至少 12 秒；上限仍为 45 秒及 180 个词元。不要为了让每个意群独立而额外拆小窗口。第一窗的结尾应避免剩下需要下文补全的动作或关系，但不必强求整个长论证都在一窗。\n' +
    JSON.stringify({ originalEndIndex: cut })
  );
}

export function parseSeam(
  content: string,
  episode: Episode,
): { windows: TokenWindow[]; reasons: string[] } {
  const plan = parsePlan(content, episode.tokens);
  if (plan.windows.length !== 2 || plan.windows.some((w) => w.endMs - w.startMs < 12_000))
    throw new Error('接缝规划必须保留两个不少于 12 秒的窗口。');
  return plan;
}
