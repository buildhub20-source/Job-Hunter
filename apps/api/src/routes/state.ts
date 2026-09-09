import type { FastifyInstance } from 'fastify';
import { query, healthcheck } from '@jobops/db';
import { loadProfile } from '@jobops/profile';
import { config } from '../config.js';

/** Every read degrades to an empty list when Postgres is not up, so the dashboard still renders. */
async function safe<T>(fn: () => Promise<T[]>): Promise<{ rows: T[]; dbDown: boolean }> {
  try {
    return { rows: await fn(), dbDown: false };
  } catch {
    return { rows: [], dbDown: true };
  }
}

export async function stateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const db = await healthcheck();
    let profileOk = true;
    let issues = 0;
    try {
      const bundle = await loadProfile(config.dataDir);
      issues = bundle.issues.length;
    } catch {
      profileOk = false;
    }
    return { ok: db.ok && profileOk && issues === 0, db, profile: { ok: profileOk, issues } };
  });

  app.get('/api/stats', async () => {
    const db = await healthcheck();
    if (!db.ok) return { dbDown: true, error: db.error };
    const [counts] = await query<Record<string, string>>(`
      SELECT
        (SELECT count(*) FROM job_postings WHERE discovered_at::date = current_date) AS discovered_today,
        (SELECT count(*) FROM job_postings WHERE state = 'EVALUATED')                AS eligible,
        (SELECT count(*) FROM job_evaluations WHERE tier = 'A')                      AS a_tier,
        (SELECT count(*) FROM applications WHERE submitted_at::date = current_date)  AS submitted_today,
        (SELECT count(*) FROM approvals WHERE status = 'pending')                    AS pending_approvals,
        (SELECT count(*) FROM applications WHERE status = 'BLOCKED_HUMAN')           AS human_action,
        (SELECT count(*) FROM applications WHERE status = 'RETRY_APPROVAL_REQUIRED') AS retries_waiting,
        (SELECT count(*) FROM adapters WHERE status IN ('Degraded','Broken'))        AS adapters_degraded,
        (SELECT count(*) FROM inbox_messages WHERE matched_application_id IS NULL
           AND classification <> 'unrelated')                                        AS unmatched_mail,
        (SELECT coalesce(sum(input_tokens + output_tokens),0) FROM model_calls
           WHERE created_at::date = current_date)                                    AS tokens_today,
        (SELECT coalesce(sum(cost_usd),0) FROM model_calls
           WHERE created_at::date = current_date)                                    AS cost_today
    `);
    return { dbDown: false, ...counts };
  });

  app.get('/api/jobs', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT p.id, p.title, p.state, p.requisition_id, p.identity_source, p.identity_reliable,
                    c.display_name AS company, e.tier, e.confidence, p.discovered_at
             FROM job_postings p
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN LATERAL (SELECT tier, confidence FROM job_evaluations
                                WHERE job_posting_id = p.id ORDER BY created_at DESC LIMIT 1) e ON true
             ORDER BY p.discovered_at DESC LIMIT 200`),
    );
    return { dbDown, jobs: rows };
  });

  app.get('/api/applications', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT a.id, a.status, a.tier, a.mode, a.requisition_id, a.retry_count,
                    a.evidence_level, a.submitted_at, p.title, c.display_name AS company
             FROM applications a
             JOIN job_postings p ON p.id = a.job_posting_id
             JOIN companies c ON c.id = p.company_id
             ORDER BY a.updated_at DESC LIMIT 200`),
    );
    return { dbDown, applications: rows };
  });

  app.get('/api/approvals', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT id, type, status, question, field_key, scope, approved_answer,
                    chat_message_id, created_at, answered_at
             FROM approvals ORDER BY created_at DESC LIMIT 200`),
    );
    return { dbDown, approvals: rows };
  });

  app.get('/api/notifications', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT id, kind, severity, title, body, dashboard_path, acknowledged_at, created_at
             FROM notifications WHERE acknowledged_at IS NULL
             ORDER BY created_at DESC LIMIT 100`),
    );
    return { dbDown, notifications: rows };
  });

  app.get('/api/inbox', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT i.id, i.from_address, i.subject, i.received_at, i.classification,
                    i.match_confidence, i.match_method, i.matched_application_id,
                    c.display_name AS company
             FROM inbox_messages i
             LEFT JOIN applications a ON a.id = i.matched_application_id
             LEFT JOIN job_postings p ON p.id = a.job_posting_id
             LEFT JOIN companies c ON c.id = p.company_id
             ORDER BY i.received_at DESC LIMIT 200`),
    );
    return { dbDown, messages: rows };
  });

  app.get('/api/adapters', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT id, display_name, version, enabled, shadow_mode, status,
                    last_success_at, last_failure_at, last_error_summary,
                    success_rate_24h, success_rate_7d
             FROM adapters ORDER BY id`),
    );
    return { dbDown, adapters: rows };
  });

  app.get('/api/runs', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT id, mode, trigger, phase, status, policy_version,
                    started_at, finished_at, stopped_reason, stats
             FROM runs ORDER BY started_at DESC LIMIT 50`),
    );
    return { dbDown, runs: rows };
  });

  app.get('/api/audit', async () => {
    const { rows, dbDown } = await safe(() =>
      query(`SELECT id, actor, action, reason, policy_version, result, created_at
             FROM audit_events ORDER BY created_at DESC LIMIT 200`),
    );
    return { dbDown, events: rows };
  });
}
