/**
 * Minimal GitHub-flavoured markdown table parser/serializer.
 * The .md files are the source of truth and must stay hand-editable and diff-friendly,
 * so we parse tables rather than embedding YAML or JSON. Plan sections 4-5.
 */

export interface MarkdownTable {
  heading: string | null;
  columns: string[];
  rows: Record<string, string>[];
  /** line index of the header row, for surgical rewrites */
  headerLine: number;
}

const isDivider = (line: string): boolean => /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  let escaped = false;
  for (const ch of trimmed) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function parseTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let heading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) { heading = (headingMatch[1] ?? '').trim(); continue; }

    const next = lines[i + 1];
    if (!line.includes('|') || next === undefined || !isDivider(next)) continue;

    const columns = splitRow(line).map((c) => c.toLowerCase());
    const rows: Record<string, string>[] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const rowLine = lines[j] ?? '';
      if (!rowLine.trim().includes('|')) break;
      const cells = splitRow(rowLine);
      if (cells.every((c) => c === '')) break;
      const row: Record<string, string> = {};
      columns.forEach((col, idx) => { row[col] = cells[idx] ?? ''; });
      rows.push(row);
    }
    tables.push({ heading, columns, rows, headerLine: i });
    i = j - 1;
  }
  return tables;
}

export function renderTable(columns: string[], rows: Record<string, string>[]): string {
  const header = `| ${columns.join(' | ')} |`;
  const divider = `|${columns.map(() => ' --- ').join('|')}|`;
  const body = rows.map(
    (r) => `| ${columns.map((c) => escapeCell(r[c] ?? '')).join(' | ')} |`,
  );
  return [header, divider, ...body].join('\n');
}
