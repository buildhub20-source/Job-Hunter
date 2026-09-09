import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseTables, renderTable } from './table.js';
import { loadProfile } from './load.js';

const exec = promisify(execFile);

export interface UpsertFactInput {
  key: string;
  value: string;
  section?: string;
  source?: string;
  approvedAt?: string;
  expiresAt?: string | null;
  sensitivity?: 'low' | 'normal' | 'high';
  notes?: string;
}

/**
 * Write a permanently-approved answer back into personal.md.
 * Called only when an approval is answered with scope = 'permanent'. Plan section 5.
 * Rewrites one table in place; the rest of the file (prose, comments) is untouched.
 */
export async function upsertFact(dataDir: string, input: UpsertFactInput): Promise<'created' | 'updated'> {
  const file = join(dataDir, 'personal.md');
  const raw = await readFile(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const tables = parseTables(raw).filter((t) => t.columns.includes('key'));
  if (tables.length === 0) throw new Error('personal.md has no fact table with a "key" column');

  const targetSection = input.section?.toLowerCase();
  const existing = tables.find((t) => t.rows.some((r) => r['key'] === input.key));
  const table =
    existing ??
    (targetSection ? tables.find((t) => t.heading?.toLowerCase() === targetSection) : undefined) ??
    tables[tables.length - 1]!;

  const row: Record<string, string> = {
    key: input.key,
    value: input.value,
    source: input.source ?? 'approval',
    approved: 'yes',
    approved_at: input.approvedAt ?? new Date().toISOString().slice(0, 10),
    expires_at: input.expiresAt ?? '',
    sensitivity: input.sensitivity ?? 'normal',
    notes: input.notes ?? '',
  };

  const idx = table.rows.findIndex((r) => r['key'] === input.key);
  const mode: 'created' | 'updated' = idx >= 0 ? 'updated' : 'created';
  if (idx >= 0) table.rows[idx] = { ...table.rows[idx], ...row };
  else table.rows.push(row);

  const rendered = renderTable(table.columns, table.rows).split('\n');
  const start = table.headerLine;
  const oldLength = 2 + table.rows.length - (mode === 'created' ? 1 : 0);
  lines.splice(start, oldLength, ...rendered);

  await writeFile(file, lines.join('\n'), 'utf8');
  return mode;
}

/** Commit the .md change so every profile/policy edit is versioned. Plan section 4. */
export async function commitDataChange(repoRoot: string, message: string): Promise<string | null> {
  if (process.env.JOBOPS_GIT_COMMIT_ON_WRITE === 'false') return null;
  try {
    await exec('git', ['add', 'data'], { cwd: repoRoot });
    const { stdout } = await exec('git', ['status', '--porcelain', '--', 'data'], { cwd: repoRoot });
    if (stdout.trim() === '') return null;
    await exec('git', ['commit', '-m', message, '--', 'data'], { cwd: repoRoot });
    const { stdout: sha } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
    return sha.trim();
  } catch (err) {
    console.warn('[profile] git commit skipped:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Reject a write that would leave the file unparseable. */
export async function validateAfterWrite(dataDir: string): Promise<void> {
  const bundle = await loadProfile(dataDir);
  if (bundle.issues.length > 0) {
    throw new Error(
      'write left data files invalid:\n' +
        bundle.issues.map((i) => `  ${i.file} [${i.line}] ${i.message}`).join('\n'),
    );
  }
}
