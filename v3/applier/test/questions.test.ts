import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnswerStore, parseReply, matchOption, labelKey } from '../src/questions.js';

const freshStore = () => new AnswerStore(join(mkdtempSync(join(tmpdir(), 'answers-')), 'answers.json'));
const meta = { company: 'BitGo', role: 'Backend Engineer', applyLink: 'https://example.com/job' };

test('a reply is read line by line, in any of the usual number styles', () => {
  assert.deepEqual(parseReply('1: No\n2) Yes\n3 - always Other', 3), [
    { n: 1, answer: 'No', always: false },
    { n: 2, answer: 'Yes', always: false },
    { n: 3, answer: 'Other', always: true },
  ]);
});

test('a number followed by just a space counts, as Vinoth actually typed it', () => {
  // Verbatim from the first real reply, 2026-09-15.
  assert.deepEqual(parseReply("1 Other\n2. Bachelor's degree\n4.can relocate", 6), [
    { n: 1, answer: 'Other', always: false },
    { n: 2, answer: "Bachelor's degree", always: false },
    { n: 4, answer: 'can relocate', always: false },
  ]);
});

test('an essay opening with a number is not mistaken for a numbered answer', () => {
  assert.deepEqual(parseReply('3 years ago I built a carrier platform', 1), [
    { n: 1, answer: '3 years ago I built a carrier platform', always: false },
  ]);
});

test('a rejected choice comes back with the closest options', () => {
  const store = freshStore();
  store.recordBlocked('greenhouse:1', meta, [{
    label: 'Discipline*', reason: 'x', optionsKind: 'choices',
    options: ['Accounting', 'Computer Science', 'Information Systems', 'Nuclear Technics'],
  }]);
  const [outcome] = store.applyReply('greenhouse:1', 'Information technology');
  assert.equal(outcome!.status, 'rejected');
  assert.match((outcome as { message: string }).message, /Closest: `Information Systems`/);
});

test('a single-question job can be answered without a number', () => {
  assert.deepEqual(parseReply('No', 1), [{ n: 1, answer: 'No', always: false }]);
  assert.deepEqual(parseReply('No', 2), []);
});

test('an answer matches a choice exactly, or as the only choice containing it', () => {
  const options = ["Bachelor's Degree", "Master's Degree", 'Other'];
  assert.equal(matchOption('other', options), 'Other');
  assert.equal(matchOption('bachelor', options), "Bachelor's Degree");
  assert.equal(matchOption('degree', options), null);
  assert.equal(matchOption('PhD', options), null);
});

test('answers are validated against fixed choices and saved per job', () => {
  const store = freshStore();
  store.recordBlocked('greenhouse:1', meta, [
    { label: 'Degree*', reason: 'no option matched', options: ["Bachelor's Degree", 'Other'], optionsKind: 'choices' },
    { label: 'Are you comfortable with 5 days in office?*', reason: 'needs a human answer' },
  ]);

  const outcomes = store.applyReply('greenhouse:1', '1: btech\n2: Yes');
  assert.equal(outcomes[0]!.status, 'rejected');
  assert.equal(outcomes[1]!.status, 'saved');
  assert.deepEqual(store.unanswered('greenhouse:1').map((q) => q.n), [1]);

  store.applyReply('greenhouse:1', '1: bachelor');
  assert.equal(store.lookup('greenhouse:1', 'Degree'), "Bachelor's Degree");
  assert.equal(store.unanswered('greenhouse:1').length, 0);
});

test('search suggestions are hints: any answer is accepted and tried on the form', () => {
  const store = freshStore();
  store.recordBlocked('greenhouse:1', meta, [
    { label: 'School*', reason: 'no option matched', options: ['Sri Krishna Arts and Science College'], optionsKind: 'suggestions' },
  ]);
  assert.equal(store.applyReply('greenhouse:1', 'Sri Krishna College of Engineering')[0]!.status, 'saved');
});

test('"always" answers carry over to the same question on another job', () => {
  const store = freshStore();
  store.recordBlocked('greenhouse:1', meta, [{ label: 'How did you hear about us?', reason: 'x' }]);
  store.applyReply('greenhouse:1', 'always Company Website');
  assert.equal(store.lookup('lever:2', 'How did you hear about us?*'), 'Company Website');
  store.recordBlocked('greenhouse:3', meta, [{ label: 'Previously worked here?', reason: 'x' }]);
  store.applyReply('greenhouse:3', 'No');
  assert.equal(store.lookup('lever:2', 'Previously worked here?'), null);
});

test('the same open questions are not posted again on a re-run', () => {
  const store = freshStore();
  const blocked = [{ label: 'School*', reason: 'x' }, { label: 'Degree*', reason: 'x' }];
  assert.ok(store.recordBlocked('greenhouse:1', meta, blocked));
  store.markAsked('greenhouse:1', '1000');
  assert.equal(store.recordBlocked('greenhouse:1', meta, blocked), null);
  assert.ok(store.recordBlocked('greenhouse:1', meta, [...blocked, { label: 'New question', reason: 'x' }]));
});

test('two processes saving the same file keep each other\'s work', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'answers-')), 'answers.json');
  const applier = new AnswerStore(path);
  const watcher = new AnswerStore(path);

  applier.recordBlocked('greenhouse:1', meta, [{ label: 'Degree*', reason: 'x' }]);
  applier.markAsked('greenhouse:1', '2000');
  applier.save();

  watcher.lastMessageId = '1500';
  watcher.save();

  const reloaded = new AnswerStore(path);
  assert.ok(reloaded.jobForMessage('2000'), 'the applier\'s message id survived the watcher\'s save');
  assert.equal(reloaded.lastMessageId, '1500');
});

test('a forgotten answer stays forgotten after merging with the file', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'answers-')), 'answers.json');
  const first = new AnswerStore(path);
  first.recordBlocked('greenhouse:1', meta, [{ label: 'School*', reason: 'x' }]);
  first.applyReply('greenhouse:1', 'Wrong College');
  first.save();

  const second = new AnswerStore(path);
  second.forget('greenhouse:1', 'School*');
  second.save();
  assert.equal(new AnswerStore(path).lookup('greenhouse:1', 'School'), null);
});

test('a written answer is kept per job, so a live run submits what the dry run showed', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'answers-')), 'answers.json');
  const first = new AnswerStore(path);
  first.saveGenerated('greenhouse:1', 'What does "The Best Team Wins" mean to you?', 'text A');
  first.save();
  const second = new AnswerStore(path);
  assert.equal(second.generatedAnswer('greenhouse:1', 'What does "The Best Team Wins" mean to you?*'), 'text A');
  assert.equal(second.generatedAnswer('greenhouse:2', 'What does "The Best Team Wins" mean to you?'), null);
});

test('labels match across runs despite asterisks and spacing', () => {
  assert.equal(labelKey('Notice Period?\n*'), labelKey('notice period?'));
});
