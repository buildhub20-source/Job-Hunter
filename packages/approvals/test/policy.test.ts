import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerApplies, findApplicableAnswer, evaluateRetry, retryNeedsChange,
  isStillPending, scopeAllowedFor, MAX_RETRIES, type StoredAnswer,
} from '../src/policy.js';

const at = { fieldKey: 'requires_sponsorship_us', applicationId: 'app-1', runId: 'run-1' };

test('a this_job answer does not leak to another job', () => {
  const stored: StoredAnswer = { fieldKey: at.fieldKey, answer: 'no', scope: 'this_job', applicationId: 'app-1', runId: 'run-1' };
  assert.equal(answerApplies(stored, at), true);
  assert.equal(answerApplies(stored, { ...at, applicationId: 'app-2' }), false);
});

test('a this_run answer applies across jobs in the run but not to the next run', () => {
  const stored: StoredAnswer = { fieldKey: at.fieldKey, answer: 'no', scope: 'this_run', applicationId: 'app-1', runId: 'run-1' };
  assert.equal(answerApplies(stored, { ...at, applicationId: 'app-9' }), true);
  assert.equal(answerApplies(stored, { ...at, runId: 'run-2' }), false);
});

test('permanent answers are never served from the approvals table', () => {
  // They live in personal.md and are read back as ordinary facts.
  const stored: StoredAnswer = { fieldKey: at.fieldKey, answer: 'no', scope: 'permanent', applicationId: 'app-1', runId: 'run-1' };
  assert.equal(answerApplies(stored, at), false);
});

test('a different field never matches', () => {
  const stored: StoredAnswer = { fieldKey: 'notice_period_days', answer: '60', scope: 'this_run', applicationId: null, runId: 'run-1' };
  assert.equal(answerApplies(stored, at), false);
});

test('narrower scope wins when both exist', () => {
  const stored: StoredAnswer[] = [
    { fieldKey: at.fieldKey, answer: 'run answer', scope: 'this_run', applicationId: null, runId: 'run-1' },
    { fieldKey: at.fieldKey, answer: 'job answer', scope: 'this_job', applicationId: 'app-1', runId: 'run-1' },
  ];
  assert.equal(findApplicableAnswer(stored, at)?.answer, 'job answer');
});

test('no stored answer returns null, never a default', () => {
  assert.equal(findApplicableAnswer([], at), null);
});

test('retry is allowed up to three and never beyond', () => {
  assert.deepEqual(evaluateRetry({ retryCount: 0, hasPendingRetryApproval: false }), { allowed: true, attemptNumber: 1 });
  assert.deepEqual(evaluateRetry({ retryCount: 2, hasPendingRetryApproval: false }), { allowed: true, attemptNumber: 3 });
  assert.deepEqual(evaluateRetry({ retryCount: MAX_RETRIES, hasPendingRetryApproval: false }), { allowed: false, reason: 'exhausted' });
  assert.deepEqual(evaluateRetry({ retryCount: 9, hasPendingRetryApproval: false }), { allowed: false, reason: 'exhausted' });
});

test('a retry cannot be requested while one is already pending', () => {
  assert.deepEqual(evaluateRetry({ retryCount: 1, hasPendingRetryApproval: true }), { allowed: false, reason: 'awaiting_approval' });
});

test('validation failures must not be retried unchanged', () => {
  assert.equal(retryNeedsChange('validation_failure'), true);
  assert.equal(retryNeedsChange('missing_information'), true);
  assert.equal(retryNeedsChange('duplicate'), true);
  assert.equal(retryNeedsChange('transient_network'), false);
});

test('no reply is not an answer — it stays pending', () => {
  const created = new Date('2026-09-09T10:00:00Z');
  assert.equal(isStillPending(created, new Date('2026-09-09T10:30:00Z'), 24), true);
  assert.equal(isStillPending(created, new Date('2026-09-11T10:00:00Z'), 24), false, 'expired, but never auto-answered');
});

test('scope is offered only where it is meaningful', () => {
  assert.equal(scopeAllowedFor('information'), true);
  assert.equal(scopeAllowedFor('conflict'), true);
  assert.equal(scopeAllowedFor('retry'), false);
  assert.equal(scopeAllowedFor('action'), false);
});
