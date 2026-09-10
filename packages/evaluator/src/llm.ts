import { callClaude } from '@jobops/llm';
import { z } from 'zod';

/**
 * What stage 2 asks the model for. Deliberately narrower than the plan's full
 * Evaluation shape — resume_variant is a deterministic lookup (see resume.ts), not a
 * model judgment, so it's not part of what we ask for here.
 */
const LlmEvaluationSchema = z.object({
  tier: z.enum(['A', 'B', 'C', 'SKIP']),
  reason: z.string().min(1),
  missing_info: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  approval_needs: z
    .array(z.object({ field_key: z.string(), question: z.string() }))
    .default([]),
});
export type LlmEvaluation = z.infer<typeof LlmEvaluationSchema>;

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    tier: { type: 'string', enum: ['A', 'B', 'C', 'SKIP'] },
    reason: { type: 'string' },
    missing_info: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    approval_needs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field_key: { type: 'string' }, question: { type: 'string' } },
        required: ['field_key', 'question'],
      },
    },
  },
  required: ['tier', 'reason', 'missing_info', 'confidence', 'approval_needs'],
};

export interface LlmCallOptions {
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

/** Stage 2 — the only LLM call in the evaluator. See @jobops/llm for the mechanism. */
export async function rankWithLLM(prompt: string, opts: LlmCallOptions = {}): Promise<LlmEvaluation> {
  const structured = await callClaude(prompt, { jsonSchema: JSON_SCHEMA, ...opts });
  return LlmEvaluationSchema.parse(structured);
}
