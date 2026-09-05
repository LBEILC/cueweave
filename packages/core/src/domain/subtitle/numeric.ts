const DIMENSIONS =
  /(?<![A-Za-z0-9_.-])\d+(?:\.\d+)?(?:\s*(?:[xX×乘]|by)\s*\d+(?:\.\d+)?)+(?![A-Za-z0-9_])/gu;

export function dimensionValues(text: string): string[] {
  return [...text.normalize('NFKC').matchAll(DIMENSIONS)].map((match) =>
    (match[0].match(/\d+(?:\.\d+)?/g) ?? []).map((value) => String(Number(value))).join('×'),
  );
}

/** Remove dimensions before Latin entity detection, never a suffix of a product identifier. */
export function withoutDimensions(text: string): string {
  return text.normalize('NFKC').replace(DIMENSIONS, (value) => ' '.repeat(value.length));
}
