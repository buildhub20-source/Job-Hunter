import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { splitRow, isSeparator } from './markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', '..', 'data');

/**
 * Sheet company names that don't normalise to the employer_id used as a policy
 * scope. Only names go here; which file each employer gets lives in the policy.
 */
const NAME_TO_EMPLOYER: Record<string, string> = {
  americanexpress: 'amex',
  americanexpressglobalbusinesstravel: 'gbt',
  amexgbt: 'gbt',
};

interface ResumePolicy {
  defaultFile: string | null;
  byEmployer: Map<string, string>;
}

/** Reads `default_resume` and every `employer_resume` row from data/policies/resumes.md. */
export function readResumePolicy(policyPath = resolve(DATA_DIR, 'policies', 'resumes.md')): ResumePolicy {
  const policy: ResumePolicy = { defaultFile: null, byEmployer: new Map() };
  let columns: string[] | null = null;

  for (const line of readFileSync(policyPath, 'utf-8').split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells) {
      columns = null;
      continue;
    }
    if (cells.includes('rule') && cells.includes('value')) {
      columns = cells;
      continue;
    }
    if (!columns || isSeparator(cells)) continue;

    const row = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));
    if (row['rule'] === 'default_resume') policy.defaultFile = row['value'] || null;
    if (row['rule'] === 'employer_resume' && row['scope'] && row['value']) {
      policy.byEmployer.set(row['scope'].toLowerCase(), row['value']);
    }
  }
  return policy;
}

/**
 * The resume for an employer, per data/policies/resumes.md: that employer's tailored
 * file if the policy maps one and it exists, otherwise the policy's default_resume.
 */
export function pickResume(
  companyName: string,
  policy: ResumePolicy = readResumePolicy(),
  resumesDir = resolve(DATA_DIR, 'resumes'),
): string {
  const norm = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const employerId = NAME_TO_EMPLOYER[norm] ?? norm;

  const tailored = policy.byEmployer.get(employerId);
  if (tailored) {
    const path = resolve(resumesDir, `${tailored}.pdf`);
    if (existsSync(path)) return path;
  }

  if (!policy.defaultFile) {
    throw new Error('data/policies/resumes.md has no default_resume row');
  }
  return resolve(resumesDir, `${policy.defaultFile}.pdf`);
}

/**
 * The resume for one job, and where the choice came from:
 *   1. the employer's tailored file, per the policy;
 *   2. the version Apps Script matched to the JD (the Sheet's Resume column);
 *   3. the policy default.
 * A Resume value naming no file in data/resumes is ignored rather than trusted — the
 * column is editable by hand, and a typo must not upload nothing.
 */
export function resumeForJob(
  job: { 'Company Name': string; 'Resume'?: string; 'Resume Match'?: string },
  policy: ResumePolicy = readResumePolicy(),
  resumesDir = resolve(DATA_DIR, 'resumes'),
): { path: string; source: string } {
  const byPolicy = pickResume(job['Company Name'], policy, resumesDir);
  const isDefault = policy.defaultFile !== null && byPolicy === resolve(resumesDir, `${policy.defaultFile}.pdf`);
  if (!isDefault) return { path: byPolicy, source: 'tailored for this employer' };

  const matched = String(job['Resume'] ?? '').trim().toLowerCase();
  if (/^[a-z0-9_-]+$/.test(matched)) {
    const path = resolve(resumesDir, `${matched}.pdf`);
    if (existsSync(path)) return { path, source: `matched to the JD — ${job['Resume Match'] || 'no reason recorded'}` };
  }
  return { path: byPolicy, source: matched ? `default ("${matched}" has no file)` : 'default (not matched yet)' };
}

/**
 * A copy of the chosen resume under the name an employer should see. The file name is
 * visible to the recruiter — "amazon.pdf" on a GitLab application says it was written
 * for someone else. The variant names in data/resumes stay as they are.
 */
export function stageResume(sourcePath: string, fullName: string, dir = join(tmpdir(), 'jobops-applier')): string {
  const name = fullName.trim().split(/\s+/).map((p) => p.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).join('_');
  mkdirSync(dir, { recursive: true });
  const staged = join(dir, `${name || 'Candidate'}_Resume.pdf`);
  copyFileSync(sourcePath, staged);
  return staged;
}
