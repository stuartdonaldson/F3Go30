const assert = require('node:assert/strict');

const {
  classifyTeam_,
  findSignupMatch_,
  findSignupMatchByF3NameOnly_,
  parseTeamListsFromListDbRows_,
  trackerHasF3Name_,
  findEmptyTrackerSlotIndex_,
  buildResponseRowFromForm_,
  parseLinksRows_,
  resolveSignupMonths_,
  selectTargetMonth_,
  handleSignupFeedback_,
} = require('../script/signupWebapp.js');

const { resolveResponseColumns } = require('../script/response_utils.js');

const AO_LIST = ['Ballard', 'Crucible', 'SOLO (no team)'];
const GOAL_LIST = ['No Complaining', 'No Sugar'];

// Branch 1 — AO match
assert.deepEqual(
  classifyTeam_('Ballard', AO_LIST, GOAL_LIST),
  { teamType: 'ao', team: 'Ballard' }
);

// Branch 1 — AO match is case-insensitive/trimmed, canonical casing from the list wins
assert.deepEqual(
  classifyTeam_('  crucible  ', AO_LIST, GOAL_LIST),
  { teamType: 'ao', team: 'Crucible' }
);

// Branch 2 — Goal match (only reached when not an AO match)
assert.deepEqual(
  classifyTeam_('No Sugar', AO_LIST, GOAL_LIST),
  { teamType: 'goal', team: 'No Sugar' }
);

// Branch 3 — Other fallback, stored value preserved verbatim (not trimmed/altered)
assert.deepEqual(
  classifyTeam_('My Custom Team', AO_LIST, GOAL_LIST),
  { teamType: 'other', team: 'My Custom Team' }
);

// Empty/blank input — no team selected at all
assert.deepEqual(
  classifyTeam_('', AO_LIST, GOAL_LIST),
  { teamType: '', team: '' }
);

// --- findSignupMatch_ — §6.1: F3 Name AND Email must both match (anti-enumeration) ---

const RESPONSE_COLUMNS = { F3_NAME: 0, EMAIL: 1 };
const ROWS = [
  ['Splinter', 'splinter@example.com'],
  ['Anchor', 'anchor@example.com'],
];

// Both match -> returns the row
assert.deepEqual(
  findSignupMatch_(ROWS, 'Splinter', 'splinter@example.com', RESPONSE_COLUMNS),
  { rowIndex: 0, row: ROWS[0] }
);

// Case-insensitive / trimmed on both fields
assert.deepEqual(
  findSignupMatch_(ROWS, '  SPLINTER  ', ' Splinter@Example.com ', RESPONSE_COLUMNS),
  { rowIndex: 0, row: ROWS[0] }
);

// F3 Name matches but email differs -> no match (do not leak partial match)
assert.equal(findSignupMatch_(ROWS, 'Splinter', 'someone-else@example.com', RESPONSE_COLUMNS), null);

// Email matches but F3 Name differs -> no match
assert.equal(findSignupMatch_(ROWS, 'NotSplinter', 'splinter@example.com', RESPONSE_COLUMNS), null);

// Neither matches -> no match
assert.equal(findSignupMatch_(ROWS, 'Nobody', 'nobody@example.com', RESPONSE_COLUMNS), null);

// --- parseTeamListsFromListDbRows_ — reads ListDB's 'AO Teams' / 'Goal Team' columns ---

const LISTDB_ROWS = [
  ['AO Teams', 'Goal Team'],
  ['Ballard', 'No Complaining'],
  ['Crucible', 'No Sugar'],
  ['Defiance', ''],
  ['Goal Based*', null],
];

assert.deepEqual(
  parseTeamListsFromListDbRows_(LISTDB_ROWS),
  {
    aoList: ['Ballard', 'Crucible', 'Defiance', 'Goal Based*'],
    goalList: ['No Complaining', 'No Sugar'],
  }
);

// Header-only / empty sheet -> empty lists, not a crash
assert.deepEqual(
  parseTeamListsFromListDbRows_([['AO Teams', 'Goal Team']]),
  { aoList: [], goalList: [] }
);

// --- trackerHasF3Name_ — case-insensitive, trim-normalised dedup (signupWebapp.js §8, §11) ---

const TRACKER_NAME_ROWS = [['Splinter'], ['Anchor'], ['']];

assert.equal(trackerHasF3Name_(TRACKER_NAME_ROWS, 'Splinter'), true);
assert.equal(trackerHasF3Name_(TRACKER_NAME_ROWS, 'splinter'), true);   // case-insensitive
assert.equal(trackerHasF3Name_(TRACKER_NAME_ROWS, ' Splinter '), true); // trim-normalised
assert.equal(trackerHasF3Name_(TRACKER_NAME_ROWS, 'Nobody'), false);

