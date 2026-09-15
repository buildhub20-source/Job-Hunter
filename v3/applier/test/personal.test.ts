import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPersonalFacts } from '../src/personal.js';

async function load(body: string): Promise<Map<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), 'personal-'));
  const file = join(dir, 'personal.md');
  await writeFile(file, [
    '| key | value | source | approved | approved_at | expires_at | sensitivity | notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    body,
  ].join('\n'));
  return loadPersonalFacts(file);
}

test('an expired fact is dropped even when approved_at is empty', async () => {
  // The old parser discarded empty cells, so expires_at was read from `sensitivity`.
  const facts = await load('| old_title | Intern | user | yes |  | 2020-01-01 | normal |  |');
  assert.equal(facts.has('old_title'), false);
});

test('an approved, unexpired fact loads', async () => {
  const facts = await load('| full_name | Vinoth M | resume | yes | 2026-09-09 |  | normal | as on resume |');
  assert.equal(facts.get('full_name'), 'Vinoth M');
});

test('an empty value is never shifted into place from the next column', async () => {
  const facts = await load('| portfolio_url |  | user | yes | 2026-09-09 |  | low |  |');
  assert.equal(facts.has('portfolio_url'), false);
});

test('UNKNOWN and unapproved facts are not returned', async () => {
  const facts = await load([
    '| a | UNKNOWN | user | yes | 2026-09-09 |  | high |  |',
    '| b | something | user | no |  |  | high |  |',
  ].join('\n'));
  assert.equal(facts.size, 0);
});

test('an escaped pipe stays inside the value', async () => {
  const facts = await load('| stack | .NET \\| Node | user | yes | 2026-09-09 |  | normal |  |');
  assert.equal(facts.get('stack'), '.NET | Node');
});
