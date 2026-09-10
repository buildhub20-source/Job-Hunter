import type { FastifyInstance } from 'fastify';
import { runEvaluation } from '@jobops/evaluator';
import { config } from '../config.js';

export async function evaluateRoutes(app: FastifyInstance): Promise<void> {
  /** One evaluation pass over DISCOVERED jobs. Plan section 9. */
  app.post('/api/evaluate/run', async (req) => {
    const { limit } = (req.body ?? {}) as { limit?: number };
    return runEvaluation(config.dataDir, limit ?? 500);
  });
}
