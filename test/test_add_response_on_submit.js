const assert = require('node:assert/strict');

// GAS global stubs — must be set before require.
global.Logger = { log: function() {} };
global.GasLogger = { log: function() {}, init: function() {}, flush: function() {} };
global.SpreadsheetApp = {};
global.ScriptApp = {};
global.runWithLock = function(fn) { fn(); return true; };
global.getResponseValue_ = function(row, cols, key) { return row[cols[key]] || ''; };
global.resolveResponseColumns = function(sheet) { return {}; };
global.maybeReuseLastMonthsGoals_ = function(ss, respSheet, rowNum, responses) { return responses; };
global.logActivity = function() {};

const { findDuplicateResponseRows_ } = require('../script/addResponseOnSubmit.js');

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

console.log('test_add_response_on_submit.js: PASS');
