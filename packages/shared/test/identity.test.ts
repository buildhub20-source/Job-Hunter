import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationKey, resolveIdentity, normalizeUrl, canTransition } from '../src/index.js';

const amazon = { canonicalEmployerId: 'amazon', atsTenantId: 'amazon_jobs' };

test('same company + same req -> same key (blocked)', () => {
  const a = applicationKey({ ...amazon, requisitionId: '3121001' });
  const b = applicationKey({ ...amazon, requisitionId: '3121001' });
  assert.equal(a, b);
});

test('same company + different req -> different key (allowed)', () => {
  const a = applicationKey({ ...amazon, requisitionId: '3121001' });
  const b = applicationKey({ ...amazon, requisitionId: '3121002' });
  assert.notEqual(a, b);
});

test('same title and same JD do not enter the key at all', () => {
  // The key is built from identity only; title/JD are absent by construction.
  const key = applicationKey({ ...amazon, requisitionId: '3121003' });
  assert.equal(key, 'amazon::amazon_jobs::3121003');
});

test('same req from different source URLs -> same key (blocked)', () => {
  const fromLinkedIn = resolveIdentity({
    requisitionId: '3121001', employerId: 'amazon', title: 'SDE I',
    postingUrl: 'https://linkedin.com/jobs/view/1?utm_source=x',
  });
  const fromCareers = resolveIdentity({
    requisitionId: '3121001', employerId: 'amazon', title: 'SDE I',
    postingUrl: 'https://amazon.jobs/en/jobs/3121001',
  });
  assert.equal(fromLinkedIn.identifier, fromCareers.identifier);
  assert.equal(
    applicationKey({ ...amazon, requisitionId: fromLinkedIn.identifier }),
    applicationKey({ ...amazon, requisitionId: fromCareers.identifier }),
  );
});

test('identity ladder degrades in order and flags the last rung as unreliable', () => {
  assert.equal(resolveIdentity({ requisitionId: 'R1', employerId: 'e', title: 't' }).source, 'requisition_id');
  assert.equal(resolveIdentity({ employerJobId: 'J1', employerId: 'e', title: 't' }).source, 'employer_job_id');
  assert.equal(resolveIdentity({ canonicalAtsUrl: 'https://x.io/a', employerId: 'e', title: 't' }).source, 'canonical_ats_url');
  assert.equal(resolveIdentity({ postingUrl: 'https://x.io/b', employerId: 'e', title: 't' }).source, 'normalized_posting_url');

  const last = resolveIdentity({ employerId: 'e', title: 't' });
  assert.equal(last.source, 'composite_fingerprint');
  assert.equal(last.reliable, false, 'must be unreliable so the caller raises an approval');
});

test('applicationKey refuses to build from a blank part', () => {
  assert.throws(() => applicationKey({ ...amazon, requisitionId: '  ' }));
});

test('url normalization strips tracking params but keeps identity', () => {
  assert.equal(
    normalizeUrl('https://boards.greenhouse.io/acme/jobs/42?utm_source=li&gh_src=abc'),
    'https://boards.greenhouse.io/acme/jobs/42',
  );
});

test('state machine forbids applying straight from DISCOVERED', () => {
  assert.equal(canTransition('DISCOVERED', 'APPLYING'), false);
  assert.equal(canTransition('QUEUED_TO_APPLY', 'APPLYING'), true);
  assert.equal(canTransition('APPLYING', 'SUBMITTED_UNVERIFIED'), true);
  assert.equal(canTransition('REJECTED', 'APPLYING'), false);
});
