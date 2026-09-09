/**
 * Pure approval rules. No database, no network, no dependencies —
 * these are the rules the plan says must never bend, so they are testable alone.
 */

export type ApprovalScope = 'this_job' | 'this_run' | 'permanent';
export const MAX_RETRIES = 3;

export interface StoredAnswer {
  fieldKey: string;
  answer: string;
  scope: ApprovalScope;
  applicationId: string | null;
  runId: string | null;
}

export interface AnswerLookup {
  fieldKey: string;
  applicationId: string;
  runId: string;
}

/**
 * Rule: a `this_job` answer must never leak to another job, and a `this_run`
 * answer must never leak to another run. Permanent answers do not live here at
 * all — they are written into personal.md and read back as ordinary facts.
 */
export function answerApplies(stored: StoredAnswer, at: AnswerLookup): boolean {
  if (stored.fieldKey !== at.fieldKey) return false;
  switch (stored.scope) {
    case 'this_job':
      return stored.applicationId !== null && stored.applicationId === at.applicationId;
    case 'this_run':
      return stored.runId !== null && stored.runId === at.runId;
    case 'permanent':
      return false;
  }
}

export function findApplicableAnswer(stored: StoredAnswer[], at: AnswerLookup): StoredAnswer | null {
  // Narrower scope wins when both exist.
  const job = stored.find((s) => s.scope === 'this_job' && answerApplies(s, at));
  if (job) return job;
  return stored.find((s) => s.scope === 'this_run' && answerApplies(s, at)) ?? null;
}

export interface RetryState { retryCount: number; hasPendingRetryApproval: boolean }
export type RetryDecision =
  | { allowed: true; attemptNumber: number }
  | { allowed: false; reason: 'exhausted' | 'awaiting_approval' };

/** Rule: no retry without approval, and never more than three. */
export function evaluateRetry(state: RetryState): RetryDecision {
  if (state.retryCount >= MAX_RETRIES) return { allowed: false, reason: 'exhausted' };
  if (state.hasPendingRetryApproval) return { allowed: false, reason: 'awaiting_approval' };
  return { allowed: true, attemptNumber: state.retryCount + 1 };
}

/** Validation failures must not be retried unchanged — the retry has to propose a change. */
const NON_RETRYABLE_UNCHANGED = new Set(['validation_failure', 'missing_information', 'duplicate', 'posting_closed']);

export function retryNeedsChange(failureClass: string): boolean {
  return NON_RETRYABLE_UNCHANGED.has(failureClass);
}

/**
 * Rule: no reply is not an answer. A pending approval past its window keeps the
 * job parked for the next run; it never resolves to a default.
 */
export function isStillPending(createdAt: Date, now: Date, windowHours: number): boolean {
  return now.getTime() - createdAt.getTime() < windowHours * 3600 * 1000;
}

/** Retry and action cards are one-shot: scope would be meaningless. */
export function scopeAllowedFor(type: string): boolean {
  return type === 'information' || type === 'conflict';
}
