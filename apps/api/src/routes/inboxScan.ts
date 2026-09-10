import type { FastifyInstance } from 'fastify';
import { runInboxScan } from '@jobops/inbox';
import { transport } from '../transport.js';

export async function inboxScanRoutes(app: FastifyInstance): Promise<void> {
  /** One read-only Gmail scan. Plan section 14. Meant to run before discovery each day. */
  app.post('/api/inbox/scan', async () => runInboxScan(transport));
}
