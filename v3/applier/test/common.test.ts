import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueForField, pickOption } from '../src/adapters/common.js';

test('"Male" never selects "Female"', () => {
  const options = ['Female', 'Male', 'Non-binary', 'Decline To Self Identify'];
  assert.equal(options[pickOption('Male', options)], 'Male');
  assert.equal(pickOption('Male', ['Female', 'Decline To Self Identify']), -1);
  assert.equal(['Woman', 'Man'][pickOption('Man', ['Woman', 'Man'])], 'Man');
});

test('a value still matches an option that contains it as whole words', () => {
  assert.equal(pickOption('Bangalore', ['In Bangalore', 'Cannot relocate']), 0);
  assert.equal(pickOption('30 days', ['15 days', '30 days or less']), 1);
});

test('a year field gets just the year — BitGo received 202112 before this', () => {
  assert.equal(valueForField('Start date year*', '2021-12'), '2021');
  assert.equal(valueForField('End date year*', '2025'), '2025');
});

test('other fields keep the fact as it is', () => {
  assert.equal(valueForField('Notice Period?', '30'), '30');
  assert.equal(valueForField('Expected CTC', '800000'), '800000');
  assert.equal(valueForField('Years of experience', '2.2'), '2.2');
});
