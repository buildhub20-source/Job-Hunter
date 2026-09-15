import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { resumeForJob, readResumePolicy } from '../src/resume.js';

// The matcher runs in Apps Script. Its pure functions use no Apps Script APIs, so the
// real Resumes.gs is loaded here rather than a copy that could drift from it.
const here = dirname(fileURLToPath(import.meta.url));
const gs = vm.createContext({});
vm.runInContext(
  readFileSync(resolve(here, '..', '..', 'appsscript', 'Resumes.gs'), 'utf-8') +
    '\nthis.api = { chooseResume, resumeProfiles, mentions, SEED_RESUMES, NO_JD_REASON };',
  gs,
);
type Pick = { resume: string; reason: string };
const api = (gs as any).api as {
  chooseResume: (jd: string, company: string, profiles: unknown, def: string) => Pick;
  resumeProfiles: (rows: unknown[][]) => Array<{ name: string }>;
  mentions: (text: string, term: string) => boolean;
  SEED_RESUMES: string[][];
  NO_JD_REASON: string;
};
const profiles = api.resumeProfiles(api.SEED_RESUMES);
const choose = (jd: string, company = 'Acme') => api.chooseResume(jd, company, profiles, 'amazon');

test('every seeded resume name is a real file in data/resumes', () => {
  for (const p of profiles) {
    assert.ok(existsSync(resolve(here, '..', '..', '..', 'data', 'resumes', `${p.name}.pdf`)), p.name);
  }
});

test('keywords match whole words only', () => {
  assert.equal(api.mentions('Strong JavaScript skills', 'java'), false);
  assert.equal(api.mentions('Java, Spring Boot', 'java'), true);
  assert.equal(api.mentions('reactive streams', 'react'), false);
  assert.equal(api.mentions('Experience with .NET Core', '.net'), true);
  assert.equal(api.mentions('CI/CD pipelines', 'ci/cd'), true);
  assert.equal(api.mentions('a full-stack engineer', 'full stack'), true);
});

test('a full-stack GraphQL posting gets the PayPal version', () => {
  const pick = choose('We want a full-stack engineer: React frontend, GraphQL APIs, MongoDB, accessibility (WCAG).');
  assert.equal(pick.resume, 'paypal');
  assert.match(pick.reason, /graphql/);
});

test('a Java / Kafka backend posting gets amazon', () => {
  assert.equal(choose('Backend engineer: Java 17, Spring Boot, Kafka, AWS ECS, CI/CD.').resume, 'amazon');
});

test('an identity posting gets Blue Yonder\'s version', () => {
  assert.equal(choose('Build our IAM platform: OAuth, OIDC and SAML single sign-on, DevOps mindset.').resume, 'blueyonder');
});

test('a posting with nothing distinguishing, or no JD at all, gets the default', () => {
  assert.equal(choose('Write clean code and communicate well.').resume, 'amazon');
  assert.deepEqual({ ...choose('') }, { resume: 'amazon', reason: api.NO_JD_REASON });
});

test('one passing mention does not replace the default', () => {
  // Shapes from real postings, 2026-09-15: Speechify said "frontend" once; Celonis's EEO
  // text offers "accessibility" accommodations, which is not web accessibility.
  assert.equal(choose('You will work with the frontend team.').resume, 'amazon');
  assert.equal(choose('We provide accessibility accommodations during interviews.').resume, 'amazon');
});

test('identical versions tie, and the tie goes to the default', () => {
  // p44 has amazon's exact keywords; it is only for project44.
  assert.equal(choose('Java, Kafka, Kinesis, SOAP').resume, 'amazon');
});

test('the employer\'s own version wins whatever the JD says', () => {
  assert.equal(choose('GraphQL, React, full-stack', 'project44').resume, 'p44');
  assert.equal(choose('Kafka', 'American Express').resume, 'amex');
  assert.equal(choose('Kafka', 'American Express Global Business Travel').resume, 'gbt');
});

// The applier's side, against the real policy file.
const policy = readResumePolicy();
const job = (company: string, resume?: string) => ({ 'Company Name': company, 'Resume': resume, 'Resume Match': 'why' });

test('the applier uploads the matched version', () => {
  assert.equal(basename(resumeForJob(job('GitLab', 'paypal'), policy).path), 'paypal.pdf');
});

test('the policy\'s employer file still beats the Sheet column', () => {
  assert.equal(basename(resumeForJob(job('PayPal', 'amazon'), policy).path), 'paypal.pdf');
});

test('a blank or unknown Resume value falls back to the default, never to nothing', () => {
  assert.equal(basename(resumeForJob(job('GitLab'), policy).path), 'amazon.pdf');
  assert.equal(basename(resumeForJob(job('GitLab', 'paypall'), policy).path), 'amazon.pdf');
  assert.equal(basename(resumeForJob(job('GitLab', '../secrets/x'), policy).path), 'amazon.pdf');
});
