import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfile, factValue, staleFacts, computePolicyVersion } from '../src/load.js';
import { upsertFact } from '../src/write.js';

const HEADER = '| key | value | source | approved | approved_at | expires_at | sensitivity | notes |\n| --- | --- | --- | --- | --- | --- | --- | --- |';

async function fixture(facts: string, policies = ''): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  await writeFile(join(dir, 'personal.md'), `# Personal\n\n## contact\n\n${HEADER}\n${facts}\n`);
  await mkdir(join(dir, 'policies'));
  await writeFile(
    join(dir, 'policies', 'p.md'),
    '| id | rule | value | scope | priority | type | effective_from | notes |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      (policies || '| g1 | experience_max_years | 3 | global | 10 | hard_gate | 2026-01-01 |  |'),
  );
  return dir;
}

test('an approved fact is usable', async () => {
  const dir = await fixture('| phone | +91 90000 00000 | user | yes | 2026-01-01 |  | normal |  |');
  const b = await loadProfile(dir);
  assert.equal(factValue(b, 'phone'), '+91 90000 00000');
});

test('UNKNOWN never becomes a usable value', async () => {
  const dir = await fixture('| requires_sponsorship_us | UNKNOWN | user | no |  |  | high |  |');
  const b = await loadProfile(dir);
  assert.equal(factValue(b, 'requires_sponsorship_us'), null, 'must be null, never "no" or ""');
});

test('an unapproved fact with a value is still not usable', async () => {
  const dir = await fixture('| notice_period_days | 60 | guess | no |  |  | normal |  |');
  const b = await loadProfile(dir);
  assert.equal(factValue(b, 'notice_period_days'), null);
});

test('an expired fact stops being usable and is reported as stale', async () => {
  const dir = await fixture('| current_ctc | 10 LPA | user | yes | 2020-01-01 | 2021-01-01 | high |  |');
  const b = await loadProfile(dir);
  assert.equal(factValue(b, 'current_ctc'), null);
  assert.deepEqual(staleFacts(b).map((f) => f.key), ['current_ctc']);
});

test('a missing key is null, not an exception', async () => {
  const dir = await fixture('| phone | x | user | yes | 2026-01-01 |  | normal |  |');
  const b = await loadProfile(dir);
  assert.equal(factValue(b, 'never_defined'), null);
});

test('duplicate keys are reported as issues', async () => {
  const dir = await fixture(
    '| phone | a | user | yes | 2026-01-01 |  | normal |  |\n| phone | b | user | yes | 2026-01-01 |  | normal |  |',
  );
  const b = await loadProfile(dir);
  assert.ok(b.issues.some((i) => i.message === 'duplicate key'));
});

test('permanent approval writes back and becomes usable', async () => {
  const dir = await fixture('| requires_sponsorship_india | UNKNOWN | user | no |  |  | high |  |');
  process.env.JOBOPS_GIT_COMMIT_ON_WRITE = 'false';
  const mode = await upsertFact(dir, { key: 'requires_sponsorship_india', value: 'no', section: 'contact' });
  assert.equal(mode, 'updated');
  const b = await loadProfile(dir);
  assert.equal(factValue(b, 'requires_sponsorship_india'), 'no');
});

test('a new fact can be appended and the file still parses', async () => {
  const dir = await fixture('| phone | x | user | yes | 2026-01-01 |  | normal |  |');
  process.env.JOBOPS_GIT_COMMIT_ON_WRITE = 'false';
  const mode = await upsertFact(dir, { key: 'travel_percentage_ok', value: '25', section: 'contact' });
  assert.equal(mode, 'created');
  const b = await loadProfile(dir);
  assert.equal(b.issues.length, 0, JSON.stringify(b.issues));
  assert.equal(factValue(b, 'travel_percentage_ok'), '25');
  assert.equal(factValue(b, 'phone'), 'x', 'existing rows must survive the rewrite');
});

test('hard gates and ranking signals stay separated', async () => {
  const dir = await fixture(
    '| phone | x | user | yes | 2026-01-01 |  | normal |  |',
    '| g1 | experience_max_years | 3 | global | 10 | hard_gate | 2026-01-01 |  |\n| r1 | preferred_stack | c# | global | 40 | ranking_signal | 2026-01-01 |  |',
  );
  const b = await loadProfile(dir);
  assert.equal(b.hardGates.length, 1);
  assert.equal(b.rankingSignals.length, 1);
});

test('policy version changes when a policy changes', () => {
  const base = [{ id: 'g1', rule: 'r', value: '3', scope: 'global', priority: 10, type: 'hard_gate' as const, effective_from: null, notes: '' }];
  const changed = [{ ...base[0]!, value: '4' }];
  assert.notEqual(computePolicyVersion(base), computePolicyVersion(changed));
  assert.equal(computePolicyVersion(base), computePolicyVersion([...base]));
});
