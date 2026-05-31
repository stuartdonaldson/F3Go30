const assert = require('node:assert/strict');

const {
  buildCaseInsensitiveHeaderMap_,
  resolveManagedHeaderMap_,
  findRowIndexByNormalizedValue_,
  buildSharedHeaderCopyPlan_,
  sheetHasContent_,
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

const normalizedResponseMap = resolveManagedHeaderMap_(
  [
    'Email Address',
    'Team preference',
    'What is your goal?',
    'WHO do you ultimately want to become?'
  ],
  {
    EMAIL: { header: 'Email Address' },
    TEAM_TYPE: { header: 'Team type', aliases: ['Team preference'], optional: true },
    OTHER_TEAM: { header: 'Other team name', aliases: ['What is your goal?'] },
    WHO: { header: 'WHO do you ultimately want to become?' },
    NAG_EMAIL: { header: 'NAG Email?', aliases: ['NAG'], optional: true }
  }
);

assert.deepEqual(normalizedResponseMap, {
  EMAIL: 0,
  TEAM_TYPE: 1,
  OTHER_TEAM: 2,
  WHO: 3,
});

assert.equal(sheetHasContent_([]), false);
assert.equal(sheetHasContent_([['']]), false);
assert.equal(sheetHasContent_([[null, undefined, '']]), false);
assert.equal(sheetHasContent_([['Timestamp', 'Email Address']]), true);

console.log('test_sheet_helpers.js: PASS');