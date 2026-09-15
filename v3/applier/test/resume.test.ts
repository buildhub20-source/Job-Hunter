import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickResume, readResumePolicy, stageResume } from '../src/resume.js';

test('the uploaded file is named for Vinoth, not for the employer it was tailored to', () => {
  const source = pickResume('Project44', readResumePolicy());
  const staged = stageResume(source, 'Vinoth M', mkdtempSync(join(tmpdir(), 'resume-')));
  assert.equal(basename(staged), 'Vinoth_M_Resume.pdf');
  assert.deepEqual(readFileSync(staged), readFileSync(source));
});

// Runs against the real data/policies/resumes.md and data/resumes/, which is the point:
// the policy file is the only place this is decided.
const policy = readResumePolicy();
const pick = (company: string) => basename(pickResume(company, policy));

test('the policy default is amazon.pdf, not base.pdf', () => {
  assert.equal(policy.defaultFile, 'amazon');
  assert.equal(pick('Some Unmapped Startup'), 'amazon.pdf');
});

test('a mapped employer gets its tailored file, whatever the display name', () => {
  assert.equal(pick('Project44'), 'p44.pdf');
  assert.equal(pick('PayPal'), 'paypal.pdf');
  assert.equal(pick('American Express'), 'amex.pdf');
  assert.equal(pick('Blue Yonder'), 'blueyonder.pdf');
});
