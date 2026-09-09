import { query, one, tx } from '@jobops/db';
import { getAdapter, loadBoards, type BoardRef, type DiscoveryResult } from '@jobops/adapters';
import { toJobCard } from './tocard.js';

export interface IngestSummary {
  boards: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  unreliableIdentity: number;
  failures: { board: string; error: string }[];
}

async function upsertCompany(employerId: string, displayName: string): Promise<void> {
  await query(
    `INSERT INTO companies (id, display_name) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [employerId, displayName],
  );
}

async function upsertTenant(board: BoardRef): Promise<string> {
  const id = `${board.adapter}:${board.tenant}`;
  await query(
    `INSERT INTO ats_tenants (id, adapter_id, company_id, tenant_slug) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, board.adapter, board.employerId, board.tenant],
  );
  return id;
}

/**
 * Store what was discovered. Discovery does not judge — the evaluator does.
 * A posting already known is recorded as another source, never inserted twice.
 */
export async function ingestResult(result: DiscoveryResult, runId: string | null): Promise<{
  inserted: number; duplicates: number; unreliable: number;
}> {
  const { board } = result;
  let inserted = 0, duplicates = 0, unreliable = 0;

  await upsertCompany(board.employerId, board.displayName);
  const tenantId = await upsertTenant(board);

  for (const posting of result.postings) {
    const { jobCard, identity, jdHash, familyHash, normalizedTitle } = toJobCard(posting, board);
    if (!identity.reliable) unreliable++;

    await tx(async (client) => {
      await client.query(
        `INSERT INTO job_families (company_id, normalized_title, family_hash)
         VALUES ($1,$2,$3) ON CONFLICT (family_hash) DO NOTHING`,
        [board.employerId, normalizedTitle, familyHash],
      );

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM job_postings
          WHERE company_id = $1 AND COALESCE(ats_tenant_id,'') = $2 AND identity_value = $3`,
        [board.employerId, tenantId, identity.identifier],
      );

      let postingId: string;
      if (existing.rows.length > 0) {
        postingId = existing.rows[0]!.id;
        duplicates++;
        await client.query(
          `UPDATE job_postings SET jobcard = $2, updated_at = now() WHERE id = $1`,
          [postingId, JSON.stringify(jobCard)],
        );
      } else {
        const fam = await client.query<{ id: string }>(
          `SELECT id FROM job_families WHERE family_hash = $1`, [familyHash],
        );
        const ins = await client.query<{ id: string }>(
          `INSERT INTO job_postings
             (company_id, ats_tenant_id, job_family_id, requisition_id, identity_value,
              identity_source, identity_reliable, title, state, jobcard, jd_hash, source_url, official_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DISCOVERED',$9,$10,$11,$12)
           RETURNING id`,
          [
            board.employerId, tenantId, fam.rows[0]?.id ?? null, posting.requisitionId,
            identity.identifier, identity.source, identity.reliable, posting.title,
            JSON.stringify(jobCard), jdHash, posting.url, posting.applyUrl ?? posting.url,
          ],
        );
        postingId = ins.rows[0]!.id;
        inserted++;
      }

      await client.query(
        `INSERT INTO job_sources (job_posting_id, source, url) VALUES ($1,$2,$3)
         ON CONFLICT (job_posting_id, source, url) DO NOTHING`,
        [postingId, board.adapter, posting.url],
      );
    });
  }

  if (runId) {
    await query(
      `INSERT INTO run_events (run_id, worker, event, detail) VALUES ($1,'discovery','board.ingested',$2)`,
      [runId, JSON.stringify({ board: board.employerId, adapter: board.adapter, fetched: result.postings.length, inserted, duplicates })],
    );
  }
  return { inserted, duplicates, unreliable };
}

async function recordHealth(adapterId: string, displayName: string, ok: boolean, error?: string): Promise<void> {
  await query(
    `INSERT INTO adapters (id, display_name, status, enabled, shadow_mode)
     VALUES ($1,$2,$3,true,false)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       last_check_at = now(),
       last_success_at = CASE WHEN $4 THEN now() ELSE adapters.last_success_at END,
       last_failure_at = CASE WHEN $4 THEN adapters.last_failure_at ELSE now() END,
       last_error_summary = $5`,
    [adapterId, displayName, ok ? 'Healthy' : 'Broken', ok, error ?? null],
  );
  await query(
    `INSERT INTO adapter_health_events (adapter_id, status, ok, summary) VALUES ($1,$2,$3,$4)`,
    [adapterId, ok ? 'Healthy' : 'Broken', ok, error ?? null],
  );
}

/** One discovery pass over every enabled board. */
export async function runDiscovery(dataDir: string, runId: string | null = null): Promise<IngestSummary> {
  const { boards, issues } = await loadBoards(dataDir);
  for (const issue of issues) console.warn('[discovery] ' + issue);

  const summary: IngestSummary = {
    boards: 0, fetched: 0, inserted: 0, duplicates: 0, unreliableIdentity: 0, failures: [],
  };

  for (const board of boards.filter((b) => b.enabled)) {
    const adapter = getAdapter(board.adapter);
    if (!adapter) {
      summary.failures.push({ board: board.employerId, error: `no adapter '${board.adapter}'` });
      continue;
    }
    summary.boards++;
    const result = await adapter.discover(board);
    await recordHealth(adapter.id, adapter.displayName, result.ok, result.error);

    if (!result.ok) {
      summary.failures.push({ board: board.employerId, error: result.error ?? 'unknown' });
      continue;
    }
    summary.fetched += result.postings.length;
    const counts = await ingestResult(result, runId);
    summary.inserted += counts.inserted;
    summary.duplicates += counts.duplicates;
    summary.unreliableIdentity += counts.unreliable;
  }

  await query(
    `INSERT INTO audit_events (actor, action, reason, result, detail)
     VALUES ('discovery','discovery.run','scheduled or manual discovery pass','ok',$1)`,
    [JSON.stringify(summary)],
  );
  return summary;
}
