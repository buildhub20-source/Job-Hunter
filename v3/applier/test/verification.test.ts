import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeSentence } from '../src/adapters/greenhouse.js';

// Verbatim from Amtech Software, 2026-09-17: the first live submit attempt. The button
// was disabled and the application was never sent, but the run recorded it as submitted.
const amtech =
  'LinkedIn Profile Website A verification code was sent to gopir525@gmail.com. ' +
  "To submit your application, enter the 6-character code to confirm you're a human. Security code Submit application";

test('an emailed verification code is recognised, and the page\'s own words are kept', () => {
  const said = codeSentence(amtech);
  assert.ok(said);
  assert.match(said, /verification code was sent to gopir525@gmail.com/);
});

test('an ordinary application page is not mistaken for a code prompt', () => {
  assert.equal(codeSentence('Apply for this job. First name, last name, resume. Submit application'), null);
  // "Code" in an engineering posting is not a security code.
  assert.equal(codeSentence('You will write clean code and review code daily.'), null);
});
