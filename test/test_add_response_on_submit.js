const assert = require('node:assert/strict');

// GAS global stubs — must be set before require.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, init: function() {}, flush: function() {} };
global.SpreadsheetApp = {};
global.ScriptApp = {};
global.runWithLock = function(fn) { fn(); return true; };
global.getResponseValue_ = function(row, cols, key) { return row[cols[key]] || ''; };
global.resolveResponseColumns = function(sheet) {
  if (sheet && sheet._headers && typeof sheet._headers === 'object' && !Array.isArray(sheet._headers)) {
    return sheet._headers;
  }
  return {};
};
global.buildResponseFieldCopyPlan_ = function(srcCols, srcRow, tgtCols) {
  const plan = [];
  Object.keys(srcCols).forEach(function(key) {
    if (typeof tgtCols[key] === 'number') {
      plan.push({ field: key, targetIndex: tgtCols[key], value: srcRow[srcCols[key]] });
    }
  });
  return plan;
};
global.maybeReuseLastMonthsGoals_ = function(ss, respSheet, rowNum, responses) { return responses; };
global.buildGoalSummaryLinesFromResponse_ = function() { return ['Who: Leader']; };
global.sendRegistrationConfirmationEmail_ = function(spreadsheet, email, f3Name, trackerUrl, formUrl, summaryLines, registrationMonth) {
  global._registrationConfirmationCalls.push({ spreadsheet, email, f3Name, trackerUrl, formUrl, summaryLines, registrationMonth });
};
global.checkIsReuseChoice_ = function(answer) { return answer === 'Reuse'; };
global.getConfigValue_ = function() { return null; };
global.logActivity = function() {};
global._registrationConfirmationCalls = [];

const {
  findDuplicateResponseRows_,
  removeDuplicateResponseRow_,
  deduplicateResponsesSheet_,
  getTrackerStartDate_,
  formatRegistrationMonth_,
  maybeSendRegistrationConfirmation_,
  appendToResponsesSheet_
} = require('../script/addResponseOnSubmit.js');

// Helper: build a single-column values array as getRange().getValues() returns.
function col(values) {
  return values.map(function(v) { return [v]; });
}

// --- findDuplicateResponseRows_ (keyed on F3 Name) ---

// No prior rows → nothing to delete
{
  const result = findDuplicateResponseRows_(col(['Anchor']), 2, 'Anchor');
  assert.deepEqual(result, [], 'single row: nothing to delete');
}

// One prior row for same F3 name, submitted is last
{
  const result = findDuplicateResponseRows_(col(['Anchor', 'Sapper', 'Anchor']), 4, 'Anchor');
  assert.deepEqual(result, [2], 'one prior row: returns its row number');
}

// Two prior rows for same F3 name, submitted is last
{
  const result = findDuplicateResponseRows_(
    col(['Anchor', 'Sapper', 'Anchor', 'Torch', 'Anchor']), 6, 'Anchor');
  assert.deepEqual(result, [4, 2], 'two prior rows: returned descending (delete highest first)');
}

// F3 Name comparison is case-insensitive
{
  const result = findDuplicateResponseRows_(col(['ANCHOR', 'Sapper', 'anchor']), 4, 'Anchor');
  assert.deepEqual(result, [2], 'case-insensitive F3 name match');
}

// Submitted row in the middle — all non-submitted matches returned descending
{
  const result = findDuplicateResponseRows_(
    col(['Anchor', 'Sapper', 'Anchor', 'Anchor']), 3, 'Anchor');
  assert.deepEqual(result, [5, 4, 2], 'non-submitted matching rows returned descending');
}

// No matching F3 name → nothing to delete
{
  const result = findDuplicateResponseRows_(col(['Torch', 'Sapper', 'Hammer']), 4, 'Anchor');
  assert.deepEqual(result, [], 'no match: empty result');
}

// Empty key value → nothing to delete
{
  const result = findDuplicateResponseRows_(col(['Anchor', 'Anchor']), 3, '');
  assert.deepEqual(result, [], 'empty key: nothing to delete');
}

// Whitespace trimmed on stored value
{
  const result = findDuplicateResponseRows_(col(['  Anchor  ', 'Anchor']), 3, 'Anchor');
  assert.deepEqual(result, [2], 'whitespace trimmed on stored F3 name');
}

// PAX changes email but keeps F3 name — old row IS matched and deleted (ADR-008)
{
  // Row 2: old submission with old email (column value here is F3 name, not email)
  // Row 3: new submission — same F3 name, different email would be in a different column
  const result = findDuplicateResponseRows_(col(['Anchor', 'Anchor']), 3, 'Anchor');
  assert.deepEqual(result, [2], 'email change: old row matched by F3 name and deleted');
}

// Duplicate rows are marked DELETED in the PARTICIPATION column during form-submit handling.
{
  const writes = [];
  const deleted = [];
  const responsesSheet = {
    getLastRow: function() { return 4; },
    getLastColumn: function() { return 12; },
    getRange: function(row, column, numRows, numCols) {
      if (column === 4) {
        assert.equal(row, 2, 'F3 name scan starts at first data row');
        assert.equal(numRows, 3, 'F3 name scan covers all data rows');
        assert.equal(numCols, 1, 'F3 name scan is single-column');
        return { getValues: function() { return col(['Anchor', 'Sapper', 'Anchor']); } };
      }
      return {
        setValue: function(value) {
          writes.push({ row: row, col: column, value: value });
        }
      };
    },
    deleteRow: function(row) { deleted.push(row); }
  };

  deduplicateResponsesSheet_(responsesSheet, 4, 'Anchor', { F3_NAME: 3, PARTICIPATION: 2 });
  assert.deepEqual(writes, [{ row: 2, col: 3, value: 'DELETED' }], 'duplicate row marked deleted in participation column');
  assert.deepEqual(deleted, [], 'clear path does not delete rows');
}

