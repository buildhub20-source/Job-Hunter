import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadProfile, staleFacts, upsertFact, commitDataChange, validateAfterWrite } from '@jobops/profile';
import { config } from '../config.js';

const UpsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  section: z.string().optional(),
  source: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  sensitivity: z.enum(['low', 'normal', 'high']).optional(),
  notes: z.string().optional(),
  reason: z.string().default('dashboard edit'),
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profile', async () => {
    const bundle = await loadProfile(config.dataDir);
    return {
      facts: bundle.facts,
      stale: staleFacts(bundle).map((f) => f.key),
      unusable: bundle.facts.filter((f) => !f.usable).map((f) => f.key),
      issues: bundle.issues,
      loadedAt: bundle.loadedAt,
    };
  });

  app.get('/api/policies', async () => {
    const bundle = await loadProfile(config.dataDir);
    return {
      policyVersion: bundle.policyVersion,
      hardGates: bundle.hardGates,
      rankingSignals: bundle.rankingSignals,
      issues: bundle.issues,
    };
  });

  // Permanent approvals and dashboard edits both land here.
  app.put('/api/profile/fact', async (req, reply) => {
    const parsed = UpsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;

    const mode = await upsertFact(config.dataDir, input);
    try {
      await validateAfterWrite(config.dataDir);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const sha = await commitDataChange(config.repoRoot, `profile(${input.key}): ${input.reason}`);
    return { ok: true, mode, commit: sha };
  });
}