// --- findEmptyTrackerSlotIndex_ — fills initSheets' blank row-4 template row instead of
// skipping past it (F3Go30 implementation miss: webapp save left row 4 permanently blank) ---

assert.equal(findEmptyTrackerSlotIndex_([['']]), 0, 'fresh tracker — row 4 itself is the empty slot');
assert.equal(findEmptyTrackerSlotIndex_(TRACKER_NAME_ROWS), 2, 'first blank slot among occupied rows');
assert.equal(findEmptyTrackerSlotIndex_([['Splinter'], ['Anchor']]), -1, 'no empty slot — caller must append');
assert.equal(findEmptyTrackerSlotIndex_([]), -1);

// --- buildResponseRowFromForm_ — maps webapp form fields into a Responses row array ---

const FULL_HEADERS = [
  'Timestamp', 'Email Address', 'Are you currently participating in Go30?', 'F3 Name',
  'Team type', 'Team', 'Goal or other team name', 'WHO do you ultimately want to become?',
  'WHAT is your Go30 Challenge?', 'HOW are you going to be successful this month?',
  'Cell Phone Number', 'NAG email?', 'Constructive Comments',
];
const FULL_COLUMNS = resolveResponseColumns(FULL_HEADERS);

// --- findSignupMatchByF3NameOnly_ — detects an email change (ADR-008: keyed on F3 Name so a
// PAX can change their email) so handleSignupSave_ can retire the old row instead of leaving
// it sitting as an active duplicate alongside the new one ---

function buildFullRow(overrides) {
  var row = new Array(FULL_HEADERS.length).fill('');
  Object.keys(overrides || {}).forEach(function(key) { row[FULL_COLUMNS[key]] = overrides[key]; });
  return row;
}

const EMAIL_CHANGE_ROWS = [
  buildFullRow({ F3_NAME: 'Splinter', EMAIL: 'old@example.com', PARTICIPATION: 'Yes' }),
  buildFullRow({ F3_NAME: 'Anchor', EMAIL: 'anchor@example.com', PARTICIPATION: 'Yes' }),
  buildFullRow({ F3_NAME: 'Sapper', EMAIL: 'sapper-old@example.com', PARTICIPATION: 'DELETED' }),
];

const emailChangeMatch = findSignupMatchByF3NameOnly_(EMAIL_CHANGE_ROWS, 'Splinter', FULL_COLUMNS);
assert.equal(emailChangeMatch.rowIndex, 0);
assert.equal(findSignupMatchByF3NameOnly_(EMAIL_CHANGE_ROWS, 'splinter', FULL_COLUMNS).rowIndex, 0, 'case-insensitive');
assert.equal(findSignupMatchByF3NameOnly_(EMAIL_CHANGE_ROWS, 'Sapper', FULL_COLUMNS), null, 'a DELETED row is never matched');
assert.equal(findSignupMatchByF3NameOnly_(EMAIL_CHANGE_ROWS, 'Nobody', FULL_COLUMNS), null);

const AO_FORM_DATA = {
  participation: 'Yes',
  f3Name: 'Splinter', email: 'splinter@example.com',
  teamType: 'ao', team: 'Crucible',
  who: 'A leader', what: 'A challenge', how: 'Daily effort', phone: '555-1234', nag: true,
};

// New row (no existing row) — AO-based: TEAM holds the AO name, OTHER_TEAM blank
const newRow = buildResponseRowFromForm_(null, FULL_COLUMNS, AO_FORM_DATA).row;
assert.equal(newRow[FULL_COLUMNS.PARTICIPATION], 'Yes');
assert.equal(newRow[FULL_COLUMNS.F3_NAME], 'Splinter');
assert.equal(newRow[FULL_COLUMNS.EMAIL], 'splinter@example.com');
assert.equal(newRow[FULL_COLUMNS.TEAM_TYPE], 'AO-based');
assert.equal(newRow[FULL_COLUMNS.TEAM], 'Crucible');
assert.equal(newRow[FULL_COLUMNS.OTHER_TEAM], '');
assert.equal(newRow[FULL_COLUMNS.WHO], 'A leader');
assert.equal(newRow[FULL_COLUMNS.WHAT], 'A challenge');
assert.equal(newRow[FULL_COLUMNS.HOW], 'Daily effort');
assert.equal(newRow[FULL_COLUMNS.PHONE], '555-1234');
assert.equal(newRow[FULL_COLUMNS.NAG_EMAIL], 'Yes');

