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

// Helper: build emailValues as getRange().getValues() returns — array of [email] rows.
function emailCol(emails) {
  return emails.map(function(e) { return [e]; });
}

// --- findDuplicateResponseRows_ ---

// No prior rows → nothing to delete
{
  const emails = emailCol(['a@example.com']); // only row 2 = submitted
  const result = findDuplicateResponseRows_(emails, 2, 'a@example.com');
  assert.deepEqual(result, [], 'single row: nothing to delete');
}

// One prior row for same email below submitted row
{
  const emails = emailCol(['a@example.com', 'b@example.com', 'a@example.com']); // rows 2,3,4; submitted=4
  const result = findDuplicateResponseRows_(emails, 4, 'a@example.com');
  assert.deepEqual(result, [2], 'one prior row: returns its row number');
}

// Two prior rows for same email, submitted is last
{
  const emails = emailCol(['a@example.com', 'b@example.com', 'a@example.com', 'c@example.com', 'a@example.com']);
  // rows 2,3,4,5,6 — submitted=6, priors at 2 and 4
  const result = findDuplicateResponseRows_(emails, 6, 'a@example.com');
  assert.deepEqual(result, [4, 2], 'two prior rows: returned descending (delete highest first)');
}

// Email comparison is case-insensitive
{
  const emails = emailCol(['PAX@EXAMPLE.COM', 'other@example.com', 'pax@example.com']);
  const result = findDuplicateResponseRows_(emails, 4, 'pax@example.com');
  assert.deepEqual(result, [2], 'case-insensitive email match');
}

// Submitted row in the middle (unusual but handled)
{
  const emails = emailCol(['a@example.com', 'b@example.com', 'a@example.com', 'a@example.com']);
  // rows 2,3,4,5 — submitted=3 (hypothetical), priors at 2, laters at 4,5
  // Should delete all non-submitted matches regardless of position
  const result = findDuplicateResponseRows_(emails, 3, 'a@example.com');
  assert.deepEqual(result, [5, 4, 2], 'all non-submitted matching rows returned descending');
}

// No matching email → nothing to delete
{
  const emails = emailCol(['x@example.com', 'y@example.com', 'z@example.com']);
  const result = findDuplicateResponseRows_(emails, 4, 'a@example.com');
  assert.deepEqual(result, [], 'no match: empty result');
}

// Empty email address → nothing to delete
{
  const emails = emailCol(['a@example.com', 'a@example.com']);
  const result = findDuplicateResponseRows_(emails, 3, '');
  assert.deepEqual(result, [], 'empty email: nothing to delete');
}

// Whitespace-trimmed email match
{
  const emails = emailCol(['  a@example.com  ', 'a@example.com']);
  const result = findDuplicateResponseRows_(emails, 3, 'a@example.com');
  assert.deepEqual(result, [2], 'whitespace trimmed on stored email');
}

console.log('test_add_response_on_submit.js: PASS');
