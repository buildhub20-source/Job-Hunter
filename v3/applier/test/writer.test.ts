import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildChoicePrompt, unwrapQuotes, stripMarkup } from '../src/writer.js';

test('quotes are removed only when they wrap the whole answer', () => {
  assert.equal(unwrapQuotes('"I like building things."'), 'I like building things.');
  // Verbatim shape from the Celonis dry run, 2026-09-15.
  const opensWithQuote = '"The Best Team Wins" means to me that the strongest outcome comes from shared work.';
  assert.equal(unwrapQuotes(opensWithQuote), opensWithQuote);
});

test('markup the model wrapped around its answer never reaches the form', () => {
  // Verbatim tail of the Redwood answer stored on 2026-09-17.
  assert.equal(
    stripMarkup('I would like to go deeper into it here.</answer>\n</invoke>'),
    'I would like to go deeper into it here.',
  );
  assert.equal(stripMarkup('<answer>Plain text.</answer>'), 'Plain text.');
  // Angle brackets that are part of the answer stay.
  assert.equal(stripMarkup('Latency dropped to <200ms in that service.'), 'Latency dropped to <200ms in that service.');
});

const input = {
  question: 'What does "The Best Team Wins" mean to you?',
  company: 'Celonis',
  role: 'Software Engineer',
  posting: 'POSTING-MARKER Celonis values #TheBestTeamWins',
  facts: new Map([['resume_highlights', 'RESUME-MARKER 50K+ daily requests'], ['current_title', 'Associate Software Developer']]),
};

test('both prompts carry the candidate facts, the posting and the truth rules', () => {
  // The first version of the choice prompt cut the writer's prompt at "FORMAT:", which
  // silently dropped everything after it — the candidate and the posting.
  for (const prompt of [buildPrompt(input), buildChoicePrompt({ ...input, options: ['A', 'B'] })]) {
    assert.match(prompt, /RESUME-MARKER/);
    assert.match(prompt, /POSTING-MARKER/);
    assert.match(prompt, /TRUTH RULES/);
    assert.match(prompt, /The Best Team Wins/);
  }
});

test('the choice prompt numbers the options, and a known answer asks for the same meaning only', () => {
  const prompt = buildChoicePrompt({ ...input, options: ['LinkedIn', 'Celonis Careers Page'], knownAnswer: 'Company Website' });
  assert.match(prompt, /1\. LinkedIn\n2\. Celonis Careers Page/);
  assert.match(prompt, /"Company Website"/);
  assert.match(prompt, /never pick something else/);
});
