import { query, one } from '@jobops/db';
import { upsertFact, commitDataChange, validateAfterWrite, loadProfile } from '@jobops/profile';
import type { ChatTransport, ApprovalCardInput } from '@jobops/chat';
import { SKIP_ANSWER } from '@jobops/chat';
import { scopeAllowedFor, findApplicableAnswer, type ApprovalScope, type StoredAnswer } from './policy.js';

export interface CreateApprovalInput {
  type: 'information' | 'conflict' | 'retry' | 'action';
  applicationId?: string | null;
  jobPostingId?: string | null;
  runId?: string | null;
  question: string;
  fieldKey?: string | null;
  blockedReason: string;
  choices?: string[];
  allowFreeText?: boolean;
  company: string;
  role: string;
  requisitionId?: string | null;
  /** personal.md keys worth showing on the card. */
  relevantFactKeys?: string[];
  context?: Record<string, unknown>;
}

export interface ApprovalDeps {
  transport: ChatTransport;
  dataDir: string;
  repoRoot: string;
}

/**
 * Raise a question. Writes the row, posts the card, records the chat message.
 * The caller parks the job — this never answers anything itself.
 */
export async function createApproval(
  deps: ApprovalDeps,
  input: CreateApprovalInput,
): Promise<{ approvalId: string; messageId: string | null }> {
  const row = await one<{ id: string }>(
    `INSERT INTO approvals (application_id, job_posting_id, run_id, type, question, field_key, context)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      input.applicationId ?? null,
      input.jobPostingId ?? null,
      input.runId ?? null,
      input.type,
      input.question,
      input.fieldKey ?? null,
      JSON.stringify({ ...input.context, blockedReason: input.blockedReason }),
    ],
  );
  if (!row) throw new Error('failed to create approval');
  const approvalId = row.id;

  const bundle = await loadProfile(deps.dataDir);
  const knownFacts = (input.relevantFactKeys ?? [])
    .map((k) => bundle.factsByKey.get(k))
    .filter((f): f is NonNullable<typeof f> => Boolean(f) && f!.usable)
    .map((f) => ({ key: f.key, value: f.value }));

  const card: ApprovalCardInput = {
    approvalId,
    type: input.type,
    company: input.company,
    role: input.role,
    requisitionId: input.requisitionId ?? null,
    question: input.question,
    knownFacts,
    blockedReason: input.blockedReason,
    choices: input.choices ?? ['Yes', 'No'],
    allowFreeText: input.allowFreeText ?? true,
    offerScope: scopeAllowedFor(input.type),
  };

  const posted = await deps.transport.postApproval(card);

  await query(
    `UPDATE approvals SET chat_message_id = $2 WHERE id = $1`,
    [approvalId, posted.messageId],
  );
  await query(
    `INSERT INTO chat_messages (direction, space_id, message_id, approval_id, body)
     VALUES ('outbound', $1, $2, $3, $4)`,
    [process.env['GCHAT_SPACE_ID'] ?? 'stub', posted.messageId, approvalId, input.question],
  );
  await query(
    `INSERT INTO approval_events (approval_id, event, payload) VALUES ($1,'created',$2)`,
    [approvalId, JSON.stringify({ type: input.type, transport: deps.transport.name })],
  );
  await query(
    `INSERT INTO audit_events (actor, action, application_id, approval_id, reason, result)
     VALUES ('orchestrator','approval.created',$1,$2,$3,'pending')`,
    [input.applicationId ?? null, approvalId, input.blockedReason],
  );

  return { approvalId, messageId: posted.messageId };
}

export interface AnswerInput {
  approvalId: string;
  answer: string;
  scope: ApprovalScope;
  respondedBy: string;
}

export interface AnswerResult {
  status: 'answered' | 'skipped' | 'already_answered' | 'not_found';
  wroteToFile?: string | null;
  commit?: string | null;
}

/** Apply an answer. The only place an approval ever resolves. */
export async function answerApproval(deps: ApprovalDeps, input: AnswerInput): Promise<AnswerResult> {
  const approval = await one<{
    id: string; status: string; type: string; field_key: string | null; application_id: string | null;
  }>(`SELECT id, status, type, field_key, application_id FROM approvals WHERE id = $1`, [input.approvalId]);

  if (!approval) return { status: 'not_found' };
  if (approval.status !== 'pending') return { status: 'already_answered' };

  const skipped = input.answer === SKIP_ANSWER;
  // Scope is ignored for card types where it was never offered.
  const scope: ApprovalScope = scopeAllowedFor(approval.type) ? input.scope : 'this_job';

  await query(
    `UPDATE approvals
        SET status = $2, approved_answer = $3, scope = $4, answered_at = now()
      WHERE id = $1`,
    [approval.id, skipped ? 'cancelled' : 'answered', skipped ? null : input.answer, scope],
  );
  await query(
    `INSERT INTO approval_events (approval_id, event, payload) VALUES ($1,$2,$3)`,
    [approval.id, skipped ? 'skipped' : 'answered', JSON.stringify({ by: input.respondedBy, scope })],
  );

  if (skipped) {
    if (approval.application_id) {
      await query(
        `UPDATE applications SET status='WITHDRAWN', updated_at=now() WHERE id=$1`,
        [approval.application_id],
      );
      await query(
        `INSERT INTO application_events (application_id, to_state, reason, actor)
         VALUES ($1,'WITHDRAWN','skipped from chat','user')`,
        [approval.application_id],
      );
    }
    return { status: 'skipped' };
  }

  // this_job answers are recorded against the application so the form can use them.
  if (approval.application_id && approval.field_key) {
    await query(
      `INSERT INTO application_answers (application_id, field_key, question, answer, answer_origin, approval_id)
       VALUES ($1,$2,'',$3,'approval',$4)
       ON CONFLICT (application_id, field_key) DO UPDATE SET answer = EXCLUDED.answer`,
      [approval.application_id, approval.field_key, input.answer, approval.id],
    );
  }

  let wroteToFile: string | null = null;
  let commit: string | null = null;

  if (scope === 'permanent' && approval.field_key) {
    await upsertFact(deps.dataDir, {
      key: approval.field_key,
      value: input.answer,
      source: 'approval',
      notes: `approved in chat by ${input.respondedBy}`,
    });
    await validateAfterWrite(deps.dataDir);
    commit = await commitDataChange(deps.repoRoot, `profile(${approval.field_key}): approved in chat`);
    wroteToFile = 'data/personal.md';
    await query(`UPDATE approvals SET policy_file_updated = $2 WHERE id = $1`, [approval.id, wroteToFile]);
  }

  await query(
    `INSERT INTO audit_events (actor, action, application_id, approval_id, reason, result)
     VALUES ($1,'approval.answered',$2,$3,$4,'ok')`,
    [input.respondedBy, approval.application_id, approval.id, `scope=${scope}`],
  );

  return { status: 'answered', wroteToFile, commit };
}

/** Answers already given in this run, so the same question is not asked twice. */
export async function loadRunAnswers(runId: string): Promise<StoredAnswer[]> {
  const rows = await query<{
    field_key: string; approved_answer: string; scope: ApprovalScope;
    application_id: string | null; run_id: string | null;
  }>(
    `SELECT field_key, approved_answer, scope, application_id, run_id
       FROM approvals
      WHERE status='answered' AND field_key IS NOT NULL
        AND (run_id = $1 OR scope = 'this_job')`,
    [runId],
  );
  return rows.map((r) => ({
    fieldKey: r.field_key,
    answer: r.approved_answer,
    scope: r.scope,
    applicationId: r.application_id,
    runId: r.run_id,
  }));
}

export { findApplicableAnswer };

export async function pendingApprovals(): Promise<Record<string, unknown>[]> {
  return query(
    `SELECT id, type, question, field_key, application_id, created_at
       FROM approvals WHERE status='pending' ORDER BY created_at`,
  );
}
