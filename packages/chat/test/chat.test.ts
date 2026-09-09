import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalCard, buildNotificationCard, escapeHtml, joinUrl } from '../src/cards.js';
import { parseInteraction, SKIP_ANSWER } from '../src/parse.js';
import type { ApprovalCardInput } from '../src/types.js';

const base: ApprovalCardInput = {
  approvalId: 'a-1', type: 'information', company: 'Microsoft', role: 'Software Engineer',
  requisitionId: '2000123', question: 'Will you now or in the future require sponsorship?',
  knownFacts: [{ key: 'current_country', value: 'India' }],
  blockedReason: 'No approved value for requires_sponsorship_us',
  choices: ['Yes', 'No'], allowFreeText: true, offerScope: true,
};

test('approval card carries the question, requisition and scope selector', () => {
  const card = buildApprovalCard(base) as any;
  const c = card.cardsV2[0].card;
  assert.match(c.header.subtitle, /2000123/);
  const widgets = JSON.stringify(c.sections[0].widgets);
  assert.match(widgets, /require sponsorship/);
  assert.match(widgets, /current_country/);
  assert.match(widgets, /"name":"scope"/);
  assert.match(widgets, /permanent/);
});

test('retry cards do not offer a scope', () => {
  const card = buildApprovalCard({ ...base, type: 'retry', offerScope: false }) as any;
  assert.doesNotMatch(JSON.stringify(card), /"name":"scope"/);
});

test('every card offers a way out that is not an answer', () => {
  const card = buildApprovalCard(base) as any;
  assert.match(JSON.stringify(card), /Skip this job/);
});

test('html in a job posting cannot inject into the card', () => {
  const card = buildApprovalCard({ ...base, question: 'Salary <b>range</b> & "notes"?' }) as any;
  const s = JSON.stringify(card);
  assert.match(s, /&lt;b&gt;/);
  assert.doesNotMatch(s, /<b>range<\/b>/);
});

test('escapeHtml and joinUrl behave', () => {
  assert.equal(escapeHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
  assert.equal(joinUrl('http://localhost:3000/', '/applications'), 'http://localhost:3000/applications');
});

test('notification links back to the dashboard', () => {
  const card = buildNotificationCard({
    notificationId: 'n-1', kind: 'captcha', title: 'Blocked on CAPTCHA',
    body: 'Amazon SDE I', dashboardPath: '/applications', dashboardBaseUrl: 'http://localhost:3000',
  }) as any;
  assert.match(JSON.stringify(card), /http:\/\/localhost:3000\/applications/);
});

test('a button click becomes an answer', () => {
  const answer = parseInteraction({
    type: 'CARD_CLICKED',
    user: { email: 'prasath.hub@gmail.com' },
    common: {
      invokedFunction: 'answer',
      parameters: { approvalId: 'a-1', answer: 'No' },
      formInputs: { scope: { stringInputs: { value: ['permanent'] } } },
    },
  });
  assert.deepEqual(answer, {
    approvalId: 'a-1', answer: 'No', scope: 'permanent',
    respondedBy: 'prasath.hub@gmail.com', messageId: undefined,
  });
});

test('a typed answer is read from the form', () => {
  const answer = parseInteraction({
    type: 'CARD_CLICKED',
    common: {
      invokedFunction: 'answer_free_text',
      parameters: { approvalId: 'a-2' },
      formInputs: { free_text: { stringInputs: { value: ['  45 days  '] } } },
    },
  });
  assert.equal(answer?.answer, '45 days');
});

test('an empty typed answer is not an answer', () => {
  assert.equal(parseInteraction({
    type: 'CARD_CLICKED',
    common: { invokedFunction: 'answer_free_text', parameters: { approvalId: 'a-2' },
      formInputs: { free_text: { stringInputs: { value: ['   '] } } } },
  }), null);
});

test('missing scope falls back to the narrowest, never permanent', () => {
  const answer = parseInteraction({
    type: 'CARD_CLICKED',
    common: { invokedFunction: 'answer', parameters: { approvalId: 'a-1', answer: 'Yes' } },
  });
  assert.equal(answer?.scope, 'this_job');
});

test('a forged scope value is ignored', () => {
  const answer = parseInteraction({
    type: 'CARD_CLICKED',
    common: { invokedFunction: 'answer', parameters: { approvalId: 'a-1', answer: 'Yes' },
      formInputs: { scope: { stringInputs: { value: ['everything_forever'] } } } },
  });
  assert.equal(answer?.scope, 'this_job');
});

test('skip is recognised and is always job-scoped', () => {
  const answer = parseInteraction({
    type: 'CARD_CLICKED',
    common: { invokedFunction: 'skip', parameters: { approvalId: 'a-3' },
      formInputs: { scope: { stringInputs: { value: ['permanent'] } } } },
  });
  assert.equal(answer?.answer, SKIP_ANSWER);
  assert.equal(answer?.scope, 'this_job');
});

test('non-interaction events produce nothing rather than a guess', () => {
  assert.equal(parseInteraction({ type: 'MESSAGE', message: { text: 'yes' } }), null);
  assert.equal(parseInteraction({ type: 'ADDED_TO_SPACE' }), null);
  assert.equal(parseInteraction({ type: 'CARD_CLICKED', common: { invokedFunction: 'answer' } }), null);
  assert.equal(parseInteraction({ type: 'CARD_CLICKED', common: { invokedFunction: 'unknown_button', parameters: { approvalId: 'a' } } }), null);
  assert.equal(parseInteraction(null), null);
  assert.equal(parseInteraction('nope'), null);
});