// Other-based: team value goes into both TEAM and OTHER_TEAM (Phase 3 promotion)
const otherRow = buildResponseRowFromForm_(null, FULL_COLUMNS, {
  ...AO_FORM_DATA, teamType: 'other', team: 'My Custom Team',
}).row;
assert.equal(otherRow[FULL_COLUMNS.TEAM_TYPE], 'Other');
assert.equal(otherRow[FULL_COLUMNS.TEAM], 'My Custom Team');
assert.equal(otherRow[FULL_COLUMNS.OTHER_TEAM], 'My Custom Team');

// Update in place — existing row's untouched columns (e.g. Timestamp at index 0) are preserved
const existingRow = ['2026-01-01 00:00:00', 'old@example.com', 'Yes', 'Splinter', 'Other', '', 'Old Team', 'old who', 'old what', 'old how', '111', 'No', 'old comment'];
const updatedRow = buildResponseRowFromForm_(existingRow, FULL_COLUMNS, AO_FORM_DATA).row;
assert.equal(updatedRow[0], '2026-01-01 00:00:00', 'untouched/unmapped column preserved');
assert.equal(updatedRow[FULL_COLUMNS.TEAM], 'Crucible', 'team overwritten');
assert.equal(updatedRow[FULL_COLUMNS.NAG_EMAIL], 'Yes', 'nag overwritten');

// Partial update (feedback-only call) — fields absent from formData must be left untouched,
// not blanked. This is what handleSignupFeedback_ relies on: it only ever sends
// {feedbackRating, feedbackComment}, never re-sends f3Name/team/who/etc.
const feedbackOnlyRow = buildResponseRowFromForm_(existingRow, FULL_COLUMNS, {
  feedbackRating: 4, feedbackComment: 'Loved it',
}).row;
assert.equal(feedbackOnlyRow[FULL_COLUMNS.F3_NAME], 'Splinter', 'F3 Name untouched by partial update');
assert.equal(feedbackOnlyRow[FULL_COLUMNS.TEAM_TYPE], 'Other', 'Team type untouched by partial update');
assert.equal(feedbackOnlyRow[FULL_COLUMNS.WHO], 'old who', 'WHO untouched by partial update');
assert.equal(feedbackOnlyRow[FULL_COLUMNS.NAG_EMAIL], 'No', 'NAG untouched by partial update');
assert.equal(feedbackOnlyRow[FULL_COLUMNS.FEEDBACK_COMMENT], 'Loved it', 'feedback comment applied');

// Feedback fields are skipped gracefully when the sheet has no Feedback Rating column — but
// the skip is reported, not silently dropped (F3Go30 implementation-miss fix). The caller
// (buildResponseRowWithSelfHeal_, GAS-only) is responsible for warning + self-healing.
assert.equal(FULL_COLUMNS.FEEDBACK_RATING, undefined);
const noFeedbackColumnResult = buildResponseRowFromForm_(null, FULL_COLUMNS, {
  ...AO_FORM_DATA, feedbackRating: 5, feedbackComment: 'Great program',
});
assert.equal(noFeedbackColumnResult.row[FULL_COLUMNS.FEEDBACK_COMMENT], 'Great program'); // comment column exists
assert.equal(noFeedbackColumnResult.row.length, FULL_HEADERS.length); // no extra column appended for the missing rating
assert.deepEqual(noFeedbackColumnResult.skippedFields, ['FEEDBACK_RATING']);

// The success case (column present) reports no skips.
const FULL_COLUMNS_WITH_RATING = resolveResponseColumns(FULL_HEADERS.concat('Feedback Rating'));
const withRatingResult = buildResponseRowFromForm_(null, FULL_COLUMNS_WITH_RATING, {
  ...AO_FORM_DATA, feedbackRating: 5, feedbackComment: 'Great program',
});
assert.deepEqual(withRatingResult.skippedFields, []);
assert.equal(withRatingResult.row[FULL_COLUMNS_WITH_RATING.FEEDBACK_RATING], 5);

// --- parseLinksRows_ / resolveSignupMonths_ — §6.3 current/next month resolution from Links ---

const LINKS_VALUES = [
  ['Date', 'StartDate', 'SpreadsheetName', 'ShortTracker', 'TrackerURL', 'ShortHC', 'HC URL', 'SheetId', 'FormId'],
  [new Date(2026, 3, 1), new Date(2026, 3, 1), '2026-04 F3 Go30', null, null, null, null, 'sheet-april', 'form-april'],
  [new Date(2026, 4, 4), new Date(2026, 4, 1), '2026-05-F3 Go30', null, null, null, null, 'sheet-may', 'form-may'],
  [new Date(2026, 4, 31), new Date(2026, 5, 1), '2026-06-F3-Go30a', null, null, null, null, 'sheet-june', 'form-june'],
  [new Date(2026, 5, 20), new Date(2026, 6, 1), '2026-07-F3-Go30a', null, null, null, null, 'sheet-july-v1', 'form-july-v1'],
  // Duplicate StartDate for July (re-run) — the later `Date` should win per row.
  [new Date(2026, 5, 22), new Date(2026, 6, 1), '2026-07-F3-Go30a', null, null, null, null, 'sheet-july-v2', 'form-july-v2'],
];

