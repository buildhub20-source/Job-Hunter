import type { FastifyInstance } from 'fastify';
import { query } from '@jobops/db';

/** Degrades to empty list when Postgres is down, so the dashboard still renders. */
async function safe<T>(fn: () => Promise<T[]>): Promise<{ rows: T[]; dbDown: boolean }> {
  try {
    return { rows: await fn(), dbDown: false };
  } catch {
    return { rows: [], dbDown: true };
  }
}

export async function adapterHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/adapters/health', async () => {
    // Recompute success rates from event history — these columns exist
    // in the schema but recordHealth() in ingest.ts never populates them.
    try {
      await query(`
        UPDATE adapters SET
          success_rate_24h = sub.rate_24h,
          success_rate_7d  = sub.rate_7d
        FROM (
          SELECT
            a.id,
            (SELECT AVG(ok::int::numeric) FROM adapter_health_events h
             WHERE h.adapter_id = a.id AND h.created_at > now() - interval '24 hours') AS rate_24h,
            (SELECT AVG(ok::int::numeric) FROM adapter_health_events h
             WHERE h.adapter_id = a.id AND h.created_at > now() - interval '7 days') AS rate_7d
          FROM adapters a
        ) sub
        WHERE adapters.id = sub.id
      `);
    } catch {
      // Non-fatal — we still return whatever is stored
    }

    const { rows: adapters, dbDown } = await safe(() =>
      query(`SELECT id, display_name, version, enabled, shadow_mode, status,
                    last_check_at, last_success_at, last_failure_at,
                    last_error_summary, success_rate_24h, success_rate_7d
             FROM adapters ORDER BY id`),
    );

    if (dbDown) {
      return { dbDown, adapters: [], history: [], affectedJobs: {}, boardBreakdown: [] };
    }

    const history = await query<{
      adapter_id: string; status: string; ok: boolean; summary: string | null; created_at: string;
    }>(`SELECT adapter_id, status, ok, summary, created_at
        FROM adapter_health_events ORDER BY created_at DESC LIMIT 50`);

    const jobCounts = await query<{ adapter_id: string; count: string }>(
      `SELECT t.adapter_id, COUNT(*)::text AS count
       FROM job_postings p
       JOIN ats_tenants t ON t.id = p.ats_tenant_id
       GROUP BY t.adapter_id`,
    );
    const affectedJobs: Record<string, number> = {};
    for (const row of jobCounts) {
      affectedJobs[row.adapter_id] = Number(row.count);
    }

    const boardBreakdown = await query<{
      adapter_id: string; company_id: string; company_name: string;
      tenant_slug: string; job_count: string;
      last_discovery_at: string | null;
    }>(`SELECT t.adapter_id, t.company_id,
               c.display_name AS company_name,
               t.tenant_slug,
               COUNT(p.id)::text AS job_count,
               MAX(p.discovered_at) AS last_discovery_at
        FROM ats_tenants t
        JOIN companies c ON c.id = t.company_id
        LEFT JOIN job_postings p ON p.ats_tenant_id = t.id
        GROUP BY t.adapter_id, t.company_id, c.display_name, t.tenant_slug
        ORDER BY t.adapter_id, c.display_name`);

    return { dbDown: false, adapters, history, affectedJobs, boardBreakdown };
  });
}
