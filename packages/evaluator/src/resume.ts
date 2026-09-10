import type { PolicyRow } from '@jobops/profile';

/**
 * Deterministic, not an LLM judgment: `employer_override_then_default` (policy
 * `resume_strategy`) is a pure lookup, so it's computed here rather than asked of the
 * model in stage 2 — one less thing the model could get wrong.
 */
export function selectResumeVariant(employerId: string, rankingSignals: PolicyRow[]): string | null {
  const override = rankingSignals.find((r) => r.rule === 'employer_resume' && r.scope === employerId);
  if (override) return override.value;
  const fallback = rankingSignals.find((r) => r.rule === 'default_resume');
  return fallback?.value ?? null;
}
