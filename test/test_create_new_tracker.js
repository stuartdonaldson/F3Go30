const assert = require('node:assert/strict');

const {
  ensureLinksSheetSchema_,
  findPreviousTrackerFromLinks_,
  formatLinksStartDateValue_,
  formatTrackerMonthKey_,
  hideInternalSheets_,
  resolvePreviousTrackerReference_,
  upsertLinksRow_,
} = require('../script/CreateNewTracker.js');

assert.equal(formatTrackerMonthKey_(new Date(2026, 4, 30)), '2026-05');
assert.equal(formatLinksStartDateValue_(new Date(2026, 3, 1)), '2026-04-01');

assert.deepEqual(
  findPreviousTrackerFromLinks_(
    [
      { startDate: '2026-03-01', trackerUrl: 'https://example.com/march' },
      { startDate: '2026-04-01', trackerUrl: 'https://example.com/april-old' },
      { startDate: '2026-04-07', trackerUrl: 'https://example.com/april-current' },
      { startDate: '2026-05-01', trackerUrl: 'https://example.com/may' },
    ],
    new Date(2026, 4, 1)
  ),
  {
    name: '2026-04-07',
    url: 'https://example.com/april-current'
  }
);

assert.equal(
  findPreviousTrackerFromLinks_(
    [
      { startDate: '2026-05-01', trackerUrl: 'https://example.com/may' }
    ],
    new Date(2026, 6, 1)
  ),
  null
);

assert.deepEqual(
  findPreviousTrackerFromLinks_(
    [
      { startDate: new Date(2026, 4, 1), trackerUrl: '', sheetId: 'sheet-may-id' },
      { startDate: new Date(2026, 5, 1), trackerUrl: 'https://example.com/june' }
    ],
    new Date(2026, 5, 1)
  ),
  {
    name: '2026-05-01',
    url: 'sheet-may-id'
  }
);

assert.equal(
  resolvePreviousTrackerReference_({ sheetId: 'sheet-123', trackerUrl: 'https://example.com/tracker', shortTracker: 'https://tinyurl.com/x' }),
  'sheet-123'
);

assert.equal(
  resolvePreviousTrackerReference_({ trackerUrl: 'https://example.com/tracker', shortTracker: 'https://tinyurl.com/x' }),
  'https://example.com/tracker'
);

assert.equal(
  resolvePreviousTrackerReference_({ shortTracker: 'https://tinyurl.com/x' }),
  'https://tinyurl.com/x'
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

const allowListNames = ['Tracker', 'Bonus Tracker', 'Team Score', 'HIM Score', 'Goals by HIM', 'Goals by AO', 'Help'];
const otherNames = ['TrackerDB', 'Responses', 'PaxDB', 'Config'];
const allSheets = allowListNames.concat(otherNames).map(makeFakeSheet);

const fakeSpreadsheet = {
  getSheets: function() { return allSheets; },
  getSheetByName: function(name) {
    return allSheets.find(function(s) { return s.getName() === name; }) || null;
  },
  deleteSheet: function(sheet) { deletedSheets.push(sheet.getName()); }
};

hideInternalSheets_(fakeSpreadsheet);

assert.deepEqual(hiddenSheets.sort(), ['Config', 'Responses', 'TrackerDB']);
assert.deepEqual(deletedSheets, ['PaxDB']);
assert.ok(hiddenSheets.indexOf('PaxDB') === -1);

console.log('test_create_new_tracker.js: PASS');