// If clearContent fails, dedup falls back to deleteRow.
{
  const deleted = [];
  const responsesSheet = {
    getRange: function() {
      return {
        setValue: function() {
          throw new Error('clear failed');
        }
      };
    },
    deleteRow: function(row) { deleted.push(row); }
  };

  const action = removeDuplicateResponseRow_(responsesSheet, 7, { PARTICIPATION: 2 });
  assert.equal(action, 'deleted', 'deleteRow fallback used when clear fails');
  assert.deepEqual(deleted, [7], 'fallback deletes the duplicate row');
}

// Tracker month is derived from the first date column in row 3.
{
  const startDate = getTrackerStartDate_({
    getLastColumn: function() { return 12; },
    getRange: function(row, col, numRows, numCols) {
      assert.equal(row, 3);
      assert.equal(col, 9);
      assert.equal(numRows, 1);
      assert.equal(numCols, 4);
      return { getValues: function() { return [[new Date(2026, 5, 1), '', '', '']]; } };
    }
  });

  assert.equal(formatRegistrationMonth_(startDate), 'June 2026');
}

// Non-reuse submit sends a generic registration confirmation using tracker start date.
{
  global._registrationConfirmationCalls = [];
  const sent = maybeSendRegistrationConfirmation_(
    {
      getUrl: function() { return 'https://spreadsheet.example.com'; },
      getFormUrl: function() { return 'https://form.example.com'; }
    },
    {
      getSheetId: function() { return 456; },
      getLastColumn: function() { return 10; },
      getRange: function() { return { getValues: function() { return [[new Date(2026, 5, 1), '']]; } }; }
    },
    { EMAIL: 1, PARTICIPATION: 2, F3_NAME: 3 },
    ['ts', 'anchor@example.com', 'No', 'Anchor']
  );

  assert.equal(sent, true, 'confirmation was sent');
  assert.equal(global._registrationConfirmationCalls.length, 1, 'one confirmation call captured');
  assert.equal(global._registrationConfirmationCalls[0].spreadsheet.getUrl(), 'https://spreadsheet.example.com');
  assert.equal(global._registrationConfirmationCalls[0].spreadsheet.getFormUrl(), 'https://form.example.com');
  assert.equal(global._registrationConfirmationCalls[0].email, 'anchor@example.com');
  assert.equal(global._registrationConfirmationCalls[0].f3Name, 'Anchor');
  assert.equal(global._registrationConfirmationCalls[0].trackerUrl, 'https://spreadsheet.example.com#gid=456');
  assert.equal(global._registrationConfirmationCalls[0].formUrl, 'https://form.example.com');
  assert.deepEqual(global._registrationConfirmationCalls[0].summaryLines, ['Who: Leader']);
  assert.equal(global._registrationConfirmationCalls[0].registrationMonth, 'June 2026');
}

// Reuse submit keeps the dedicated reuse email and skips the generic confirmation.
{
  global._registrationConfirmationCalls = [];
  const sent = maybeSendRegistrationConfirmation_(
    {
      getUrl: function() { return 'https://spreadsheet.example.com'; },
      getFormUrl: function() { return 'https://form.example.com'; }
    },
    {
      getSheetId: function() { return 456; },
      getLastColumn: function() { return 10; },
      getRange: function() { return { getValues: function() { return [[new Date(2026, 5, 1), '']]; } }; }
    },
    { EMAIL: 1, PARTICIPATION: 2, F3_NAME: 3 },
    ['ts', 'anchor@example.com', 'Reuse', 'Anchor']
  );

  assert.equal(sent, false, 'reuse path skips generic confirmation');
  assert.deepEqual(global._registrationConfirmationCalls, []);
}

// appendToResponsesSheet_: maps form-order row to Responses column order and appends.
{
  const appended = [];
  const formHeaders   = ['Timestamp', 'Email Address', 'F3 Name', 'Team', 'WHAT is your Go30 Challenge?'];
  const responsesHeaders = ['Timestamp', 'Email Address', 'F3 Name', 'WHAT is your Go30 Challenge?', 'Team'];
  const formSubmitSheet = {
    _headers: { TIMESTAMP: 0, EMAIL: 1, F3_NAME: 2, TEAM: 3, WHAT: 4 },
    getLastColumn: function() { return formHeaders.length; },
    getRange: function() { return { getValues: function() { return [formHeaders]; } }; }
  };
  const responsesSheet = {
    _headers: { TIMESTAMP: 0, EMAIL: 1, F3_NAME: 2, WHAT: 3, TEAM: 4 },
    getLastColumn: function() { return responsesHeaders.length; },
    getRange: function() { return { getValues: function() { return [responsesHeaders]; } }; },
    appendRow: function(row) { appended.push(row); },
    getLastRow: function() { return 3; }
  };

  const formRow   = ['2026-06-25', 'anchor@example.com', 'Anchor', 'AO-Team', 'My Challenge'];
  const formCols  = { TIMESTAMP: 0, EMAIL: 1, F3_NAME: 2, TEAM: 3, WHAT: 4 };

  const rowNum = appendToResponsesSheet_(responsesSheet, formRow, formCols);
  assert.equal(rowNum, 3, 'returns appended row number');
  assert.equal(appended.length, 1, 'appendRow called once');
  assert.equal(appended[0][2], 'Anchor',          'F3_NAME mapped to Responses col 2');
  assert.equal(appended[0][3], 'My Challenge',     'WHAT mapped to Responses col 3');
  assert.equal(appended[0][4], 'AO-Team',          'TEAM mapped to Responses col 4');
}

console.log('test_add_response_on_submit.js: PASS');
