import type { FastifyInstance } from 'fastify';
import { runDiscovery } from '@jobops/discovery';
import { loadBoards, getAdapter, ADAPTERS } from '@jobops/adapters';
import { config } from '../config.js';

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/boards', async () => {
    const { boards, issues } = await loadBoards(config.dataDir);
    return { boards, issues };
  });

  /** Fetch every enabled board and store what comes back. Discovery never judges. */
  app.post('/api/discovery/run', async (req) => {
    const { runId } = (req.body ?? {}) as { runId?: string };
    const summary = await runDiscovery(config.dataDir, runId ?? null);
    return summary;
  });

  /** Fetch one board without touching the database — for checking a tenant slug. */
  app.post('/api/discovery/probe', async (req, reply) => {
    const { adapter, tenant } = (req.body ?? {}) as { adapter?: string; tenant?: string };
    if (!adapter || !tenant) return reply.code(400).send({ error: 'adapter and tenant are required' });
    const impl = getAdapter(adapter);
    if (!impl) return reply.code(400).send({ error: `unknown adapter, have: ${Object.keys(ADAPTERS).join(', ')}` });

    const result = await impl.discover({
      employerId: 'probe', displayName: 'probe', adapter, tenant, enabled: true,
    });
    return {
      ok: result.ok,
      error: result.error,
      count: result.postings.length,
      durationMs: result.durationMs,
      sample: result.postings.slice(0, 5).map((p) => ({
        title: p.title, location: p.locationText, requisitionId: p.requisitionId, url: p.url,
      })),
    };
  });

  app.post('/api/adapters/healthcheck', async () => {
    const results = await Promise.all(Object.values(ADAPTERS).map((a) => a.healthCheck()));
    return { results };
  });
}
