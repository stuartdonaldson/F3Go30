const assert = require('node:assert/strict');

const {
  buildEmailRecipientList_,
  initializeConfigSheet_,
} = require('../script/Utilities.js');
const {
  getResponseEmailColumnIndexes_,
  getResponseEmailValue_,
  findResponseRowIndexByEmail_,
  resolveResponseColumns,
  buildGoalSummaryLinesFromResponse_,
} = require('../script/response_utils.js');

function makeConfigSheet(initialRows) {
  const rows = (initialRows || []).map(function(row) {
    return [row[0] || '', row[1] || '', row[2] || ''];
  });
  const parentSpreadsheet = {
    getUrl: function() {
      return 'https://docs.google.com/spreadsheets/d/template-sheet-id/edit';
    }
  };

  return {
    _rows: rows,
    getParent: function() {
      return parentSpreadsheet;
    },
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

const configSheet = makeConfigSheet([
  ['NameSpace', 'TTTT4 Go30', ''],
  ['Site Q', 'Little John', 'stu@asyn.com'],
  ['Email Test', 'Yes', 'legacy'],
]);

const rows = initializeConfigSheet_(configSheet);

function findRow(name) {
  return rows.find(function(row) {
    return row[0] === name;
  });
}

assert.deepEqual(findRow('NameSpace'), ['NameSpace', 'TTTT4 Go30', '']);
assert.deepEqual(findRow('Site Q'), ['Site Q', 'Little John', 'stu@asyn.com']);
assert.deepEqual(findRow('Email Test Mode'), ['Email Test Mode', 'Yes', 'legacy']);
assert.deepEqual(findRow('LogFile'), ['LogFile', '', '']);
assert.deepEqual(findRow('Signup HC Form'), ['Signup HC Form', '', '']);
assert.deepEqual(findRow('Sheet Template'), ['Sheet Template', 'https://docs.google.com/spreadsheets/d/template-sheet-id/edit', '']);
assert.deepEqual(findRow('Last Month Tracker'), ['Last Month Tracker', '', '']);

const defaultedSheet = makeConfigSheet([]);
const defaultedRows = initializeConfigSheet_(defaultedSheet);
const defaultedEmailRow = defaultedRows.find(function(row) { return row[0] === 'Email Test Mode'; });
assert.deepEqual(defaultedEmailRow, ['Email Test Mode', 'No', '']);
const defaultedTemplateRow = defaultedRows.find(function(row) { return row[0] === 'Sheet Template'; });
assert.deepEqual(defaultedTemplateRow, ['Sheet Template', 'https://docs.google.com/spreadsheets/d/template-sheet-id/edit', '']);

const prefilledTemplateSheet = makeConfigSheet([
  ['Sheet Template', 'https://docs.google.com/spreadsheets/d/source-template/edit', '']
]);
const prefilledRows = initializeConfigSheet_(prefilledTemplateSheet);
const prefilledTemplateRow = prefilledRows.find(function(row) { return row[0] === 'Sheet Template'; });
assert.deepEqual(prefilledTemplateRow, ['Sheet Template', 'https://docs.google.com/spreadsheets/d/source-template/edit', '']);

assert.equal(
  buildEmailRecipientList_([
    { name: 'Little John', email: 'stuart.donaldson+Go30@gmail.com' },
    { name: 'Güéŕó 🌮', email: 'second@example.com' },
    { name: '', email: 'third@example.com' }
  ]),
  'Little John <stuart.donaldson+go30@gmail.com>,Guero <second@example.com>,third@example.com'
);

const responseHeaders = [
  'Timestamp',
  'Email Address',
  'Are you currently participating in Go30?',
  'F3 Name',
  'Email Address 2',
  'Team',
  'Other team name',
  'WHO do you ultimately want to become?',
  'WHAT is your Go30 Challenge?',
  'HOW are you going to be successful this month?',
  'Cell Phone Number',
  'NAG Email?'
];
const responseColumns = resolveResponseColumns(responseHeaders);
const responseRow = ['2026-05-30 10:00:00', '', 'Yes', 'Little John', 'stuart.donaldson@gmail.com', '', '', '', '', '', '', 'Yes'];

assert.deepEqual(getResponseEmailColumnIndexes_(responseColumns, responseHeaders), [1, 4]);
assert.equal(getResponseEmailValue_(responseRow, responseColumns, responseHeaders), 'stuart.donaldson@gmail.com');
assert.equal(
  findResponseRowIndexByEmail_([
    responseHeaders,
    ['2026-05-29 10:00:00', '', 'Yes', 'PAX', 'other@example.com', '', '', '', '', '', '', 'No'],
    responseRow
  ], 'stuart.donaldson@gmail.com', responseColumns, responseHeaders, 1),
  2
);
assert.deepEqual(
  buildGoalSummaryLinesFromResponse_(responseRow, responseColumns, responseHeaders),
  ['Email: stuart.donaldson@gmail.com', 'NAG Email: Yes']
);

console.log('test_utilities.js: PASS');