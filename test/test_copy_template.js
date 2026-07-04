const assert = require('node:assert/strict');

const {
  selectRecentRealTrackerRows_,
  buildCopiedTrackerDbRow_
} = require('../script/CopyTemplate.js');

// Filters out smoke and expired rows, keeps real ones.
const rows = [
  { sheetId: 'a', spreadsheetName: '2026-07 F3 Go30', startDate: new Date('2026-07-01') },
  { sheetId: 'b', spreadsheetName: '2026-08 F3 Go30 (Smoke)', startDate: new Date('2026-08-01') },
  { sheetId: 'c', spreadsheetName: '2026-06 F3 Go30 (Expired)', startDate: new Date('2026-06-01') },
  { sheetId: 'd', spreadsheetName: '2026-05 F3 Go30', startDate: new Date('2026-05-01') },
  { sheetId: 'e', spreadsheetName: '2026-04 F3 Go30', startDate: new Date('2026-04-01') },
  { sheetId: '', spreadsheetName: 'no sheet id', startDate: new Date('2026-09-01') }
];

// Selects the 3 most recent real trackers, sorted descending by StartDate, smoke/expired/no-id excluded.
assert.deepEqual(
  selectRecentRealTrackerRows_(rows, 3).map(function(r) { return r.sheetId; }),
  ['a', 'd', 'e']
);

// count is respected.
assert.deepEqual(
  selectRecentRealTrackerRows_(rows, 1).map(function(r) { return r.sheetId; }),
  ['a']
);

// No eligible rows -> empty array, not a throw (caller decides how to handle).
assert.deepEqual(
  selectRecentRealTrackerRows_([
    { sheetId: 'b', spreadsheetName: 'x (Smoke)', startDate: new Date('2026-08-01') }
  ], 3),
  []
);

// buildCopiedTrackerDbRow_ assembles a fresh TrackerDB row with blank lineage/lifecycle fields.
const row = buildCopiedTrackerDbRow_(
  { sheetId: 'new-id', spreadsheetName: '2026-07 F3 Go30' },
  { startDate: new Date('2026-07-01'), trackerUrl: 'https://example.com/new-id', hcUrl: 'https://forms.example.com/old' },
  { totalPax: 19, totalTeams: 6, averageScore: 1 }
);
assert.equal(row.sheetId, 'new-id');
assert.equal(row.spreadsheetName, '2026-07 F3 Go30');
assert.equal(row.trackerUrl, 'https://example.com/new-id');
assert.equal(row.hcUrl, 'https://forms.example.com/old');
assert.equal(row.totalPax, 19);
assert.equal(row.totalTeams, 6);
assert.equal(row.averageScore, 1);
assert.equal(row.shortTracker, '');
assert.equal(row.shortHc, '');
assert.equal(row.formId, '');
assert.equal(row.lastSignupAt, '');
assert.equal(row.triggersInitializedAt, '');
assert.equal(row.lastMinusOneRunAt, '');
assert.equal(row.lastNagRunAt, '');
assert.ok(row.dateModified instanceof Date);

console.log('test_copy_template.js OK');
