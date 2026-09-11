import type { FastifyInstance } from 'fastify';
import { query, healthcheck } from '@jobops/db';

/**
 * The discovery -> evaluation funnel, and what each barrier removed.
 *
 * Gates are classified from the evaluator's own `reason` text rather than a
 * separate column, because that is where the information actually lives today.
 * If a `gate` column is ever added to job_evaluations, replace the CASE below
 * with it -- the shape of the response does not need to change.
 */
export async function funnelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/funnel', async () => {
    const db = await healthcheck();
    if (!db.ok) return { dbDown: true, error: db.error };

    // One row per posting: its most recent evaluation, if any.
    const latest = `
      SELECT DISTINCT ON (job_posting_id) job_posting_id, tier, reason, stage
      FROM job_evaluations
      ORDER BY job_posting_id, created_at DESC
    `;

    const [totals] = await query<Record<string, string>>(`
      WITH latest AS (${latest})
      SELECT
        (SELECT count(*) FROM job_postings)                                  AS discovered,
        (SELECT count(*) FROM latest)                                        AS evaluated,
        (SELECT count(*) FROM latest WHERE tier <> 'SKIP')                   AS eligible,
        (SELECT count(*) FROM latest WHERE tier = 'SKIP')                    AS rejected,
        (SELECT count(*) FROM latest WHERE tier = 'SKIP' AND stage = 'hard_gate') AS rejected_hard_gate,
        (SELECT count(*) FROM latest WHERE tier = 'SKIP' AND stage = 'llm')  AS rejected_llm,
        (SELECT count(*) FROM job_postings p
           WHERE NOT EXISTS (SELECT 1 FROM job_evaluations e WHERE e.job_posting_id = p.id))
                                                                             AS not_yet_evaluated
    `);

    const byTier = await query<{ tier: string; count: string }>(`
      WITH latest AS (${latest})
      SELECT tier, count(*)::text AS count FROM latest GROUP BY tier ORDER BY tier
    `);

    // Barrier families, derived from the reason strings the evaluator writes.
    const gateExpr = `
      CASE
        WHEN stage = 'llm'                                   THEN 'llm_judgement'
        WHEN reason ILIKE '%years, above the%'               THEN 'experience'
        WHEN reason ILIKE 'location %outside%'               THEN 'location'
        WHEN reason ILIKE 'title contains blocked word%'     THEN 'title'
        ELSE 'other'
      END
    `;

    const byGate = await query<{ gate: string; count: string }>(`
      WITH latest AS (${latest})
      SELECT ${gateExpr} AS gate, count(*)::text AS count
      FROM latest WHERE tier = 'SKIP'
      GROUP BY 1 ORDER BY count(*) DESC
    `);

    const byReason = await query<{ gate: string; reason: string; count: string }>(`
      WITH latest AS (${latest})
      SELECT ${gateExpr} AS gate, reason, count(*)::text AS count
      FROM latest WHERE tier = 'SKIP'
      GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 40
    `);

    return { dbDown: false, totals, byTier, byGate, byReason };
  });
}
