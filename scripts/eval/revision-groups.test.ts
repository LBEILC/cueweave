import { expect, it } from 'vitest';
import { revisionGroups } from './revision-groups';

const units = Array.from({ length: 7 }, (_, i) => ({
  id: i + 10,
  source: `source ${i}`,
  translation: `draft ${i}`,
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
}));
it('partitions all IDs exactly once without renumbering and keeps drafts out of neighbors', () => {
  const groups = revisionGroups(units, { before: 'external before', after: 'external after' }, 3);
  expect(groups.map((g) => g.units.length)).toEqual([3, 3, 1]);
  expect(groups.flatMap((g) => g.units)).toEqual(units);
  expect(groups[0]!.neighbors.before).toBe('external before');
  expect(groups[1]!.neighbors).toEqual({ before: 'source 1 source 2', after: 'source 6' });
  expect(groups[2]!.neighbors.after).toBe('external after');
  expect(JSON.stringify(groups.map((g) => g.neighbors))).not.toContain('draft');
});
it('rejects invalid sizes and duplicate IDs instead of silently losing ownership', () => {
  for (const size of [0, -1, 1.5, NaN]) expect(() => revisionGroups(units, {}, size)).toThrow();
  expect(() => revisionGroups([units[0]!, units[0]!], {}, 3)).toThrow();
});
