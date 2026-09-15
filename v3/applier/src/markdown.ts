/** Cells of a markdown table row, keeping empty cells and escaped pipes. Null if not a row. */
export function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** A table separator row such as `| --- | :---: |`. */
export function isSeparator(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/.test(c));
}
