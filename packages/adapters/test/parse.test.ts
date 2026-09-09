import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseGreenhouse } from '../src/greenhouse.js';
import { parseLever } from '../src/lever.js';
import {
  stripHtml, normalizeTitle, looksSenior, looksIntern, parseLocation,
  parseRemoteType, parseExperience, extractSkills, parseCompensation,
} from '../src/normalize.js';
import type { BoardRef } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => JSON.parse(readFileSync(join(here, 'fixtures', n), 'utf8'));
const board: BoardRef = { employerId: 'acme', displayName: 'Acme', adapter: 'greenhouse', tenant: 'acme', enabled: true };

test('greenhouse: parses postings and drops untitled rows', () => {
  const posts = parseGreenhouse(fixture('greenhouse.json'), board);
  assert.equal(posts.length, 3, 'the row with no title must be dropped, not kept as ""');
  assert.equal(posts[0]!.requisitionId, 'REQ-3121001');
  assert.equal(posts[0]!.locationText, 'Bengaluru, India');
});

test('greenhouse: a missing requisition id is null, never an empty string', () => {
  const posts = parseGreenhouse(fixture('greenhouse.json'), board);
  const senior = posts.find((p) => p.title.includes('Senior'))!;
  assert.equal(senior.requisitionId, null);
  assert.equal(senior.locationText, 'Remote - India', 'falls back to offices when location is absent');
});

test('greenhouse: html and entities are stripped out of the JD', () => {
  const posts = parseGreenhouse(fixture('greenhouse.json'), board);
  const jd = posts[0]!.descriptionText;
  assert.doesNotMatch(jd, /<[a-z]/i);
  assert.match(jd, /2-4 years of experience/);
  assert.match(jd, /AWS & Docker/, 'double-escaped entities must decode');
});

test('greenhouse: malformed payloads return nothing rather than throwing', () => {
  assert.deepEqual(parseGreenhouse(null, board), []);
  assert.deepEqual(parseGreenhouse({}, board), []);
  assert.deepEqual(parseGreenhouse({ jobs: 'nope' }, board), []);
});

test('lever: parses postings and folds the lists into the description', () => {
  const posts = parseLever(fixture('lever.json'), board);
  assert.equal(posts.length, 2);
  assert.match(posts[0]!.descriptionText, /AWS Lambda/);
  assert.match(posts[0]!.descriptionText, /Requirements/);
  assert.equal(posts[0]!.workplaceType, 'hybrid');
});

test('lever: exposes no requisition id, so it must be null', () => {
  const posts = parseLever(fixture('lever.json'), board);
  assert.equal(posts[0]!.requisitionId, null, 'inventing one here would break dedupe');
  assert.equal(posts[0]!.sourceId, 'b1e7c3a4-1111-4c2b-9f0a-000000000001');
});

test('lever: allLocations is used when location is absent', () => {
  const posts = parseLever(fixture('lever.json'), board);
  assert.equal(posts[1]!.locationText, 'Remote, India');
});

test('lever: malformed payloads return nothing', () => {
  assert.deepEqual(parseLever({ postings: [] }, board), []);
  assert.deepEqual(parseLever(null, board), []);
});

test('title normalization groups the same role across boards', () => {
  assert.equal(normalizeTitle('Software Engineer I, Platform (Bengaluru)'), 'software engineer platform');
  assert.equal(normalizeTitle('Backend Engineer - Remote, India'), 'backend engineer');
  assert.equal(normalizeTitle('SDE II | Full-Time'), 'sde');
});

test('seniority and internship detection', () => {
  assert.equal(looksSenior('Senior Staff Engineer'), true);
  assert.equal(looksSenior('Engineering Manager'), true);
  assert.equal(looksSenior('Software Engineer I'), false);
  assert.equal(looksIntern('Engineering Intern'), true);
  assert.equal(looksIntern('Graduate Trainee'), true);
  assert.equal(looksIntern('Backend Engineer'), false);
});

test('location parsing recognises India and remote', () => {
  const b = parseLocation('Bengaluru, India');
  assert.equal(b.isIndia, true); assert.equal(b.country, 'India'); assert.equal(b.isRemote, false);
  assert.deepEqual(b.parts, ['Bengaluru', 'India']);
  assert.equal(parseLocation('Coimbatore').isIndia, true);
  assert.equal(parseLocation('Remote - India').isRemote, true);
  assert.equal(parseLocation('', 'remote').isRemote, true);
  assert.equal(parseLocation('San Francisco, CA').isIndia, false);
});

test('remote type prefers the explicit field over the location string', () => {
  assert.equal(parseRemoteType('Bangalore', 'remote'), 'remote');
  assert.equal(parseRemoteType('Bangalore (Hybrid)', null), 'hybrid');
  assert.equal(parseRemoteType('Chennai', null), 'onsite');
  assert.equal(parseRemoteType('', null), 'unknown');
});

test('experience parsing reads ranges, floors and ceilings', () => {
  assert.deepEqual(parseExperience('2-4 years of experience building services'), { min: 2, max: 4 });
  assert.deepEqual(parseExperience('Minimum 9 years experience'), { min: 9, max: null });
  assert.deepEqual(parseExperience('1+ years of experience'), { min: 1, max: null });
  assert.deepEqual(parseExperience('Up to 3 years experience'), { min: null, max: 3 });
  assert.deepEqual(parseExperience('3 years of relevant experience'), { min: 3, max: null });
});

test('an unparseable JD yields nulls, never zero', () => {
  assert.deepEqual(parseExperience('We want great engineers.'), { min: null, max: null },
    'a null must not become 0, or every senior role looks entry level');
});

test('skill extraction prefers the most specific term', () => {
  const s = extractSkills('Strong C#, .NET Core, SQL Server and microservices.');
  assert.ok(s.includes('.net core'));
  assert.ok(!s.includes('.net'), 'the broader term is dropped when the specific one matched');
  assert.ok(s.includes('sql server'));
});

test('compensation is read only when disclosed', () => {
  assert.deepEqual(parseCompensation('Compensation Rs 8-12 LPA.'), { min: 800000, max: 1200000, currency: 'INR' });
  assert.deepEqual(parseCompensation('Competitive salary.'), { min: null, max: null, currency: null });
});

test('stripHtml keeps text and drops scripts', () => {
  assert.equal(stripHtml('<p>Hello</p><script>evil()</script><p>World</p>'), 'Hello\nWorld');
});
