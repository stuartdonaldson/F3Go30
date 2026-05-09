const assert = require('node:assert/strict');

// GAS global mocks — must be set before require so the module sees them.
let mailsSent = [];
global.Logger = { log: function() {} };
global.MailApp = { sendEmail: function(to, subj, body) { mailsSent.push({ to, subj, body }); } };
global.FormApp = { ItemType: { TEXT: 0, PARAGRAPH_TEXT: 1, MULTIPLE_CHOICE: 2, LIST: 3 } };
global.SpreadsheetApp = {
    openById: function() { return global._mockPrevSs || null; },
    openByUrl: function() { return global._mockPrevSs || null; }
};
global.getConfigValue_ = function(ss, key) { return (global._mockConfig && global._mockConfig[key]) || null; };
global.SpreadsheetManager = function(ss) {
    this.openExistingSheet = function() {
        if (global._mockManagedSheet) return global._mockManagedSheet;
        throw new Error('No mock ManagedSheet configured');
    };
};

const {
    isReuseLastMonthsGoalsChoice,
    checkIsReuseChoice_,
    resolveResponseColumns,
    findLatestResponseByEmail,
    extractReusableResponseValues,
    mergeReusedValuesIntoResponseArray,
    buildReuseSummaryLines,
    maybeReuseLastMonthsGoals_
} = require('../script/signupReuse.js');

// Header row matching RESPONSE_COLUMN_MAP order (Timestamp is not in the map but present in real data).
const HEADERS = [
    'Timestamp',
    'Email Address',
    'Are you currently participating in Go30?',
    'F3 Name',
    'Team preference',
    'Team',
    'Goal selection',
    'WHO do you ultimately want to become?',
    'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?',
    'Cell Phone Number'
];

const responseColumns = resolveResponseColumns(HEADERS);

// Verify key positions match expected layout.
assert.equal(responseColumns.EMAIL, 1);
assert.equal(responseColumns.PARTICIPATION, 2);
assert.equal(responseColumns.F3_NAME, 3);
assert.equal(responseColumns.TEAM_PREFERENCE, 4);
assert.equal(responseColumns.TEAM, 5);

// -- resolveResponseColumns: alias resolution for older tracker header phrasings --
const LEGACY_HEADERS = [
    'Timestamp',
    'Email Address',
    'Are you currently participating in Go30?',
    'F3 Name',
    'Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?',
    'Team',
    'What is your goal?',
    'WHO do you ultimately want to become?',
    'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?',
    'Cell Phone Number'
];
const legacyCols = resolveResponseColumns(LEGACY_HEADERS);
assert.equal(legacyCols.GOAL_SELECTION, 6, 'GOAL_SELECTION resolved via alias "What is your goal?"');
assert.equal(legacyCols.TEAM_PREFERENCE, 4, 'TEAM_PREFERENCE resolved via alias (long AO-based question)');
assert.equal(legacyCols.TEAM, 5, 'TEAM still resolved in legacy layout');

// -- isReuseLastMonthsGoalsChoice --
assert.equal(isReuseLastMonthsGoalsChoice("Yes, and use last month's goals."), true);
assert.equal(isReuseLastMonthsGoalsChoice(" yes, and use last month's goals. "), true);
assert.equal(isReuseLastMonthsGoalsChoice('Yes'), false);
assert.equal(isReuseLastMonthsGoalsChoice('No'), false);

// -- checkIsReuseChoice_ --
assert.equal(checkIsReuseChoice_("Yes, reuse my goals.", "Yes, reuse my goals."), true, 'exact phrase match');
assert.equal(checkIsReuseChoice_("YES, REUSE MY GOALS.", "yes, reuse my goals."), true, 'case-insensitive match');
assert.equal(checkIsReuseChoice_("Yes, reuse my goals.", "different phrase"), false, 'wrong phrase');
assert.equal(checkIsReuseChoice_("Yes, and use last month's goals.", null), true, 'null phrase falls back to regex');
assert.equal(checkIsReuseChoice_("Yes", ''), false, 'empty phrase falls back to regex (no match)');

// -- test rows (column layout matches HEADERS above) --
const rows = [
    ['2026-03-01 08:00:00', 'pax@example.com', 'Yes', 'Anchor', 'AO-based', 'Team A', 'Strength', 'Leader', 'Run', 'Plan', '555-1111'],
    ['2026-03-02 08:00:00', 'other@example.com', 'No', 'Other', '', '', '', '', '', '', ''],
    ['2026-03-03 08:00:00', 'PAX@example.com', 'Yes', 'Anchor', 'goal-based', 'Team B', 'Endurance', 'Disciplined', 'Ruck', 'Journal', '555-2222'],
];

// -- findLatestResponseByEmail --
const latest = findLatestResponseByEmail(rows, 'pax@example.com', responseColumns);
assert.ok(latest);
assert.equal(latest.rowIndex, 2, 'finds last row for email (case-insensitive)');
assert.equal(latest.row[responseColumns.TEAM], 'Team B');

assert.equal(findLatestResponseByEmail(rows, 'missing@example.com', responseColumns), null);

assert.throws(
    () => findLatestResponseByEmail(rows, 'pax@example.com', null),
    /responseColumns required/,
    'throws when responseColumns omitted'
);

