import { describe, expect, it } from 'vitest';
import type { SourceToken } from '@cueweave/core/subtitle';
import {
  addSourceContext,
  assertExactCoverage,
  parsePlan,
  plannerPrompt,
  surroundingSource,
} from './window-experiment';

const tokens = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i}`,
  text: `w${i}`,
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
})) as SourceToken[];

describe('isolated semantic window experiment', () => {
  it('partitions exactly once without rewriting text or time', () => {
    const { windows } = parsePlan(
      JSON.stringify({
        windows: [
          { endIndex: 3, reason: 'clause' },
          { endIndex: 9, reason: 'end' },
        ],
      }),
      tokens,
    );
    expect(windows.map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 4000],
      [4000, 10000],
    ]);
    expect(() => assertExactCoverage(tokens, windows)).not.toThrow();
    expect(() => assertExactCoverage(tokens, [windows[0]!, windows[0]!])).toThrow();
  });
  it.each([[3, 3, 9], [9, 3], [10], [3], [-1, 9], [1.5, 9], []])(
    'rejects invalid ends %j',
    (...ends) => {
      expect(() =>
        parsePlan(
          JSON.stringify({ windows: ends.map((endIndex) => ({ endIndex, reason: 'x' })) }),
          tokens,
        ),
      ).toThrow();
    },
  );
  it('rejects request budgets instead of hiding failures behind fixed cuts', () => {
    expect(() =>
      parsePlan(
        '{"windows":[{"endIndex":9,"reason":"x"}]}',
        tokens.map((t) => ({ ...t, startMs: t.startMs * 6, endMs: t.endMs * 6 })),
      ),
    ).toThrow('预算');
  });
  it('keeps raw neighboring context separate from owned source', () => {
    expect(surroundingSource(tokens, tokens.slice(3, 6))).toEqual({
      before: 'w0 w1 w2',
      after: 'w6 w7 w8 w9',
    });
    expect(() => surroundingSource(tokens, [{ ...tokens[0]!, id: 'absent' }])).toThrow();
  });
  it('changes only user context, including for repair calls', () => {
    const body = {
      model: 'gemini-3.5-flash-lite',
      temperature: 0,
      messages: [
        { role: 'system', content: 'schema' },
        { role: 'user', content: 'original' },
      ],
    };
    const output = JSON.parse(
      addSourceContext(JSON.stringify(body), { before: 'before', after: 'after' }),
    );
    expect(output.model).toBe(body.model);
    expect(output.temperature).toBe(0);
    expect(output.messages[0]).toEqual(body.messages[0]);
    expect(output.messages[1].content).toContain('original');
    expect(output.messages[1].content).toContain('不得作为本次输出覆盖范围');
  });
  it('does not send review labels or reference translations to the planner', () => {
    const prompt = plannerPrompt(tokens, { before: '', after: '' });
    expect(prompt).not.toContain('confidently');
    expect(prompt).not.toContain('这样才能');
    expect(prompt).toContain('内部边界');
  });
});
