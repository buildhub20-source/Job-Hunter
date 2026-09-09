import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseInteraction, verifyChatBearer, timingSafeEqual } from '@jobops/chat';
import { answerApproval } from '@jobops/approvals';
import { config } from '../config.js';
import { transport } from '../transport.js';

/**
 * Google Chat calls this when you tap a button. It can answer approvals on your
 * behalf, so it is authenticated: a real Google-signed JWT in production, or a
 * shared secret for local development. If neither is configured the endpoint
 * refuses every request rather than running open.
 */
async function authenticate(req: FastifyRequest): Promise<{ ok: boolean; reason?: string }> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { ok: false, reason: 'missing bearer token' };

  const projectNumber = process.env['GCHAT_PROJECT_NUMBER'];
  if (projectNumber) return verifyChatBearer(token, projectNumber);

  const secret = process.env['GCHAT_WEBHOOK_SECRET'];
  if (secret) {
    return timingSafeEqual(token, secret)
      ? { ok: true }
      : { ok: false, reason: 'bad shared secret' };
  }
  return { ok: false, reason: 'webhook not configured (set GCHAT_PROJECT_NUMBER or GCHAT_WEBHOOK_SECRET)' };
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/chat/webhook', async (req, reply) => {
    const auth = await authenticate(req);
    if (!auth.ok) {
      req.log.warn({ reason: auth.reason }, 'rejected chat webhook');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const answer = parseInteraction(req.body);
    if (!answer) {
      // Not an interaction we act on (joined a space, plain message, unknown button).
      return { text: '' };
    }

    const result = await answerApproval(
      { transport, dataDir: config.dataDir, repoRoot: config.repoRoot },
      {
        approvalId: answer.approvalId,
        answer: answer.answer,
        scope: answer.scope,
        respondedBy: answer.respondedBy,
      },
    );

    switch (result.status) {
      case 'answered':
        return {
          text: result.wroteToFile
            ? `Saved permanently to ${result.wroteToFile}${result.commit ? ` (${result.commit})` : ''}. Continuing.`
            : `Got it — applied to ${answer.scope.replace('_', ' ')}. Continuing.`,
        };
      case 'skipped':
        return { text: 'Skipped. I will not apply to this one.' };
      case 'already_answered':
        return { text: 'That one was already answered.' };
      case 'not_found':
        return { text: 'I no longer have that question on file.' };
    }
  });
}
