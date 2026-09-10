import type { PolicyRow } from '@jobops/profile';

export interface HardGateOutcome {
  pass: boolean;
  reason: string | null;
}

/** The subset of a stored jobcard that hard gates need. */
export interface EvaluableCard {
  employer_id: string;
  title: string;
  location: string[];
  remote_type: 'onsite' | 'hybrid' | 'remote' | 'unknown';
  experience_min: number | null;
  experience_max: number | null;
  compensation_min: number | null;
  compensation_max: number | null;
  currency: string | null;
  commitment?: string | null;
}

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First word from `words` that appears as a whole word in `haystack`, or null. */
function wordMatch(haystack: string, words: string[]): string | null {
  const lower = haystack.toLowerCase();
  return words.find((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower)) ?? null;
}

type Check = (card: EvaluableCard, gate: PolicyRow, byRule: Map<string, PolicyRow>) => string | null;

const CHECKS: Record<string, Check> = {
  excluded_companies: (card, gate) => {
    const list = splitList(gate.value);
    return list.includes(card.employer_id.toLowerCase())
      ? `excluded company: ${card.employer_id}`
      : null;
  },

  excluded_companies_current_employer: (card, gate) => {
    const list = splitList(gate.value);
    return list.includes(card.employer_id.toLowerCase())
      ? `current employer, excluded: ${card.employer_id}`
      : null;
  },

  // excluded_company_kinds (staffing, consultancy_bench): no company-kind data source
  // exists yet — the companies table has no `kind` column. Left unimplemented rather
  // than guessed; none of the currently enabled boards are staffing firms, so this
  // gate has no effect either way today.

  experience_max_years: (card, gate) => {
    const limit = Number(gate.value);
    if (Number.isNaN(limit) || card.experience_min === null) return null;
    return card.experience_min > limit
      ? `requires ${card.experience_min}+ years, above the ${limit}-year limit`
      : null;
  },

  experience_min_years: (card, gate) => {
    const floor = Number(gate.value);
    if (Number.isNaN(floor) || floor <= 0 || card.experience_max === null) return null;
    return card.experience_max < floor
      ? `caps at ${card.experience_max} years, below the ${floor}-year floor`
      : null;
  },

  allowed_countries: (card, gate, byRule) => {
    const allowRemote = byRule.get('allow_remote_anywhere');
    if (card.remote_type === 'remote' && allowRemote?.value.trim().toLowerCase() === 'true') {
      return null;
    }
    const allowed = splitList(gate.value);
    const locations = card.location.map((l) => l.toLowerCase());
    const matches = allowed.some((country) => locations.some((l) => l.includes(country)));
    return matches ? null : `location [${card.location.join(', ') || 'unknown'}] outside ${gate.value}`;
  },

  blocked_title_words: (card, gate) => {
    const hit = wordMatch(card.title, splitList(gate.value));
    return hit ? `title contains blocked word "${hit}"` : null;
  },

  blocked_job_types: (card, gate) => {
    const haystack = `${card.commitment ?? ''} ${card.title}`;
    const hit = wordMatch(haystack, splitList(gate.value));
    return hit ? `job type "${hit}" is excluded` : null;
  },

  minimum_ctc: (card, gate) => {
    const floor = Number(gate.value);
    // Only a disclosed, same-currency (INR-default) comp can be judged here;
    // anything undisclosed or in another currency is left to stage 2.
    if (Number.isNaN(floor) || card.compensation_max === null) return null;
    if ((card.currency ?? 'INR').toUpperCase() !== 'INR') return null;
    return card.compensation_max < floor
      ? `disclosed comp up to ${card.compensation_max} below the ${floor} floor`
      : null;
  },
};

/**
 * Stage 1 — near-zero cost, deterministic. Eliminates a job before any model call.
 * Plan section 9. Gates run in policy `priority` order; the first failure wins and
 * becomes the SKIP reason.
 */
export function runHardGates(card: EvaluableCard, hardGates: PolicyRow[]): HardGateOutcome {
  const byRule = new Map(hardGates.map((g) => [g.rule, g]));
  const ordered = hardGates
    .filter((g) => CHECKS[g.rule] && g.value.trim() !== '')
    .sort((a, b) => a.priority - b.priority);

  for (const gate of ordered) {
    const reason = CHECKS[gate.rule]!(card, gate, byRule);
    if (reason) return { pass: false, reason };
  }
  return { pass: true, reason: null };
}
