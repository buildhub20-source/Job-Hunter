import type { RawEmail, ClassificationResult, InboxClass } from './types.js';

interface Rule { classification: InboxClass; patterns: RegExp[] }

/**
 * Deterministic, near-zero-cost classification. Plan section 16: filters before any
 * model call. Order matters — rejection language is checked before interview/
 * confirmation language, because "unfortunately, we won't be moving forward after
 * your interview" contains "interview" but is unambiguously a rejection.
 */
const RULES: Rule[] = [
  {
    classification: 'offer',
    patterns: [/pleased to offer/i, /extend(ing)? (you )?an offer/i, /\bjob offer\b/i, /\boffer letter\b/i],
  },
  {
    classification: 'rejection',
    patterns: [
      /\bunfortunately\b/i, /moving forward with other candidates/i, /will not be (moving|proceeding)/i,
      /not (be )?(selected|proceeding|moving forward)/i, /position has been filled/i,
      /decided not to move forward/i, /pursue other candidates/i,
    ],
  },
  {
    classification: 'interview',
    patterns: [
      /schedule (an|your) interview/i, /interview invitation/i, /like to invite you (for|to) an interview/i,
      /\bphone screen\b/i, /schedule a (call|time) (with|to)/i, /next steps? .* interview/i,
    ],
  },
  {
    classification: 'assessment',
    patterns: [
      /coding (challenge|assessment|test)/i, /technical assessment/i, /\bhackerrank\b/i, /\bcodility\b/i,
      /online assessment/i, /take-home (test|assignment)/i, /complete (a|the) (test|assessment)/i,
    ],
  },
  {
    classification: 'confirmation',
    patterns: [
      /(thank you|thanks) for (applying|your application)/i, /we('| ha)ve received your application/i,
      /application (has been )?received/i, /your application (for|to) .* (has been|was) received/i,
    ],
  },
  {
    classification: 'job_alert',
    patterns: [/new jobs? (matching|that match)/i, /\bjob alert\b/i, /jobs? for you/i, /recommended jobs/i],
  },
  {
    classification: 'recruiter',
    patterns: [
      /reaching out (to|regarding)/i, /wanted to connect (with you )?(regarding|about)/i,
      /exciting opportunity/i, /come across your profile/i, /\btalent (acquisition|partner)\b/i,
    ],
  },
];

const JOB_ALERT_SENDERS = [
  'jobalerts-noreply@linkedin.com', 'jobs-noreply@linkedin.com', 'alerts@naukri.com', 'noreply@indeedemail.com',
];

/**
 * Returns a classification only when confident enough to act without asking. Anything
 * inconclusive returns null rather than guessing — the caller falls back to the LLM.
 */
export function classifyDeterministic(email: Pick<RawEmail, 'subject' | 'snippet' | 'from'>): ClassificationResult | null {
  const text = `${email.subject}\n${email.snippet}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { classification: rule.classification, confidence: 0.85 };
    }
  }
  if (JOB_ALERT_SENDERS.some((s) => email.from.toLowerCase().includes(s))) {
    return { classification: 'job_alert', confidence: 0.9 };
  }
  return null;
}
