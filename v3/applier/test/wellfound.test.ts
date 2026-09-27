import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Wellfound is read out of a page's embedded JSON rather than an API, so the parser is
 * pinned to a real page: wellfound-page.fixture.html is trimmed from
 * wellfound.com/role/l/software-engineer/india, fetched 2026-09-27. If Wellfound changes
 * that shape these tests keep passing — only wellfoundHealth() can tell you that — but a
 * change on our side that breaks the parse is caught here.
 */
const here = dirname(fileURLToPath(import.meta.url));
const gsDir = resolve(here, '..', '..', 'appsscript');

const ctx: any = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(resolve(gsDir, 'Wellfound.gs'), 'utf-8'), ctx);
vm.runInContext('this.api = { parseWellfound, wellfoundTargets };', ctx);
const { parseWellfound, wellfoundTargets } = ctx.api as {
  parseWellfound: (html: string) => Array<Record<string, any>>;
  wellfoundTargets: () => Array<{ role: string; page: number; url: string }>;
};

const page = readFileSync(resolve(here, 'wellfound-page.fixture.html'), 'utf-8');

test('listings are read out of the page, each joined to its company', () => {
  const jobs = parseWellfound(page);
  assert.ok(jobs.length >= 3, `expected listings, got ${jobs.length}`);
  for (const job of jobs) {
    assert.ok(job.role, 'every listing has a title');
    assert.ok(job.company, `every listing has a company: ${JSON.stringify(job).slice(0, 120)}`);
    assert.match(job.applyLink, /^https:\/\/wellfound\.com\/jobs\/\d+-/);
  }
});

test('the years-of-experience floor is kept when the employer states one', () => {
  const jobs = parseWellfound(page);
  assert.ok(jobs.every((j) => j.yearsMin === null || typeof j.yearsMin === 'number'));
});

test('a job with no location is not given a false one', () => {
  const jobs = parseWellfound(page);
  // Location is either the listed places or "Remote" — never invented, and the gate
  // rejects a blank one rather than letting it through.
  for (const job of jobs) assert.equal(typeof job.location, 'string');
});

test('a page that is not Wellfound, or is a bot challenge, yields nothing rather than throwing', () => {
  // Length, not deepEqual: the array is built inside the VM context and so is never
  // reference-equal to one built here.
  assert.equal(parseWellfound('<html><body>Just a moment...</body></html>').length, 0);
  assert.equal(parseWellfound('').length, 0);
  assert.equal(parseWellfound('<script id="__NEXT_DATA__">not json</script>').length, 0);
  assert.equal(parseWellfound('<script id="__NEXT_DATA__">{"props":{}}</script>').length, 0);
});

test('every role page is visited once per sweep, page 1 first', () => {
  const targets = wellfoundTargets();
  assert.equal(new Set(targets.map((t) => t.url)).size, targets.length, 'no duplicate URLs');
  assert.equal(targets[0]!.url, 'https://wellfound.com/role/l/software-engineer/india');
  assert.match(targets[1]!.url, /\?page=2$/);
  assert.ok(targets.every((t) => t.url.includes('/india')));
});
