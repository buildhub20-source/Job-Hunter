import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchFact } from '../src/fields.js';

const india = { jobLocation: 'Bengaluru, Karnataka, India' };
const us = { jobLocation: 'San Francisco, CA' };
const m = (label: string, type = 'text', ctx = india) => matchFact(label, type, ctx);

test('salary expectations go to expected CTC, not current', () => {
  assert.equal(m('What are your salary expectations?'), 'expected_ctc');
  assert.equal(m('Expected CTC (INR)'), 'expected_ctc');
  assert.equal(m('Current CTC'), 'current_ctc');
});

test('a bare salary question is ambiguous and asks a human', () => {
  assert.equal(m('Salary'), '__ask');
});

test('notice period is a text answer, never a consent tick', () => {
  assert.equal(m('Notice period (days)'), 'notice_period_days');
});

test('consent only fires on a checkbox', () => {
  assert.equal(m('I confirm the information above is accurate', 'checkbox'), '__checkbox_confirm');
  assert.notEqual(m('Please confirm your notice period', 'text'), '__checkbox_confirm');
});

test('how-did-you-hear wins over the sources its label lists', () => {
  assert.equal(m('How did you hear about us? (LinkedIn, company website, referral)'), 'how_did_you_hear');
  assert.equal(m('LinkedIn Profile'), 'linkedin_url');
});

test('"state your visa status" is a work-authorisation question, not a home state', () => {
  assert.equal(
    m('Are you legally authorized to work in India? Please state your visa status'),
    'authorized_to_work_india',
  );
});

test('questions naming the US get the US facts, whatever the role location', () => {
  assert.equal(m('Please explain why you would require sponsorship to work in the US', 'textarea'), 'requires_sponsorship_us');
  assert.equal(m('Are you legally authorized to work in the United States?'), 'authorized_to_work_us');
});

test('lowercase "us" is the pronoun, not the country', () => {
  assert.notEqual(m('Are you authorized to work for us?', 'text', india), 'authorized_to_work_us');
});

test('a country-less sponsorship question uses India facts only for an India role', () => {
  assert.equal(m('Will you now or in the future require sponsorship?', 'text', india), 'requires_sponsorship_india');
  assert.equal(m('Will you now or in the future require sponsorship?', 'text', us), '__ask');
});

test('travel percentage is not a CGPA, and is asked until Vinoth gives a real answer', () => {
  assert.equal(m('What percentage of time are you willing to travel?'), '__ask');
  assert.equal(m('CGPA'), 'cgpa_or_percentage');
});

test('an experience essay is never answered with a year count', () => {
  assert.notEqual(m('Describe your experience building distributed systems', 'textarea'), 'total_experience_years');
  assert.equal(m('Years of experience', 'number'), 'total_experience_years');
  assert.equal(m('Do you have experience with Go?', 'text'), null);
});

test('relocation is checked before location', () => {
  assert.equal(m('Are you willing to relocate to this location?'), 'willing_to_relocate');
  assert.equal(m('Location'), 'current_country');
});

test('"why us" has no canned answer — it is left for a company-specific written one', () => {
  assert.equal(m('Why do you want to work at Acme?', 'textarea'), null);
  assert.equal(m('Why do you want to work at Speechify?', 'textarea'), 'why_speechify_essay');
});

test('GitLab: "the name you\'d prefer us to use" is the preferred name', () => {
  assert.equal(m("What's the name you'd prefer us to use throughout the interview process?"), 'preferred_name');
});

test('Celonis: gender identity maps to the gender fact', () => {
  assert.equal(m('Please indicate your gender identity', 'combobox'), 'gender');
  assert.equal(m('Gender', 'select'), 'gender');
});

test('other voluntary demographic questions are left blank, not guessed', () => {
  assert.equal(m('Are you Hispanic/Latino?', 'combobox'), '__empty_optional');
  assert.equal(m('Veteran Status', 'combobox'), '__empty_optional');
  assert.equal(m('Disability Status', 'combobox'), '__empty_optional');
});

test('"The Best Team Wins" matches no fact, so it is handled as an open question', () => {
  assert.equal(m('What does "The Best Team Wins" mean to you?', 'combobox'), null);
});

test('preferred first name is not the legal first name', () => {
  assert.equal(m('Preferred first name'), 'preferred_name');
  assert.equal(m('First Name'), '__first_name');
});

test('commitments Vinoth has not made are asked, never answered', () => {
  assert.equal(m('Are you subject to a non-compete agreement?'), '__ask');
  assert.equal(m('Have you previously worked at Acme?'), '__ask');
  assert.equal(m('Are you comfortable working PST hours?'), '__ask');
  assert.equal(m('Are you willing to work onsite 5 days a week?'), '__ask');
});

// Labels copied verbatim from the 2026-09-15 dry run against live Greenhouse forms.
test('GitLab: agreements "with your current employer" are asked, not answered "Aptean"', () => {
  assert.equal(
    m('Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?*', 'combobox'),
    '__ask',
  );
});

test('Celonis: "Most Recent Job Title" is the current title', () => {
  assert.equal(m('Most Recent Job Title*'), 'current_title');
  assert.equal(m('Most Recent Employer*'), 'current_employer');
});

test('Celonis: attestations rendered as dropdowns are consent', () => {
  assert.equal(
    m('I confirm, that I have read the Celonis Privacy Notice for the handling of my personal data in the application process.*', 'combobox'),
    '__checkbox_confirm',
  );
  assert.equal(
    m('I confirm the information provided in this application, including but not limited to my resume and the above information, is true and correct.*', 'combobox'),
    '__checkbox_confirm',
  );
});

test('a dropdown that merely mentions "confirm" is not consent', () => {
  assert.notEqual(m('Please confirm your notice period', 'select'), '__checkbox_confirm');
});

test('"organization" in an unrelated label is not the employer', () => {
  assert.notEqual(m('Are you a member of any professional organization?'), 'current_employer');
  assert.equal(m('Current company'), 'current_employer');
});
