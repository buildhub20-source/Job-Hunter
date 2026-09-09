import { query, one } from '@jobops/db';
import { createApproval, type ApprovalDeps } from './service.js';
import { evaluateRetry, retryNeedsChange, MAX_RETRIES } from './policy.js';

export interface RetryRequest {
  applicationId: string;
  failureClass: string;
  failureDetail: string;
  proposedChange: string;
  company: string;
  role: string;
  requisitionId: string | null;
  runId: string | null;
}

export type RetryOutcome =
  | { status: 'approval_requested'; attemptNumber: number; approvalId: string }
  | { status: 'exhausted' }
  | { status: 'awaiting_approval' }
  | { status: 'rejected'; reason: string };

/**
 * Never retries. Only ever asks. The worker retries after the answer comes back.
 * After the third failure the application goes to NEEDS_HUMAN_REVIEW and a
 * notification fires — no fourth card is ever raised.
 */
export async function requestRetryApproval(deps: ApprovalDeps, req: RetryRequest): Promise<RetryOutcome> {
  const app = await one<{ retry_count: number }>(
    `SELECT retry_count FROM applications WHERE id = $1`, [req.applicationId],
  );
  if (!app) return { status: 'rejected', reason: 'unknown application' };

  const pending = await one<{ id: string }>(
    `SELECT id FROM approvals WHERE application_id = $1 AND type = 'retry' AND status = 'pending'`,
    [req.applicationId],
  );

  const decision = evaluateRetry({
    retryCount: app.retry_count,
    hasPendingRetryApproval: Boolean(pending),
  });

  if (!decision.allowed && decision.reason === 'exhausted') {
    await query(
      `UPDATE applications SET status='NEEDS_HUMAN_REVIEW', updated_at=now() WHERE id=$1`,
      [req.applicationId],
    );
    await query(
      `INSERT INTO application_events (application_id, to_state, reason, actor)
       VALUES ($1,'NEEDS_HUMAN_REVIEW',$2,'orchestrator')`,
      [req.applicationId, `retry limit of ${MAX_RETRIES} reached after ${req.failureClass}`],
    );
    return { status: 'exhausted' };
  }
  if (!decision.allowed) return { status: 'awaiting_approval' };

  if (retryNeedsChange(req.failureClass) && !req.proposedChange.trim()) {
    return { status: 'rejected', reason: `${req.failureClass} must not be retried unchanged` };
  }

  const { approvalId } = await createApproval(deps, {
    type: 'retry',
    applicationId: req.applicationId,
    runId: req.runId,
    question: `Retry ${decision.attemptNumber} of ${MAX_RETRIES}?`,
    blockedReason: `${req.failureClass}: ${req.failureDetail}\nProposed: ${req.proposedChange}`,
    choices: ['Approve retry', 'Keep parked'],
    allowFreeText: false,
    company: req.company,
    role: req.role,
    requisitionId: req.requisitionId,
    context: { failureClass: req.failureClass, proposedChange: req.proposedChange },
  });

  await query(
    `INSERT INTO retry_attempts (application_id, attempt_number, failure_class, failure_detail, proposed_change, approval_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (application_id, attempt_number) DO NOTHING`,
    [req.applicationId, decision.attemptNumber, req.failureClass, req.failureDetail, req.proposedChange, approvalId],
  );
  await query(
    `UPDATE applications SET status='RETRY_APPROVAL_REQUIRED', updated_at=now() WHERE id=$1`,
    [req.applicationId],
  );

  return { status: 'approval_requested', attemptNumber: decision.attemptNumber, approvalId };
}
