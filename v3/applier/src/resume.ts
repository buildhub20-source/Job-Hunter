import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESUMES_DIR = resolve(__dirname, '..', '..', '..', 'data', 'resumes');

/**
 * Pick the right resume for a given employer.
 *
 * Strategy:
 * 1. If data/resumes/<normalised-employer>.pdf exists, use it (company-tailored).
 * 2. Otherwise fall back to data/resumes/base.pdf.
 *
 * The normalised employer name is lowercase, non-alphanumeric stripped.
 * e.g. "Project44" → "p44.pdf" won't match automatically — the resumes are
 * named manually. So we also try a few common transforms.
 */
export function pickResume(companyName: string): string {
  const norm = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Try exact normalised name
  const exactPath = resolve(RESUMES_DIR, `${norm}.pdf`);
  if (existsSync(exactPath)) return exactPath;

  // Try known abbreviations (employer → filename without .pdf)
  // These are the company-tailored resumes that already exist in data/resumes/
  const aliases: Record<string, string> = {
    amazon: 'amazon',
    americanexpress: 'amex',
    amex: 'amex',
    angelone: 'angelone',
    barclays: 'barclays',
    blueyonder: 'blueyonder',
    fedex: 'fedex',
    gbt: 'gbt',
    americanexpressgbt: 'gbt',
    project44: 'p44',
    p44: 'p44',
    paypal: 'paypal',
  };

  const alias = aliases[norm];
  if (alias) {
    const aliasPath = resolve(RESUMES_DIR, `${alias}.pdf`);
    if (existsSync(aliasPath)) return aliasPath;
  }

  // Fall back to base
  return resolve(RESUMES_DIR, 'base.pdf');
}
