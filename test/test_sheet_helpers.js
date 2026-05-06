const assert = require('node:assert/strict');

const {
  buildCaseInsensitiveHeaderMap_,
  findRowIndexByNormalizedValue_,
  buildSharedHeaderCopyPlan_,
} = require('../script/libSheets.js');

const headerMap = buildCaseInsensitiveHeaderMap_(['Email Address', 'F3 Name', 'Goal Selection']);
assert.deepEqual(headerMap, {
  'email address': 0,
  'f3 name': 1,
  'goal selection': 2,
});

const rows = [
  ['Email Address', 'F3 Name'],
  ['one@example.com', 'One'],
  ['TWO@example.com', 'Two'],
];

assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'two@example.com', { startRow: 1 }), 2);
assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'one@example.com', { startRow: 1, fromEnd: true }), 1);
assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'missing@example.com', { startRow: 1 }), -1);

const copyPlan = buildSharedHeaderCopyPlan_(
  ['Email Address', 'Goal Selection', 'How'],
  ['pax@example.com', 'Endurance', 'Journal'],
  ['How', 'Email Address', 'Unused']
);

assert.deepEqual(copyPlan, [
  { header: 'Email Address', targetIndex: 1, value: 'pax@example.com' },
  { header: 'How', targetIndex: 0, value: 'Journal' },
]);

console.log('test_sheet_helpers.js: PASS');