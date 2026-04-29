'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAndNormalizeGroups,
  pruneGroupsAgainstPartIds,
} = require('../lib/groupUtils');

test('validateAndNormalizeGroups accepts valid non-overlapping groups', () => {
  const input = [
    { name: 'Piano', partIds: ['P1', 'P2', 'P2'] },
    { name: 'Choir', partIds: ['C1', 'C2'] },
  ];
  const result = validateAndNormalizeGroups(input, ['P1', 'P2', 'C1', 'C2']);

  assert.equal(result.ok, true);
  assert.deepEqual(result.groups, [
    { name: 'Piano', partIds: ['P1', 'P2'] },
    { name: 'Choir', partIds: ['C1', 'C2'] },
  ]);
});

test('validateAndNormalizeGroups rejects overlapping members', () => {
  const input = [
    { name: 'Piano', partIds: ['P1', 'P2'] },
    { name: 'Strings', partIds: ['P2', 'S1'] },
  ];
  const result = validateAndNormalizeGroups(input, ['P1', 'P2', 'S1']);

  assert.equal(result.ok, false);
  assert.match(result.error, /cannot belong to multiple groups/i);
});

test('pruneGroupsAgainstPartIds removes invalid members and tiny groups', () => {
  const input = [
    { name: 'Piano', partIds: ['P1', 'P2', 'X1'] },
    { name: 'Flute', partIds: ['F1'] },
  ];
  const result = pruneGroupsAgainstPartIds(input, ['P1', 'P2']);

  assert.deepEqual(result, [{ name: 'Piano', partIds: ['P1', 'P2'] }]);
});
