import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * The daily liveness check runs in Apps Script. Its verdict logic is pure apart from the
 * fetches, so the real Liveness.gs is loaded here with UrlFetchApp stubbed — what matters
 * is that only a clear answer closes a row. A wrongly closed row costs a real application.
 */
const here = dirname(fileURLToPath(import.meta.url));
const gsDir = resolve(here, '..', '..', 'appsscript');

type Reply = { code: number; body?: string };
function load(reply: (url: string) => Reply) {
  const fetched: string[] = [];
  const ctx: any = {
    UrlFetchApp: {
      fetch(url: string) {
        fetched.push(url);
        const r = reply(url);
        return { getResponseCode: () => r.code, getContentText: () => r.body ?? '' };
      },
    },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  // Code.gs supplies workdayJdUrl / amazonJdUrl / jdGet; neither file calls anything at load.
  vm.runInContext(readFileSync(resolve(gsDir, 'Code.gs'), 'utf-8'), ctx);
  vm.runInContext(readFileSync(resolve(gsDir, 'Liveness.gs'), 'utf-8'), ctx);
  vm.runInContext('this.probeJob = probeJob;', ctx);
  return { probe: ctx.probeJob as (link: string, company?: string) => { state: string; reason: string }, fetched };
}

const GH = 'https://job-boards.greenhouse.io/zscaler/jobs/5219488007';

test('a 404 from the board API closes the row', () => {
  const { probe, fetched } = load(() => ({ code: 404 }));
  assert.equal(probe(GH).state, 'closed');
  assert.match(fetched[0]!, /boards-api\.greenhouse\.io\/v1\/boards\/zscaler\/jobs\/5219488007/);
});

test('a 200 from the board API keeps the row open', () => {
  const { probe } = load(() => ({ code: 200, body: '{"id":1}' }));
  assert.equal(probe(GH).state, 'open');
});

test('an outage or a rate limit is unknown, never closed', () => {
  for (const code of [429, 500, 503, 403]) {
    const { probe } = load(() => ({ code }));
    assert.equal(probe(GH).state, 'unknown', `HTTP ${code}`);
  }
  const threw = load(() => { throw new Error('DNS failure'); });
  assert.equal(threw.probe(GH).state, 'unknown');
});

test('Lever, SmartRecruiters, Workday and Amazon are asked at their own endpoints', () => {
  const cases: Array<[string, RegExp]> = [
    ['https://jobs.lever.co/mindtickle/b6e024c2-42c2-463c-8bc8-ca0aa0826845', /api\.lever\.co\/v0\/postings\//],
    ['https://jobs.smartrecruiters.com/unacademy/743999672726735', /api\.smartrecruiters\.com\/v1\/companies\//],
    ['https://autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/Software-Engineer_26WD96707-1', /\/wday\/cxs\//],
    ['https://www.amazon.jobs/en/jobs/10533985/software-dev', /amazon\.jobs\/en\/jobs\/10533985\.json/],
  ];
  for (const [link, endpoint] of cases) {
    const { probe, fetched } = load(() => ({ code: 404 }));
    assert.equal(probe(link).state, 'closed', link);
    assert.match(fetched[0]!, endpoint);
  }
});

test('an Ashby posting missing from the board is closed, and one still listed is open', () => {
  const link = 'https://jobs.ashbyhq.com/tekion/e23792bd-a9ee-4dfe-8223-9c0b9fe90f05';
  const gone = load(() => ({ code: 200, body: JSON.stringify({ jobs: [{ id: 'something-else-entirely' }] }) }));
  assert.equal(gone.probe(link).state, 'closed');
  const there = load(() => ({ code: 200, body: JSON.stringify({ jobs: [{ id: 'e23792bd-a9ee-4dfe-8223-9c0b9fe90f05' }] }) }));
  assert.equal(there.probe(link).state, 'open');
});

// Direct career sites: ~70 rows, and the riskiest to judge.
const DIRECT = 'https://careers.example.com/jobs/software-engineer-123';

test('a direct careers page only closes on 404 or its own words', () => {
  assert.equal(load(() => ({ code: 404 })).probe(DIRECT).state, 'closed');
  assert.equal(
    load(() => ({ code: 200, body: '<p>This position is no longer accepting applications.</p>' })).probe(DIRECT).state,
    'closed',
  );
  assert.equal(
    load(() => ({ code: 200, body: '<h1>Software Engineer</h1><p>Apply now</p>' })).probe(DIRECT).state,
    'open',
  );
});

test('a login wall or a bot check never closes a live job', () => {
  assert.equal(load(() => ({ code: 401, body: 'Sign in' })).probe(DIRECT).state, 'unknown');
  assert.equal(load(() => ({ code: 403, body: 'Are you a robot?' })).probe(DIRECT).state, 'unknown');
});

test('a row with no apply link is left alone', () => {
  assert.equal(load(() => ({ code: 404 })).probe('').state, 'unknown');
});
