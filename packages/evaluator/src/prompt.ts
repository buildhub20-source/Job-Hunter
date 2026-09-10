import type { ProfileBundle } from '@jobops/profile';
import type { EvaluableCard } from './hardgates.js';

const MAX_SKILLS = 30;
const MAX_TEXT = 4000;

export interface PromptCard extends EvaluableCard {
  company_name?: string;
  required_skills?: string[];
  work_authorization_text?: string | null;
}

function rankingValue(bundle: ProfileBundle, rule: string): string | null {
  return bundle.rankingSignals.find((r) => r.rule === rule)?.value ?? null;
}

/**
 * Everything stage 2 needs to rank a job that has already survived stage 1 — no
 * more, no less. Token discipline: plan section 16.
 */
export function buildPrompt(card: PromptCard, bundle: ProfileBundle): string {
  const targetTitles = rankingValue(bundle, 'target_titles') ?? 'none specified';
  const preferredStacks = bundle.rankingSignals
    .filter((r) => r.rule === 'preferred_stack')
    .map((r) => r.value);
  const acceptableStack = rankingValue(bundle, 'acceptable_stack') ?? 'none specified';
  const preferredRemote = rankingValue(bundle, 'preferred_remote_type') ?? 'no preference';
  const companyTypes = rankingValue(bundle, 'allowed_company_types') ?? 'no restriction';

  const candidateExperience = bundle.factsByKey.get('total_experience_years')?.value ?? 'unknown';
  const candidatePrimaryStack = bundle.factsByKey.get('primary_stack')?.value ?? 'unknown';
  const candidateSecondarySkills = bundle.factsByKey.get('secondary_skills')?.value ?? 'unknown';

  return [
    'You are ranking ONE already-eligible job posting for a candidate. It has already ' +
      'passed hard filters (company, geography, seniority, experience cap, salary ' +
      'floor, job type) in code — your job is ONLY to rank quality of fit, not to ' +
      're-check eligibility.',
    '',
    `Candidate: ${candidateExperience} years experience. Primary stack: ${candidatePrimaryStack}. Secondary skills: ${candidateSecondarySkills}.`,
    `Target titles: ${targetTitles}`,
    `Preferred stacks (equal weight, any one is a strong signal): ${preferredStacks.join(' | ') || 'none specified'}`,
    `Acceptable adjacent stack: ${acceptableStack}`,
    `Preferred remote type (tie-break only, all listed types are acceptable): ${preferredRemote}`,
    `Acceptable company types: ${companyTypes}`,
    '',
    `Job: ${card.company_name ?? card.employer_id} — ${card.title}`,
    `Location: ${card.location.join(', ') || 'unknown'} (${card.remote_type})`,
    `Experience range in posting: ${card.experience_min ?? '?'}-${card.experience_max ?? '?'} years`,
    `Required skills: ${(card.required_skills ?? []).slice(0, MAX_SKILLS).join(', ') || 'none listed'}`,
    `Compensation: ${card.compensation_min ?? '?'}-${card.compensation_max ?? '?'} ${card.currency ?? ''}`,
    `Work authorization text found in the JD: ${(card.work_authorization_text ?? 'none').slice(0, MAX_TEXT)}`,
    '',
    'Return tier A (strong fit), B (good fit), C (weak but eligible fit), or SKIP (not ' +
      'worth pursuing) with your reasoning in reason. If information needed to judge ' +
      'fit is missing from the posting, list it in missing_info. Use approval_needs ' +
      'only for a question that genuinely blocks judging fit, not for routine gaps. ' +
      'Confidence reflects how sure you are in the tier, not in the facts — low ' +
      'confidence must still produce a tier, never a refusal.',
  ].join('\n');
}
