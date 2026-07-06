const assert = require('node:assert/strict');

const {
  selectRecentRealTrackerRows_,
  buildCopiedTrackerDbRow_,
  computeSafeConfigDefaults_,
  buildRenamedTrackerName_,
  applySafeConfigDefaults_
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

// computeSafeConfigDefaults_ always forces Email Test Mode=Yes regardless of folderName, and
// derives NameSpace from the operator-supplied folderName (unified identifier).
const defaults = computeSafeConfigDefaults_('SIT-2026-07-06');
assert.equal(defaults.emailTestMode.key, 'Email Test Mode');
assert.equal(defaults.emailTestMode.primary, 'Yes');
assert.equal(defaults.nameSpace.key, 'NameSpace');
assert.equal(defaults.nameSpace.primary, 'SIT-2026-07-06');

// buildRenamedTrackerName_ appends the folderName marker to the original tracker name — the
// safe default (vs substituting the NameSpace segment of "YYYY-MM-<oldNs>").
assert.equal(
  buildRenamedTrackerName_('2026-07 F3 Go30', 'SIT-2026-07-06'),
  '2026-07 F3 Go30 (SIT-2026-07-06)'
);

// applySafeConfigDefaults_ forces Email Test Mode=YES even when the source Config carried "No"
// (simulating a verbatim-copied PROD Config), and sets NameSpace to folderName even when the
// source Config carried a different (PROD) NameSpace.
function makeFakeConfigSheet_(initialRows) {
  const rows = (initialRows || []).map(function(row) {
    return [row[0] || '', row[1] || '', row[2] || ''];
  });
  return {
    _rows: rows,
    getDataRange: function() {
      const sheet = this;
      return {
        getValues: function() {
          return sheet._rows.map(function(row) { return row.slice(); });
        }
      };
    },
    getRange: function(row, col) {
      const sheet = this;
      return {
        setValue: function(value) {
          while (sheet._rows.length < row) sheet._rows.push(['', '', '']);
          while (sheet._rows[row - 1].length < col) sheet._rows[row - 1].push('');
          sheet._rows[row - 1][col - 1] = value;
        }
      };
    },
    appendRow: function(values) {
      this._rows.push([values[0] || '', values[1] || '', values[2] || '']);
    }
  };
}

function findConfigRow_(rows, name) {
  return rows.find(function(row) { return row[0] === name; });
}

const prodLikeConfigSheet = makeFakeConfigSheet_([
  ['NameSpace', 'F3 Go30', ''],
  ['Email Test Mode', 'No', ''],
  ['Site Q', 'Little John', 'stu@example.com']
]);
const appliedRows = applySafeConfigDefaults_(prodLikeConfigSheet, 'SIT-2026-07-06');
assert.equal(findConfigRow_(appliedRows, 'Email Test Mode')[1], 'Yes');
assert.equal(findConfigRow_(appliedRows, 'NameSpace')[1], 'SIT-2026-07-06');
// The live sheet itself (not just the returned rows array) was updated.
assert.equal(findConfigRow_(prodLikeConfigSheet._rows, 'Email Test Mode')[1], 'Yes');
assert.equal(findConfigRow_(prodLikeConfigSheet._rows, 'NameSpace')[1], 'SIT-2026-07-06');
// Unrelated Config rows are left untouched.
assert.equal(findConfigRow_(appliedRows, 'Site Q')[1], 'Little John');

// applySafeConfigDefaults_ also works when the copied Config sheet has neither row yet
// (defensive: appendRow path of upsertConfigSheetRow_).
const emptyConfigSheet = makeFakeConfigSheet_([
  ['Site Q', 'Little John', 'stu@example.com']
]);
const appliedFromEmpty = applySafeConfigDefaults_(emptyConfigSheet, 'SIT-2026-07-06');
assert.equal(findConfigRow_(appliedFromEmpty, 'Email Test Mode')[1], 'Yes');
assert.equal(findConfigRow_(appliedFromEmpty, 'NameSpace')[1], 'SIT-2026-07-06');

console.log('test_copy_template.js OK');