const parsedLinks = parseLinksRows_(LINKS_VALUES);
assert.equal(parsedLinks.length, 5);

const today = new Date(2026, 5, 24); // June 24, 2026
const months = resolveSignupMonths_(parsedLinks, today);

assert.equal(months.current.sheetId, 'sheet-june');
assert.equal(months.current.label, 'June 2026');
assert.ok(months.next, 'next month exists in fixture');
assert.equal(months.next.sheetId, 'sheet-july-v2', 'duplicate StartDate resolved to the latest Date');
assert.equal(months.next.label, 'July 2026');

// No next-month Links row yet -> next is null, not an error
const onlyThroughJune = parseLinksRows_(LINKS_VALUES.slice(0, 4));
const monthsNoNext = resolveSignupMonths_(onlyThroughJune, today);
assert.equal(monthsNoNext.current.sheetId, 'sheet-june');
assert.equal(monthsNoNext.next, null);

// No smokeTrackerId passed -> smoke is null, current/next unaffected (default behavior)
assert.equal(months.smoke, null);

// --- resolveSignupMonths_ smoke exclusion — a smoke tracker is created with the same
// StartDate a real tracker for that month would use (docs/OPERATIONS.md §Smoke Mode), so it
// must never win the "latest Date wins" tie-break for current/next, only be reachable via its
// own `smoke` slot. ---

// Smoke shares July's StartDate with the real 'sheet-july-v2' row, and was written later
// (Date 2026-06-25 > 2026-06-22) — without exclusion it would silently hijack 'next'.
const LINKS_WITH_SMOKE = LINKS_VALUES.concat([
  [new Date(2026, 5, 25), new Date(2026, 6, 1), '2026-07-F3-Go30a (Smoke)', null, null, null, null, 'sheet-smoke', 'form-smoke'],
]);
const parsedWithSmoke = parseLinksRows_(LINKS_WITH_SMOKE);
const monthsWithSmoke = resolveSignupMonths_(parsedWithSmoke, today, 'sheet-smoke');
assert.equal(monthsWithSmoke.current.sheetId, 'sheet-june', 'smoke exclusion does not disturb current');
assert.equal(monthsWithSmoke.next.sheetId, 'sheet-july-v2', 'smoke never wins the next-month tie-break');
assert.equal(monthsWithSmoke.smoke.sheetId, 'sheet-smoke', 'smoke is reachable via its own slot');

// Without a smokeTrackerId, the same fixture reproduces the hijack this exclusion prevents —
// documents the bug this fix closes, not just the fix itself.
const monthsWithoutExclusion = resolveSignupMonths_(parsedWithSmoke, today);
assert.equal(monthsWithoutExclusion.next.sheetId, 'sheet-smoke', 'no smokeTrackerId: smoke wins the tie-break (the bug)');

// If SMOKE_MODE isn't active, resolveSignupMonths_ is never called with a smokeTrackerId at
// all (getCurrentAndNextMonths_ passes null), and smoke stays completely absent — same as
// today's behavior for every deployment that isn't mid-smoke-test.
assert.equal(resolveSignupMonths_(parsedWithSmoke, today, null).smoke, null);

// --- selectTargetMonth_ — the shared 'current'|'next'|'smoke' selector signup and checkin
// action handlers both use. ---
assert.equal(selectTargetMonth_(monthsWithSmoke, undefined), monthsWithSmoke.current, 'default is current');
assert.equal(selectTargetMonth_(monthsWithSmoke, 'current'), monthsWithSmoke.current);
assert.equal(selectTargetMonth_(monthsWithSmoke, 'next'), monthsWithSmoke.next);
assert.equal(selectTargetMonth_(monthsWithSmoke, 'smoke'), monthsWithSmoke.smoke);

// --- handleSignupFeedback_ — blank rating + blank comment must not touch the sheet at all,
// since writing them would overwrite feedback already on file. The guard runs before any
// SpreadsheetApp call, so passing null as the spreadsheet proves nothing was touched. ---

assert.deepEqual(handleSignupFeedback_(null, { feedbackRating: 0, feedbackComment: '' }), { ok: true, skipped: true });
assert.deepEqual(handleSignupFeedback_(null, { feedbackRating: 0, feedbackComment: '   ' }), { ok: true, skipped: true }, 'whitespace-only comment counts as blank');
assert.deepEqual(handleSignupFeedback_(null, {}), { ok: true, skipped: true }, 'fields entirely absent counts as blank');

console.log('test_signup_webapp.js: PASS');
