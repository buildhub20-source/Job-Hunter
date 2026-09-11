import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHardGates, type EvaluableCard } from '../src/hardgates.js';
import type { PolicyRow } from '@jobops/profile';

const gate = (rule: string, value: string, priority = 100, scope = 'global'): PolicyRow => ({
  id: rule, rule, value, scope, priority, type: 'hard_gate', effective_from: null, notes: '',
});

const baseCard: EvaluableCard = {
  employer_id: 'acme',
  title: 'Software Engineer',
  location: ['Bengaluru', 'India'],
  country: 'India',
  remote_type: 'onsite',
  experience_min: 1,
  experience_max: 3,
  compensation_min: 700000,
  compensation_max: 900000,
  currency: 'INR',
};

const policy = [
  gate('excluded_companies', '', 5),
  gate('excluded_companies_current_employer', 'aptean', 7),
  gate('experience_max_years', '3', 10),
  gate('allowed_countries', 'India', 20),
  gate('blocked_title_words', 'senior, staff, lead, principal, manager, director, architect', 15),
  gate('blocked_job_types', 'internship, contract, freelance', 25),
  gate('minimum_ctc', '600000', 30),
];

test('a card meeting every gate passes', () => {
  const result = runHardGates(baseCard, policy);
  assert.equal(result.pass, true);
  assert.equal(result.reason, null);
});

test('excluded company is skipped with the reason naming the company', () => {
  const withExclusion = [gate('excluded_companies', 'globex, initech', 5), ...policy.slice(1)];
  const result = runHardGates({ ...baseCard, employer_id: 'globex' }, withExclusion);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /globex/);
});

test('current employer is excluded even if not in the general exclusion list', () => {
  const result = runHardGates({ ...baseCard, employer_id: 'aptean' }, policy);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /current employer/);
});

test('a title with a blocked seniority word is skipped, case-insensitively', () => {
  const result = runHardGates({ ...baseCard, title: 'Senior Software Engineer' }, policy);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /senior/i);
});

test('a partial word match does not trigger the seniority gate', () => {
  // "manager" is blocked, but "management" (as in "stakeholder management") is not the same word.
  const result = runHardGates({ ...baseCard, title: 'Software Engineer, Stakeholder Management Tools' }, policy);
  assert.equal(result.pass, true);
});

test('experience floor above the JD max is skipped', () => {
  const result = runHardGates({ ...baseCard, experience_min: 5 }, policy);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /5\+ years/);
});

test('a role outside the allowed countries and not remote is skipped', () => {
  const result = runHardGates({ ...baseCard, location: ['Berlin', 'Germany'], country: 'Germany' }, policy);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /Berlin/);
});

test('an India city with no literal "India" in the location string still passes — real bug, 2026-09-10', () => {
  // parseLocation (@jobops/adapters) already resolves this to country: 'India' via its
  // INDIA_CITIES list; the gate must trust that, not re-derive from the raw strings.
  const result = runHardGates({ ...baseCard, location: ['Bengaluru'], country: 'India' }, policy);
  assert.equal(result.pass, true);
});

test('a remote role bypasses the country gate when allow_remote_anywhere is true', () => {
  const withRemote = [...policy, gate('allow_remote_anywhere', 'true', 21)];
  const result = runHardGates(
    { ...baseCard, location: ['Anywhere'], country: null, remote_type: 'remote' }, withRemote,
  );
  assert.equal(result.pass, true);
});

test('a remote role is still checked against geography when allow_remote_anywhere is false', () => {
  const withRemote = [...policy, gate('allow_remote_anywhere', 'false', 21)];
  const result = runHardGates(
    { ...baseCard, location: ['Berlin', 'Germany'], country: 'Germany', remote_type: 'remote' }, withRemote,
  );
  assert.equal(result.pass, false);
});

test('an internship title is skipped by the job-type gate', () => {
  const result = runHardGates({ ...baseCard, title: 'Software Engineering Internship' }, policy);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /internship/);
});

test('disclosed INR comp below the floor is skipped', () => {
  const result = runHardGates({ ...baseCard, compensation_max: 500000 }, policy);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /500000/);
});

test('comp in a different currency is left to stage 2, not judged by the INR floor', () => {
  const result = runHardGates({ ...baseCard, compensation_max: 50000, currency: 'USD' }, policy);
  assert.equal(result.pass, true);
});

test('undisclosed comp (null) is left to stage 2', () => {
  const result = runHardGates({ ...baseCard, compensation_max: null }, policy);
  assert.equal(result.pass, true);
});

test('gates run in policy priority order — the lowest-priority failure wins', () => {
  // excluded_companies (priority 5) should win over blocked_title_words (priority 15)
  // even though the title gate would also fail.
  const withExclusion = [gate('excluded_companies', 'acme', 5), ...policy.slice(1)];
  const result = runHardGates({ ...baseCard, title: 'Senior Software Engineer' }, withExclusion);
  assert.equal(result.pass, false);
  assert.match(result.reason!, /excluded company/);
});

test('a gate with an empty policy value never fires', () => {
  const result = runHardGates({ ...baseCard, employer_id: '' }, policy);
  assert.equal(result.pass, true, 'excluded_companies has an empty value in the fixture policy — nothing to match');
});