// -- extractReusableResponseValues --
const reusedValues = extractReusableResponseValues(latest.row, responseColumns);
assert.deepEqual(reusedValues, {
    teamPreference: 'goal-based',
    team: 'Team B',
    goalSelection: 'Endurance',
    who: 'Disciplined',
    what: 'Ruck',
    how: 'Journal',
    phone: '555-2222',
});

assert.throws(
    () => extractReusableResponseValues(latest.row, null),
    /responseColumns required/
);

// -- mergeReusedValuesIntoResponseArray --
const blankRow = ['2026-04-01 08:00:00', 'pax@example.com', "Yes, and use last month's goals.", 'Anchor', '', '', '', '', '', '', ''];
const merged = mergeReusedValuesIntoResponseArray([...blankRow], reusedValues, responseColumns);

assert.deepEqual(merged.slice(4, 11), ['goal-based', 'Team B', 'Endurance', 'Disciplined', 'Ruck', 'Journal', '555-2222']);

assert.throws(
    () => mergeReusedValuesIntoResponseArray([...blankRow], reusedValues, null),
    /responseColumns required/
);

// -- buildReuseSummaryLines --
assert.deepEqual(buildReuseSummaryLines(reusedValues), [
    'Team preference: goal-based',
    'Team: Team B',
    'Goal selection: Endurance',
    'Who: Disciplined',
    'What: Ruck',
    'How: Journal',
    'Phone: 555-2222',
]);

assert.deepEqual(buildReuseSummaryLines({ teamPreference: '', team: 'T', goalSelection: '', who: '', what: '', how: '', phone: '' }), ['Team: T'], 'omits empty fields');

// -- maybeReuseLastMonthsGoals_ --

function makeMockResponsesSheet(headersRow) {
    return {
        getLastColumn: function() { return headersRow.length; },
        getRange: function() {
            return {
                getValues: function() { return [headersRow]; },
                setValues: function(vals) {}
            };
        }
    };
}

function makeMockSs(configMap) {
    global._mockConfig = configMap || {};
    return {
        getFormUrl: function() { return null; },
        getSheetByName: function() { return null; },
        getUrl: function() { return 'https://mock-ss.example.com'; }
    };
}

const REUSE_ANSWER = "Yes, and use last month's goals.";
const reusableFormRow = () => ['ts', 'a@example.com', REUSE_ANSWER, 'TestPax', '', '', '', '', '', '', ''];
const nonReuseFormRow = () => ['ts', 'a@example.com', 'No', 'TestPax', '', '', '', '', '', '', ''];

// Test: non-reuse PARTICIPATION answer → returns formResponses unchanged, no email
{
    mailsSent = [];
    const formRow = nonReuseFormRow();
    const result = maybeReuseLastMonthsGoals_(makeMockSs(), makeMockResponsesSheet(HEADERS), 2, formRow);
    assert.deepEqual(result, formRow, 'non-reuse choice: formResponses unchanged');
    assert.equal(mailsSent.length, 0, 'non-reuse choice: no email sent');
}

// Test: reuse choice, 'Last Month Tracker' absent → sends no-reuse email, returns formResponses unchanged
{
    mailsSent = [];
    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs({ 'Last Month Tracker': null }),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );
    assert.deepEqual(result, formRow, 'no tracker config: formResponses unchanged');
    assert.equal(mailsSent.length, 1, 'no tracker config: one email sent');
    assert.ok(!mailsSent[0].subj.includes('reused'), 'no tracker config: email signals no-reuse');
}

// Test: reuse choice, prior tracker found → merges values, sends reuse email
{
    mailsSent = [];
    global._mockPrevSs = {};
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{ EMAIL: 'a@example.com', TEAM_PREFERENCE: 'AO-based', TEAM: 'Team C', GOAL_SELECTION: 'Strength', WHO: 'Leader', WHAT: 'Run hard', HOW: 'Track daily', PHONE: '555-9999' }];
        }
    };

    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs({ 'Last Month Tracker': { primary: 'https://docs.google.com/spreadsheets/d/abc123/edit' } }),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );

    assert.equal(result[responseColumns.TEAM_PREFERENCE], 'AO-based', 'teamPreference merged');
    assert.equal(result[responseColumns.TEAM], 'Team C', 'team merged');
    assert.equal(result[responseColumns.GOAL_SELECTION], 'Strength', 'goalSelection merged');
    assert.equal(result[responseColumns.WHO], 'Leader', 'who merged');
    assert.equal(result[responseColumns.WHAT], 'Run hard', 'what merged');
    assert.equal(result[responseColumns.HOW], 'Track daily', 'how merged');
    assert.equal(result[responseColumns.PHONE], '555-9999', 'phone merged');
    assert.equal(mailsSent.length, 1, 'exactly one email sent');
    assert.ok(mailsSent[0].subj.includes('reused'), 'email signals goals reused');

    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

// Test: reuse choice, email not found in prior tracker → sends no-reuse email
{
    mailsSent = [];
    global._mockPrevSs = {};
    global._mockManagedSheet = {
        getAllRows: function() { return []; }
    };

    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs({ 'Last Month Tracker': { primary: 'https://docs.google.com/spreadsheets/d/abc123/edit' } }),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );

    assert.deepEqual(result, formRow, 'not-found: formResponses unchanged');
    assert.equal(mailsSent.length, 1, 'not-found: one email');
    assert.ok(!mailsSent[0].subj.includes('reused'), 'not-found: email signals no-reuse');

    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

console.log('test_signup_reuse.js: PASS');
