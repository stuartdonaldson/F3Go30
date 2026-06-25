const assert = require('node:assert/strict');

const {
  decideSignupShortUrlAction_,
  ensureLinksSheetSchema_,
  hideInternalSheets_,
  upsertLinksRow_,
} = require('../script/CreateNewTracker.js');

// decideSignupShortUrlAction_ — first run ever, no Config row yet: create, no warning.
assert.deepEqual(
  decideSignupShortUrlAction_(null, null, 'https://script.google.com/.../exec?cmd=signup'),
  { action: 'create', warn: false }
);

// Existing short URL already redirects to the expected target: reuse, no warning.
assert.deepEqual(
  decideSignupShortUrlAction_(
    'https://tinyurl.com/Go30Signup',
    'https://script.google.com/.../exec?cmd=signup',
    'https://script.google.com/.../exec?cmd=signup'
  ),
  { action: 'reuse', warn: false }
);

// Existing short URL redirects somewhere else (e.g. deployment ID changed): repair, warn.
assert.deepEqual(
  decideSignupShortUrlAction_(
    'https://tinyurl.com/Go30Signup',
    'https://script.google.com/.../old-deployment?cmd=signup',
    'https://script.google.com/.../exec?cmd=signup'
  ),
  { action: 'repair', warn: true }
);

// Existing short URL on file but redirect could not be resolved (fetch failure): repair, warn.
assert.deepEqual(
  decideSignupShortUrlAction_('https://tinyurl.com/Go30Signup', null, 'https://script.google.com/.../exec?cmd=signup'),
  { action: 'repair', warn: true }
);

const updateCalls = [];
const appendCalls = [];
const fakeManagedSheet = {
  findRow: function(field, value) {
    assert.equal(field, 'sheetId');
    return value === 'sheet-123' ? { sheetId: value } : null;
  },
  updateRowByValue: function(field, value, updates) {
    updateCalls.push({ field, value, updates });
  },
  appendRow: function(row) {
    appendCalls.push(row);
  }
};

assert.equal(
  upsertLinksRow_(fakeManagedSheet, { sheetId: 'sheet-123', trackerUrl: 'https://example.com/tracker' }),
  'updated'
);
assert.equal(updateCalls.length, 1);
assert.equal(appendCalls.length, 0);

assert.equal(
  upsertLinksRow_(fakeManagedSheet, { sheetId: 'sheet-999', trackerUrl: 'https://example.com/other' }),
  'appended'
);
assert.equal(appendCalls.length, 1);

const legacyValues = [
  ['Date', 'Month', 'Spreadsheet Name', 'Tracker URL', 'Form URL', 'Spreadsheet ID', 'Form ID'],
  ['2026-05-30', '2026-06-01', '2026-06-T5.1 Go30', 'https://example.com/tracker', 'https://example.com/form', 'sheet-legacy', 'form-legacy']
];
const writes = [];
const fakeLegacyLinksSheet = {
  headerMap: { date: 0 },
  data: legacyValues,
  sheet: {
    getDataRange: function() {
      return {
        getValues: function() {
          return legacyValues.map(function(row) { return row.slice(); });
        }
      };
    },
    getLastColumn: function() {
      return legacyValues[0].length;
    },
    getRange: function(row, col) {
      return {
        setValue: function(value) {
          while (legacyValues.length < row) legacyValues.push([]);
          while (legacyValues[row - 1].length < col) legacyValues[row - 1].push('');
          legacyValues[row - 1][col - 1] = value;
          writes.push({ row, col, value });
        }
      };
    }
  },
  refreshData: function() {
    this.data = legacyValues.map(function(row) { return row.slice(); });
  }
};

ensureLinksSheetSchema_(fakeLegacyLinksSheet);
assert.deepEqual(legacyValues[0], [
  'Date',
  'Month',
  'Spreadsheet Name',
  'Tracker URL',
  'Form URL',
  'Spreadsheet ID',
  'Form ID',
  'StartDate',
  'SpreadsheetName',
  'ShortTracker',
  'TrackerURL',
  'ShortHC',
  'HC URL',
  'SheetId',
  'FormId'
]);
assert.equal(legacyValues[1][7], '2026-06-01');
assert.equal(legacyValues[1][8], '2026-06-T5.1 Go30');
assert.equal(legacyValues[1][9], 'https://example.com/tracker');
assert.equal(legacyValues[1][10], 'https://example.com/tracker');
assert.equal(legacyValues[1][11], 'https://example.com/form');
assert.equal(legacyValues[1][12], 'https://example.com/form');
assert.equal(legacyValues[1][13], 'sheet-legacy');
assert.equal(legacyValues[1][14], 'form-legacy');
assert.ok(writes.length >= 8);

const hiddenSheets = [];
const deletedSheets = [];

function makeFakeSheet(name) {
  return {
    getName: function() { return name; },
    hideSheet: function() { hiddenSheets.push(name); }
  };
}

const visibleNames  = ['Tracker', 'Bonus Tracker', 'Team Score', 'HIM Score', 'Goals by HIM', 'Goals by AO', 'Help'];
const hiddenNames   = ['Config', 'Responses'];
const deleteNames   = ['TrackerDB', 'PaxDB'];
const allSheets = visibleNames.concat(hiddenNames).concat(deleteNames).map(makeFakeSheet);

const fakeSpreadsheet = {
  getSheets: function() { return allSheets; },
  getSheetByName: function(name) {
    return allSheets.find(function(s) { return s.getName() === name; }) || null;
  },
  deleteSheet: function(sheet) { deletedSheets.push(sheet.getName()); }
};

hideInternalSheets_(fakeSpreadsheet);

assert.deepEqual(hiddenSheets.sort(), ['Config', 'Responses']);
assert.deepEqual(deletedSheets.sort(), ['PaxDB', 'TrackerDB']);
assert.ok(hiddenSheets.indexOf('TrackerDB') === -1);
assert.ok(hiddenSheets.indexOf('PaxDB') === -1);

console.log('test_create_new_tracker.js: PASS');