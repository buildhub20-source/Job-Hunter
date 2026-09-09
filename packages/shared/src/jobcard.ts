import { z } from 'zod';

/** The only job representation reasoning workers ever see. Plan section 8. */
export const JobCardSchema = z.object({
  employer_id: z.string().min(1),
  company_name: z.string().min(1),
  title: z.string().min(1),
  requisition_id: z.string().nullable(),
  ats: z.string().min(1),
  location: z.array(z.string()).default([]),
  remote_type: z.enum(['onsite', 'hybrid', 'remote', 'unknown']).default('unknown'),
  experience_min: z.number().nullable().default(null),
  experience_max: z.number().nullable().default(null),
  required_skills: z.array(z.string()).default([]),
  preferred_skills: z.array(z.string()).default([]),
  compensation_min: z.number().nullable().default(null),
  compensation_max: z.number().nullable().default(null),
  currency: z.string().nullable().default(null),
  work_authorization_text: z.string().nullable().default(null),
  source_url: z.string().url(),
  official_url: z.string().url().nullable().default(null),
  job_family_hash: z.string().nullable().default(null),
  jd_hash: z.string().min(1),
  verified_at: z.string().datetime().nullable().default(null),
});

export type JobCard = z.infer<typeof JobCardSchema>;

export const EvaluationSchema = z.object({
  tier: z.enum(['A', 'B', 'C', 'SKIP']),
  reason: z.string().min(1),
  missing_info: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  resume_variant: z.string().nullable().default(null),
  approval_needs: z
    .array(z.object({ field_key: z.string(), question: z.string() }))
    .default([]),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;
