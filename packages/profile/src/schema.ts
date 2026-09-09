import { z } from 'zod';

const yesNo = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['yes', 'no', 'true', 'false']))
  .transform((v) => v === 'yes' || v === 'true');

const optionalDate = z
  .string()
  .transform((v) => (v.trim() === '' || v.trim() === '-' ? null : v.trim()))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), { message: 'not a valid date' });

/** One row of a personal.md table. Plan section 5. */
export const FactRowSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  source: z.string().default('user'),
  approved: yesNo,
  approved_at: optionalDate,
  expires_at: optionalDate,
  sensitivity: z.enum(['low', 'normal', 'high']).default('normal'),
  notes: z.string().default(''),
});
export type FactRow = z.infer<typeof FactRowSchema>;

export const PolicyRowSchema = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  value: z.string(),
  scope: z.string().default('global'),
  priority: z.coerce.number().int().default(100),
  type: z.enum(['hard_gate', 'ranking_signal']),
  effective_from: optionalDate,
  notes: z.string().default(''),
});
export type PolicyRow = z.infer<typeof PolicyRowSchema>;

export interface Fact extends FactRow {
  section: string;
  /** approved, in date, and non-empty -> the agent may use it without asking */
  usable: boolean;
}

export interface LoadIssue {
  file: string;
  line: string;
  message: string;
}
