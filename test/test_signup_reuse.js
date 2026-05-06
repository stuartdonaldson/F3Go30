const assert = require('node:assert/strict');

const {
  GO30_PARTICIPATION_REUSE_LABEL_,
  findLatestResponseByEmail_,
  isReuseLastMonthsGoalsChoice_,
  extractReusableResponseValues_,
  mergeReusedValuesIntoResponseRow_,
  buildReuseSummaryLines_,
} = require('../script/signupReuse.js');

const rows = [
  ['2026-03-01 08:00:00', 'pax@example.com', 'Yes', 'Anchor', 'AO-based', 'Team A', 'Strength', 'Leader', 'Run', 'Plan', '555-1111'],
  ['2026-03-02 08:00:00', 'other@example.com', 'No', 'Other', '', '', '', '', '', '', ''],
  ['2026-03-03 08:00:00', 'PAX@example.com', 'Yes', 'Anchor', 'goal-based', 'Team B', 'Endurance', 'Disciplined', 'Ruck', 'Journal', '555-2222'],
];

assert.equal(isReuseLastMonthsGoalsChoice_("Yes, and use last month's goals."), true);
assert.equal(isReuseLastMonthsGoalsChoice_(" yes, and use last month's goals. "), true);
assert.equal(isReuseLastMonthsGoalsChoice_('Yes'), false);

const latest = findLatestResponseByEmail_(rows, 'pax@example.com');
assert.ok(latest);
assert.equal(latest.rowIndex, 2);
assert.equal(latest.row[5], 'Team B');

assert.equal(findLatestResponseByEmail_(rows, 'missing@example.com'), null);

const reusedValues = extractReusableResponseValues_(latest.row);
assert.deepEqual(reusedValues, {
  teamPreference: 'goal-based',
  team: 'Team B',
  goalSelection: 'Endurance',
  who: 'Disciplined',
  what: 'Ruck',
  how: 'Journal',
  phone: '555-2222',
});

const merged = mergeReusedValuesIntoResponseRow_([
  '2026-04-01 08:00:00',
  'pax@example.com',
  "Yes, and use last month's goals.",
  'Anchor',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
], reusedValues);

assert.deepEqual(merged.slice(4, 11), [
  'goal-based',
  'Team B',
  'Endurance',
  'Disciplined',
  'Ruck',
  'Journal',
  '555-2222',
]);

assert.deepEqual(buildReuseSummaryLines_(reusedValues), [
  'Team preference: goal-based',
  'Team: Team B',
  'Goal selection: Endurance',
  'Who: Disciplined',
  'What: Ruck',
  'How: Journal',
  'Phone: 555-2222',
]);

console.log('test_signup_reuse.js: PASS');