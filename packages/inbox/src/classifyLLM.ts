import { callClaude } from '@jobops/llm';
import { z } from 'zod';
import { INBOX_CLASSES, type RawEmail, type ClassificationResult } from './types.js';

const ClassificationSchema = z.object({
  classification: z.enum(INBOX_CLASSES),
  confidence: z.number().min(0).max(1),
});

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: INBOX_CLASSES },
    confidence: { type: 'number' },
  },
  required: ['classification', 'confidence'],
};

const CATEGORY_GUIDE = [
  'confirmation — application received acknowledgement',
  'rejection — not moving forward',
  'interview — a screening or interview invite',
  'recruiter — outreach about a role, not a reply to an application already sent',
  'assessment — a coding test or challenge link',
  'offer — a job offer',
  'action_required — needs documents, forms, or scheduling from the candidate',
  'job_alert — a job board digest or newsletter, not personal correspondence',
  'unrelated — not about a job application at all',
].join('\n');

/** Stage 2 — only reached when the deterministic patterns in classify.ts are inconclusive. */
export async function classifyWithLLM(email: Pick<RawEmail, 'subject' | 'snippet' | 'from'>): Promise<ClassificationResult> {
  const prompt = [
    'Classify this email into exactly one category. It is either about a job application the candidate already sent, or unrelated to that.',
    '',
    'Categories:',
    CATEGORY_GUIDE,
    '',
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Preview: ${email.snippet}`,
  ].join('\n');

  const structured = await callClaude(prompt, { jsonSchema: JSON_SCHEMA, maxBudgetUsd: 0.2 });
  return ClassificationSchema.parse(structured);
}
