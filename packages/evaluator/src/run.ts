import { query, one } from '@jobops/db';
import { loadProfile } from '@jobops/profile';
import { runHardGates } from './hardgates.js';
import { selectResumeVariant } from './resume.js';
import { rankWithLLM } from './llm.js';
import { buildPrompt, type PromptCard } from './prompt.js';

export interface EvaluateSummary {
  candidates: number;
  hardGateSkipped: number;
  llmEvaluated: number;
  cacheHits: number;
  errors: { jobPostingId: string; error: string }[];
}

interface JobRow {
  id: string;
  jd_hash: string;
  jobcard: PromptCard;
  state: 'DISCOVERED' | 'VERIFIED';
}

async function alreadyCached(jdHash: string, policyVersion: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `SELECT id FROM job_evaluations WHERE jd_hash = $1 AND policy_version = $2 LIMIT 1`,
    [jdHash, policyVersion],
  );
  return row !== null;
}

async function recordEvaluation(jobId: string, ev: {
  tier: string;
  reason: string;
  confidence: number;
  missingInfo: string[];
  resumeVariant: string | null;
  stage: 'hard_gate' | 'llm';
  policyVersion: string;
  jdHash: string;
}): Promise<void> {
  await query(
    `INSERT INTO job_evaluations
       (job_posting_id, tier, reason, confidence, missing_info, resume_variant, stage, policy_version, jd_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [jobId, ev.tier, ev.reason, ev.confidence, JSON.stringify(ev.missingInfo), ev.resumeVariant, ev.stage, ev.policyVersion, ev.jdHash],
  );
}

async function transition(
  jobId: string, from: string, to: string, reason: string, policyVersion: string,
): Promise<void> {
  await query(`UPDATE job_postings SET state = $2, updated_at = now() WHERE id = $1`, [jobId, to]);
  await query(
    `INSERT INTO audit_events (actor, action, job_posting_id, reason, policy_version, result, detail)
     VALUES ('evaluator', $2, $1, $3, $4, 'ok', $5)`,
    [jobId, `state.${from}_to_${to}`, reason, policyVersion, JSON.stringify({ from, to })],
  );
}

/**
 * One evaluation pass over DISCOVERED job postings. Plan section 9.
 *
 * Stage 1 (hard gates) failing sends a job straight DISCOVERED -> SKIPPED — cheap,
 * deterministic, no model call. Surviving stage 1 moves it DISCOVERED -> VERIFIED,
 * then stage 2 (LLM) always lands on EVALUATED regardless of the tier it returns —
 * "low confidence routes to review, never auto-skip" means SKIPPED is reserved for
 * stage 1 only; a stage-2 SKIP tier is still an EVALUATED job, visible for review.
 */
export async function runEvaluation(dataDir: string, limit = 500): Promise<EvaluateSummary> {
  const bundle = await loadProfile(dataDir);
  const summary: EvaluateSummary = {
    candidates: 0, hardGateSkipped: 0, llmEvaluated: 0, cacheHits: 0, errors: [],
  };

  // Includes VERIFIED: a prior pass that failed mid-LLM-call (e.g. a transient CLI
  // error) leaves a job there, past stage 1 and unable to go back to DISCOVERED —
  // resume straight into stage 2 rather than silently stranding it forever.
  const rows = await query<JobRow>(
    `SELECT id, jd_hash, jobcard, state FROM job_postings WHERE state IN ('DISCOVERED','VERIFIED') ORDER BY discovered_at ASC LIMIT $1`,
    [limit],
  );
  summary.candidates = rows.length;

  for (const row of rows) {
    const card = row.jobcard;
    try {
      if (await alreadyCached(row.jd_hash, bundle.policyVersion)) {
        summary.cacheHits++;
        continue;
      }

      const resumeVariant = selectResumeVariant(card.employer_id, bundle.rankingSignals);

      if (row.state === 'DISCOVERED') {
        const gate = runHardGates(card, bundle.hardGates);
        if (!gate.pass) {
          await recordEvaluation(row.id, {
            tier: 'SKIP', reason: gate.reason!, confidence: 1, missingInfo: [],
            resumeVariant, stage: 'hard_gate', policyVersion: bundle.policyVersion, jdHash: row.jd_hash,
          });
          await transition(row.id, 'DISCOVERED', 'SKIPPED', gate.reason!, bundle.policyVersion);
          summary.hardGateSkipped++;
          continue;
        }
        await transition(row.id, 'DISCOVERED', 'VERIFIED', 'passed stage 1 hard gates', bundle.policyVersion);
      }

      const prompt = buildPrompt(card, bundle);
      const llmResult = await rankWithLLM(prompt);

      await recordEvaluation(row.id, {
        tier: llmResult.tier, reason: llmResult.reason, confidence: llmResult.confidence,
        missingInfo: llmResult.missing_info, resumeVariant, stage: 'llm',
        policyVersion: bundle.policyVersion, jdHash: row.jd_hash,
      });
      await transition(row.id, 'VERIFIED', 'EVALUATED', `stage 2: tier ${llmResult.tier}`, bundle.policyVersion);
      summary.llmEvaluated++;
    } catch (err) {
      summary.errors.push({ jobPostingId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
