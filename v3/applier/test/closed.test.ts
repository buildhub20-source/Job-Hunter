import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postingClosed } from '../src/adapters/greenhouse.js';

// All three shapes come from the 2026-09-17 dry run, where 9 of 32 jobs were closed.
test("Greenhouse's own 'no longer open' page is a closed posting", () => {
  const link = 'https://job-boards.greenhouse.io/zscaler/jobs/5219488007';
  assert.equal(
    postingClosed('The job you are looking for is no longer open. Current openings at Zscaler', link, link),
    true,
  );
});

test('a bounce to the company careers site is a closed posting', () => {
  assert.equal(
    postingClosed('Game changer. Path maker. Status quo breaker.', 'https://www.celonis.com/careers/jobs/',
      'https://boards.greenhouse.io/celonis/jobs/7791283003'),
    true,
  );
});

test('the real application page is never called closed', () => {
  const link = 'https://job-boards.greenhouse.io/gitlab/jobs/8736877002';
  assert.equal(postingClosed('Apply for this job. First name, Last name…', link, link), false);
  // A redirect that keeps the job id — an apply path, or the board-boards.greenhouse.io swap.
  assert.equal(postingClosed('Apply for this job', `${link}#app`, link), false);
  assert.equal(
    postingClosed('Apply for this job', 'https://job-boards.eu.greenhouse.io/x/jobs/8736877002/apply', link),
    false,
  );
});

test('a posting that merely mentions open roles elsewhere is not closed', () => {
  const link = 'https://job-boards.greenhouse.io/acme/jobs/123';
  assert.equal(postingClosed('We keep this role open to remote candidates. Apply below.', link, link), false);
});
