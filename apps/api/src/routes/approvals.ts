import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { answerApproval, createApproval, pendingApprovals } from '@jobops/approvals';
import { config } from '../config.js';
import { transport } from '../transport.js';

const deps = () => ({ transport, dataDir: config.dataDir, repoRoot: config.repoRoot });

const AnswerSchema = z.object({
  answer: z.string().min(1),
  scope: z.enum(['this_job', 'this_run', 'permanent']).default('this_job'),
  respondedBy: z.string().default('dashboard'),
});

const CreateSchema = z.object({
  type: z.enum(['information', 'conflict', 'retry', 'action']).default('information'),
  applicationId: z.string().uuid().nullish(),
  jobPostingId: z.string().uuid().nullish(),
  runId: z.string().uuid().nullish(),
  question: z.string().min(1),
  fieldKey: z.string().nullish(),
  blockedReason: z.string().default('no approved value in personal.md'),
  choices: z.array(z.string()).optional(),
  allowFreeText: z.boolean().optional(),
  company: z.string().default('—'),
  role: z.string().default('—'),
  requisitionId: z.string().nullish(),
  relevantFactKeys: z.array(z.string()).optional(),
});

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/approvals/pending', async () => ({ approvals: await pendingApprovals() }));

  /** Same path the Chat webhook uses. Lets the flow be driven without credentials. */
  app.post('/api/approvals/:id/answer', async (req, reply) => {
    const parsed = AnswerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { id } = req.params as { id: string };

    const result = await answerApproval(deps(), { approvalId: id, ...parsed.data });
    if (result.status === 'not_found') return reply.code(404).send(result);
    if (result.status === 'already_answered') return reply.code(409).send(result);
    return result;
  });

  /** Used by workers, and by you to test a card end to end. */
  app.post('/api/approvals', async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const created = await createApproval(deps(), parsed.data);
    return reply.code(201).send({ ...created, transport: transport.name });
  });
}
