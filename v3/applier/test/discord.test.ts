import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionEmbed, outcomeText } from '../src/discord.js';
import type { Job } from '../src/types.js';
import type { Question } from '../src/questions.js';

const job = {
  'Job ID': 'greenhouse:8644530002', 'Company Name': 'BitGo', 'Role': 'Backend Engineer E2 - Ecosystem',
  'Apply Link': 'https://job-boards.greenhouse.io/bitgo/jobs/8644530002',
} as Job;

test('a huge option list stays inside Discord\'s embed limits', () => {
  const schools = Array.from({ length: 800 }, (_, i) => `University Number ${i} of Somewhere Far Away`);
  const questions: Question[] = Array.from({ length: 6 }, (_, i) => ({
    n: i + 1, label: `School ${i}*`, reason: 'x', options: schools, optionsKind: 'choices' as const,
  }));
  const embed = questionEmbed(job, questions);

  for (const f of embed.fields) {
    assert.ok(f.value.length <= 1024, `field ${f.name} is ${f.value.length} chars`);
    assert.ok(f.name.length <= 256);
  }
  const total = embed.title.length + embed.description.length + embed.footer.text.length +
    embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `embed is ${total} chars`);
  assert.match(embed.fields[0]!.value, /and \d+ more/);
});

test('each question shows its number, a clean label, and what kind of answer fits', () => {
  const embed = questionEmbed(job, [
    { n: 1, label: 'Degree*', reason: 'x', options: ["Bachelor's Degree", 'Other'], optionsKind: 'choices' },
    { n: 2, label: 'School*', reason: 'x', options: ['Sri Krishna Arts and Science College'], optionsKind: 'suggestions' },
    { n: 3, label: 'Are you comfortable with 5 days in office?\n*', reason: 'x' },
  ]);
  assert.equal(embed.fields[0]!.name, '1. Degree');
  assert.match(embed.fields[0]!.value, /Choose one: `Bachelor's Degree` · `Other`/);
  assert.match(embed.fields[1]!.value, /Closest on the site: `Sri Krishna Arts and Science College`/);
  assert.equal(embed.fields[2]!.name, '3. Are you comfortable with 5 days in office?');
  assert.equal(embed.fields[2]!.value, 'Type your answer.');
});

test('the confirmation says what was saved, what was rejected, and what is left', () => {
  const text = outcomeText('BitGo', [
    { n: 1, status: 'saved', label: 'Degree', answer: "Bachelor's Degree", always: true },
    { n: 2, status: 'rejected', message: '"btech" isn\'t one of the choices for "Discipline"' },
  ], [2, 3]);
  assert.match(text, /saved 1: `Bachelor's Degree` \(every job\)/);
  assert.match(text, /❌ 2:/);
  assert.match(text, /Still waiting on 2, 3/);
});
