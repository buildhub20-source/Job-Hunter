import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeterministic } from '../src/classify.js';
import { extractRequisitionId } from '../src/extract.js';

const email = (subject: string, snippet: string, from = 'careers@acme.com') => ({ subject, snippet, from });

test('a clear rejection is classified even though it mentions "interview"', () => {
  const result = classifyDeterministic(email(
    'Update on your application',
    "Unfortunately, after your interview we've decided to move forward with other candidates.",
  ));
  assert.equal(result?.classification, 'rejection');
});

test('an interview invite is classified as interview', () => {
  const result = classifyDeterministic(email(
    'Next steps for Software Engineer',
    "We'd like to invite you for an interview next week. Please schedule a time that works.",
  ));
  assert.equal(result?.classification, 'interview');
});

test('an application confirmation is classified as confirmation', () => {
  const result = classifyDeterministic(email(
    'Thank you for applying to Acme',
    'We have received your application and will be in touch.',
  ));
  assert.equal(result?.classification, 'confirmation');
});

test('an assessment link is classified as assessment', () => {
  const result = classifyDeterministic(email(
    'Complete your coding challenge',
    'Please complete the technical assessment on HackerRank within 5 days.',
  ));
  assert.equal(result?.classification, 'assessment');
});

test('an offer is classified as offer', () => {
  const result = classifyDeterministic(email(
    'Offer of employment',
    'We are pleased to offer you the position of Software Engineer.',
  ));
  assert.equal(result?.classification, 'offer');
});

test('a job board digest is classified as job_alert by sender, even with generic text', () => {
  const result = classifyDeterministic(email(
    '5 new jobs for you',
    'Check out these opportunities.',
    'jobalerts-noreply@linkedin.com',
  ));
  assert.equal(result?.classification, 'job_alert');
});

test('recruiter outreach is classified as recruiter', () => {
  const result = classifyDeterministic(email(
    'Exciting opportunity at Globex',
    'Hi, I came across your profile and wanted to connect regarding a role.',
  ));
  assert.equal(result?.classification, 'recruiter');
});

test('genuinely ambiguous text returns null rather than guessing', () => {
  const result = classifyDeterministic(email('Hello', 'Just checking in.'));
  assert.equal(result, null);
});

test('requisition id is extracted from common phrasings', () => {
  assert.equal(extractRequisitionId('Requisition ID: 3121001'), '3121001');
  assert.equal(extractRequisitionId('Req #REQ-4455'), 'REQ-4455');
  assert.equal(extractRequisitionId('no identifying numbers here'), null);
});
