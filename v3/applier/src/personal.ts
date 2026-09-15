import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitRow, isSeparator } from './markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse data/personal.md into a Map<key, value> of approved, non-expired facts.
 *
 * The file is a series of markdown tables grouped by section. Each table has
 * columns: key | value | source | approved | approved_at | expires_at | sensitivity | notes
 *
 * Rules (from the file itself):
 * - Only `approved=yes` facts are returned.
 * - Expired facts (`expires_at` in the past) are excluded.
 * - Empty, UNKNOWN, or unapproved values are never returned.
 */
export async function loadPersonalFacts(
  overridePath?: string,
): Promise<Map<string, string>> {
  const filePath =
    overridePath ?? resolve(__dirname, '..', '..', '..', 'data', 'personal.md');
  const raw = await readFile(filePath, 'utf-8');

  const facts = new Map<string, string>();
  let inFactTable = false;

  for (const line of raw.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells) {
      inFactTable = false;
      continue;
    }
    if (cells[0] === 'key' && cells[1] === 'value') {
      inFactTable = true;
      continue;
    }
    if (!inFactTable || isSeparator(cells)) continue;

    // Positional, so empty cells must survive: approved_at is often blank, and
    // dropping it would read expires_at from the sensitivity column.
    const [key, value, , approved, , expiresAt] = cells;
    if (!key || approved !== 'yes') continue;
    if (!value || value === 'UNKNOWN') continue;

    if (expiresAt) {
      const exp = new Date(expiresAt);
      if (!isNaN(exp.getTime()) && exp < new Date()) continue;
    }

    facts.set(key, value);
  }

  return facts;
}

/**
 * Convenience: look up a fact, return undefined if missing.
 * The caller decides whether to park the job or use a default.
 */
export function getFact(
  facts: Map<string, string>,
  key: string,
): string | undefined {
  return facts.get(key);
}

/**
 * Split full_name into first + last. Indian names don't always have a last name,
 * so this returns { first, last } where last may be empty.
 */
export function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}
