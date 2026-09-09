import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseTables } from './table.js';
import { FactRowSchema, PolicyRowSchema, type Fact, type PolicyRow, type LoadIssue } from './schema.js';

export interface ProfileBundle {
  facts: Fact[];
  factsByKey: Map<string, Fact>;
  policies: PolicyRow[];
  hardGates: PolicyRow[];
  rankingSignals: PolicyRow[];
  policyVersion: string;
  issues: LoadIssue[];
  loadedAt: string;
}

const isExpired = (d: string | null): boolean => d !== null && Date.parse(d) < Date.now();

export async function loadPersonal(dataDir: string): Promise<{ facts: Fact[]; issues: LoadIssue[] }> {
  const file = join(dataDir, 'personal.md');
  const raw = await readFile(file, 'utf8');
  const facts: Fact[] = [];
  const issues: LoadIssue[] = [];

  for (const table of parseTables(raw)) {
    if (!table.columns.includes('key')) continue;
    for (const row of table.rows) {
      const parsed = FactRowSchema.safeParse(row);
      if (!parsed.success) {
        issues.push({
          file: 'personal.md',
          line: row['key'] ?? '(unnamed row)',
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        continue;
      }
      const f = parsed.data;
      const value = f.value.trim();
      facts.push({
        ...f,
        section: table.heading ?? 'general',
        // UNKNOWN is not NO: an unapproved, empty or expired fact is simply absent.
        usable: f.approved && value !== '' && value !== 'UNKNOWN' && !isExpired(f.expires_at),
      });
    }
  }

  const seen = new Set<string>();
  for (const f of facts) {
    if (seen.has(f.key)) {
      issues.push({ file: 'personal.md', line: f.key, message: 'duplicate key' });
    }
    seen.add(f.key);
  }
  return { facts, issues };
}

export async function loadPolicies(dataDir: string): Promise<{ policies: PolicyRow[]; issues: LoadIssue[] }> {
  const dir = join(dataDir, 'policies');
  const policies: PolicyRow[] = [];
  const issues: LoadIssue[] = [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();

  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf8');
    for (const table of parseTables(raw)) {
      if (!table.columns.includes('rule')) continue;
      for (const row of table.rows) {
        const parsed = PolicyRowSchema.safeParse(row);
        if (!parsed.success) {
          issues.push({
            file,
            line: row['id'] ?? row['rule'] ?? '(unnamed row)',
            message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          });
          continue;
        }
        policies.push(parsed.data);
      }
    }
  }
  return { policies, issues };
}

/**
 * Policy version is a content hash, so any hand edit to a policy file
 * invalidates the evaluation cache automatically. Plan section 16.
 */
export function computePolicyVersion(policies: PolicyRow[]): string {
  const canonical = [...policies]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}|${p.rule}|${p.value}|${p.type}|${p.scope}|${p.priority}`)
    .join('\n');
  return 'pol-' + createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export async function loadProfile(dataDir: string): Promise<ProfileBundle> {
  const [personal, policy] = await Promise.all([loadPersonal(dataDir), loadPolicies(dataDir)]);
  const factsByKey = new Map<string, Fact>();
  for (const f of personal.facts) factsByKey.set(f.key, f);

  return {
    facts: personal.facts,
    factsByKey,
    policies: policy.policies,
    hardGates: policy.policies.filter((p) => p.type === 'hard_gate'),
    rankingSignals: policy.policies.filter((p) => p.type === 'ranking_signal'),
    policyVersion: computePolicyVersion(policy.policies),
    issues: [...personal.issues, ...policy.issues],
    loadedAt: new Date().toISOString(),
  };
}

/**
 * The only way a worker reads a personal fact.
 * Returns null when unknown — callers must raise an approval, never substitute a default.
 */
export function factValue(bundle: ProfileBundle, key: string): string | null {
  const f = bundle.factsByKey.get(key);
  return f && f.usable ? f.value.trim() : null;
}

/** Facts that are approved but past their expiry — the dashboard nags about these. */
export function staleFacts(bundle: ProfileBundle): Fact[] {
  return bundle.facts.filter((f) => f.approved && isExpired(f.expires_at));
}
