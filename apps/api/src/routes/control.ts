import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, one } from '@jobops/db';
import { loadProfile } from '@jobops/profile';
import { RUN_MODES } from '@jobops/shared';
import { config } from '../config.js';

const StartRunSchema = z.object({
  mode: z.enum(RUN_MODES),
  trigger: z.enum(['manual', 'scheduled']).default('manual'),
  maxDurationMinutes: z.number().int().min(5).max(240).default(60),
});

export async function controlRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Starting a run is the dashboard's job. The orchestrator (step 8+) picks up
   * the row and does the work; this endpoint only records intent.
   */
  app.post('/api/runs', async (req, reply) => {
    const parsed = StartRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const bundle = await loadProfile(config.dataDir);
    if (bundle.issues.length > 0) {
      return reply.code(409).send({
        error: 'data files are invalid; fix them before starting a run',
        issues: bundle.issues,
      });
    }

    const active = await one(`SELECT id FROM runs WHERE status IN ('running','wind_down') LIMIT 1`);
    if (active) return reply.code(409).send({ error: 'a run is already active', runId: active['id'] });

    const row = await one(
      `INSERT INTO runs (mode, trigger, policy_version, max_duration_minutes)
       VALUES ($1,$2,$3,$4) RETURNING id, mode, status, started_at`,
      [parsed.data.mode, parsed.data.trigger, bundle.policyVersion, parsed.data.maxDurationMinutes],
    );
    await query(
      `INSERT INTO audit_events (actor, action, reason, policy_version, result)
       VALUES ('user','run.start','started from dashboard',$1,'ok')`,
      [bundle.policyVersion],
    );
    return { ok: true, run: row };
  });

  app.post('/api/runs/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await one(
      `UPDATE runs SET status='finished', finished_at=now(), stopped_reason='stopped from dashboard'
       WHERE id=$1 AND status IN ('running','wind_down') RETURNING id, status`,
      [id],
    );
    if (!row) return reply.code(404).send({ error: 'no active run with that id' });
    await query(
      `INSERT INTO audit_events (actor, action, reason, result)
       VALUES ('user','run.stop','stopped from dashboard','ok')`,
    );
    return { ok: true, run: row };
  });

  const AdapterSchema = z.object({
    enabled: z.boolean().optional(),
    shadowMode: z.boolean().optional(),
  });

  app.patch('/api/adapters/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = AdapterSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await one(
      `UPDATE adapters
         SET enabled = COALESCE($2, enabled),
             shadow_mode = COALESCE($3, shadow_mode)
       WHERE id = $1
       RETURNING id, enabled, shadow_mode, status`,
      [id, parsed.data.enabled ?? null, parsed.data.shadowMode ?? null],
    );
    if (!row) return reply.code(404).send({ error: 'unknown adapter' });
    return { ok: true, adapter: row };
  });

  app.post('/api/notifications/:id/ack', async (req) => {
    const { id } = req.params as { id: string };
    await query(`UPDATE notifications SET acknowledged_at = now() WHERE id = $1`, [id]);
    return { ok: true };
  });
}
