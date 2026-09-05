export interface RevisionUnit {
  id: number;
  source: string;
  translation: string;
  startMs: number;
  endMs: number;
}

/** Disjoint editable groups; adjacent source is read-only and never carries draft translations. */
export function revisionGroups(
  units: readonly RevisionUnit[],
  neighbors: { before?: string; after?: string },
  size: number,
) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid review group size');
  if (new Set(units.map((u) => u.id)).size !== units.length)
    throw new Error('Duplicate review unit ID');
  const groups = [];
  for (let i = 0; i < units.length; i += size) {
    groups.push({
      units: units.slice(i, i + size),
      neighbors: {
        before:
          units
            .slice(Math.max(0, i - 2), i)
            .map((u) => u.source)
            .join(' ') ||
          neighbors.before ||
          '',
        after:
          units
            .slice(i + size, i + size + 2)
            .map((u) => u.source)
            .join(' ') ||
          neighbors.after ||
          '',
      },
    });
  }
  return groups;
}
