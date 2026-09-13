import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const lines = raw.split('\n');

  for (const line of lines) {
    // Match markdown table rows: | key | value | source | approved | ... |
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 4) continue;

    const [key, value, _source, approved, _approvedAt, expiresAt] = cells;

    // Skip header/separator rows
    if (key === 'key' || key.startsWith('---') || key === '---') continue;

    // Only approved facts
    if (approved !== 'yes') continue;

    // Skip empty / UNKNOWN
    if (!value || value === 'UNKNOWN') continue;

    // Skip expired
    if (expiresAt && expiresAt.trim()) {
      const exp = new Date(expiresAt.trim());
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
