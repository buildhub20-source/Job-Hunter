import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardRef } from './types.js';

/**
 * Boards live in data/boards.md — same principle as the profile: a human edits
 * markdown, the system reads it. Adding a company is one line, no code change.
 */
export async function loadBoards(dataDir: string): Promise<{ boards: BoardRef[]; issues: string[] }> {
  const raw = await readFile(join(dataDir, 'boards.md'), 'utf8');
  const boards: BoardRef[] = [];
  const issues: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const [employerId, displayName, adapter, tenant, enabled] = cells as [string, string, string, string, string];
    if (employerId === 'employer_id' || /^-+$/.test(employerId)) continue;
    if (!employerId || !adapter || !tenant) {
      issues.push(`incomplete board row: ${line.trim()}`);
      continue;
    }
    boards.push({
      employerId: employerId.toLowerCase(),
      displayName: displayName || employerId,
      adapter: adapter.toLowerCase(),
      tenant,
      enabled: /^(yes|true|y)$/i.test(enabled ?? ''),
    });
  }

  const seen = new Set<string>();
  for (const b of boards) {
    const key = `${b.adapter}:${b.tenant}`;
    if (seen.has(key)) issues.push(`duplicate board ${key}`);
    seen.add(key);
  }
  return { boards, issues };
}
