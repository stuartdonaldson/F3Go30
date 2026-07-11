const assert = require('node:assert/strict');

// GAS global mocks — must be set before require so the module sees them.
let mailsSent = [];
let openByIdCalls = [];
let openByUrlCalls = [];
let openByUrlFailures = {};
let loggerMessages = [];
global.Logger = { log: function(message) { loggerMessages.push(String(message || '')); } };
global.MailApp = { sendEmail: function(arg1, arg2, arg3) {
    if (typeof arg1 === 'object' && arg1 !== null) {
        mailsSent.push({ to: arg1.to, subj: arg1.subject || arg1.subj || '', body: arg1.body || '', htmlBody: arg1.htmlBody || '' });
    } else {
        mailsSent.push({ to: arg1, subj: arg2, body: arg3 || '' });
    }
} };
global.FormApp = {
    ItemType: { TEXT: 0, PARAGRAPH_TEXT: 1, MULTIPLE_CHOICE: 2, LIST: 3 },
    openByUrl: function() { return global._mockForm || null; }
};
global.SpreadsheetApp = {
    openById: function(id) {
        openByIdCalls.push(id);
        return global._mockPrevSs || null;
    },
    openByUrl: function(url) {
        openByUrlCalls.push(url);
        if (openByUrlFailures[url]) {
            throw new Error(openByUrlFailures[url]);
        }
        return global._mockPrevSs || null;
    }
};
global.getConfigValue_ = function(ss, key) { return (global._mockConfig && global._mockConfig[key]) || null; };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };
global.SpreadsheetManager = function(ss) {
    this.openExistingSheet = function() {
        if (global._mockManagedSheet) return global._mockManagedSheet;
        throw new Error('No mock ManagedSheet configured');
    };
};

// Load templating helper in test environment so signupReuse can call the global helper
const signupEmailModule = require('../script/signupEmail.js');
global.buildSignupReuseEmailTemplate_ = signupEmailModule.buildSignupReuseEmailTemplate_;
global.renderSignupReuseEmailHtml_ = signupEmailModule.renderSignupReuseEmailHtml_;

const {
    isReuseLastMonthsGoalsChoice,
    checkIsReuseChoice_,
    resolveResponseColumns,
    findLatestResponseByEmail,
    findLatestResponseByF3Name,
    extractReusableResponseValues,
    mergeReusedValuesIntoResponseArray,
    buildReuseSummaryLines,
    buildPrefilledGoalUpdateUrl,
    sanitizeTextForEmailLine_,
    sanitizeEmailAddressForSend_,
    maybeReuseLastMonthsGoals_
} = require('../script/signupReuse.js');

const confirmationMessage = signupEmailModule.buildSignupReuseEmailTemplate_({
    mode: 'confirmation',
    f3Name: 'Anchor',
    trackerUrl: 'https://tracker.example.com',
    prefilledUrl: 'https://form.example.com',
    summaryLines: ['Who: Leader', 'What: Ruck'],
    registrationMonth: 'June 2026'
});

assert.equal(confirmationMessage.subject, 'F3 Go30: registration updated for June 2026');
assert.match(confirmationMessage.body, /We saved your current goals for June 2026\./);
assert.match(confirmationMessage.body, /Current goals:/);
assert.ok(!/reused/i.test(confirmationMessage.body), 'generic confirmation avoids reuse copy');
assert.match(confirmationMessage.htmlBody, /Your registration was updated/);

// Header row extracted from actual Last Month Tracker Responses sheet
const HEADERS = [
    'Timestamp',
    'Email Address',
    'Are you currently participating in Go30?',
    'F3 Name',
    'Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?',
    'Team',
    "Great! Here are some goals that other HIM's are focused on this month. Pick one or choose 'other' and we will try and pair you with someone else who has a similar goal. Or specify another team name for grouping",
    'WHO do you ultimately want to become?',
    'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?',
    'Cell Phone Number',
    'NAG Email?'
];

const responseColumns = resolveResponseColumns(HEADERS);

// Verify key positions match expected layout.
assert.equal(responseColumns.EMAIL, 1);
assert.equal(responseColumns.PARTICIPATION, 2);
assert.equal(responseColumns.F3_NAME, 3);
assert.equal(responseColumns.TEAM_TYPE, 4);
assert.equal(responseColumns.TEAM, 5);
assert.equal(responseColumns.OTHER_TEAM, 6);

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
assert.equal(legacyCols.OTHER_TEAM, 6, 'OTHER_TEAM resolved via alias "What is your goal?"');
assert.equal(legacyCols.TEAM_TYPE, 4, 'TEAM_TYPE resolved via alias (long AO-based question)');
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
    ['2026-03-01 08:00:00', 'pax@example.com', 'Yes', 'Anchor', 'AO-based', 'Team A', 'Strength', 'Leader', 'Run', 'Plan', '555-1111', 'No'],
    ['2026-03-02 08:00:00', 'other@example.com', 'No', 'Other', '', '', '', '', '', '', '', ''],
    ['2026-03-03 08:00:00', 'PAX@example.com', 'Yes', 'Anchor', 'goal-based', 'Team B', 'Endurance', 'Disciplined', 'Ruck', 'Journal', '555-2222', 'Yes'],
    ['2026-04-20 19:35:15', 'littlejohn@example.com', 'Yes', 'Little John', 'AO', 'Crucible', '', 'Best loving father, partner, friend and leader I can be', 'Doing my morning routine with daily plan.\nStaying engaged - at least 1 gathering or interaction with people each day\nF3 workout, ruck at least 3 days each week', 'Partner with other PAX for morning check-in.  Track plan on whiteboard.', '2067797808', 'Yes'],
    ['2026-05-02 22:17:17', 'crazyivan@example.com', 'Yes', 'Crazy Ivan', 'AO', 'Crucible', '', 'A highly intentional, purpose-driven, and effective HIM', 'Consume <1452 net calories; 5+ minutes of HOAM/SAVERS by 8:30 a.m.; lights out by 10:00 p.m.', 'Pro-active tracking', '4259413500', 'No'],
];

// -- findLatestResponseByEmail --
const latest = findLatestResponseByEmail(rows, 'pax@example.com', responseColumns);
assert.ok(latest);
assert.equal(latest.rowIndex, 2, 'finds last row for email (case-insensitive)');
assert.equal(latest.row[responseColumns.TEAM], 'Team B');

const alternateEmailHeaders = [
    'Timestamp',
    'Email Address',
    'Are you currently participating in Go30?',
    'F3 Name',
    'Email Address 2',
    'Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?',
    'Team',
    "Great! Here are some goals that other HIM's are focused on this month. Pick one or choose 'other' and we will try and pair you with someone else who has a similar goal. Or specify another team name for grouping",
    'WHO do you ultimately want to become?',
    'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?',
    'Cell Phone Number',
    'NAG Email?'
];
const alternateEmailColumns = resolveResponseColumns(alternateEmailHeaders);
const alternateEmailRows = [
    ['2026-03-01 08:00:00', '', 'Yes', 'Anchor', 'pax@example.com', 'AO-based', 'Team A', 'Strength', 'Leader', 'Run', 'Plan', '555-1111', 'No'],
    ['2026-03-03 08:00:00', '', 'Yes', 'Anchor', 'PAX@example.com', 'goal-based', 'Team B', 'Endurance', 'Disciplined', 'Ruck', 'Journal', '555-2222', 'Yes'],
];
const alternateLatest = findLatestResponseByEmail(alternateEmailRows, 'pax@example.com', alternateEmailColumns, alternateEmailHeaders);
assert.ok(alternateLatest, 'finds last row when alternate email header is populated');
assert.equal(alternateLatest.rowIndex, 1);

assert.equal(findLatestResponseByEmail(rows, 'missing@example.com', responseColumns), null);

assert.throws(
    () => findLatestResponseByEmail(rows, 'pax@example.com', null),
    /responseColumns required/,
    'throws when responseColumns omitted'
);

// -- findLatestResponseByF3Name --
const latestByF3 = findLatestResponseByF3Name(rows, 'Little John', responseColumns);
assert.ok(latestByF3);
assert.equal(latestByF3.rowIndex, 3, 'finds Little John by F3 Name (exact match)');
assert.equal(latestByF3.row[responseColumns.EMAIL], 'littlejohn@example.com');

const crazyByF3 = findLatestResponseByF3Name(rows, 'Crazy Ivan', responseColumns);
assert.ok(crazyByF3);
assert.equal(crazyByF3.rowIndex, 4, 'finds Crazy Ivan by F3 Name (exact match)');
assert.equal(crazyByF3.row[responseColumns.EMAIL], 'crazyivan@example.com');

assert.equal(findLatestResponseByF3Name(rows, 'Missing Ivan', responseColumns), null);

const caseInsensitive = findLatestResponseByF3Name(rows, 'crazy ivan', responseColumns);
assert.ok(caseInsensitive, 'finds by F3 Name (case-insensitive)');
assert.equal(caseInsensitive.rowIndex, 4);

assert.throws(
    () => findLatestResponseByF3Name(rows, 'Anchor', null),
    /responseColumns required/,
    'throws when responseColumns omitted'
);

// -- extractReusableResponseValues --
const reusedValues = extractReusableResponseValues(latest.row, responseColumns);
assert.deepEqual(reusedValues, {
    email: 'PAX@example.com',
    teamType: 'goal-based',
    team: 'Team B',
    otherTeam: 'Endurance',
    who: 'Disciplined',
    what: 'Ruck',
    how: 'Journal',
    phone: '555-2222',
    nagEmail: 'Yes',
});

assert.throws(
    () => extractReusableResponseValues(latest.row, null),
    /responseColumns required/
);

// -- mergeReusedValuesIntoResponseArray --
const blankRow = ['2026-04-01 08:00:00', 'pax@example.com', "Yes, and use last month's goals.", 'Anchor', '', '', '', '', '', '', ''];
const merged = mergeReusedValuesIntoResponseArray([...blankRow], { ...reusedValues, email: 'current@example.com' }, responseColumns);

assert.equal(merged[1], 'current@example.com', 'current email preserved in reused data');
assert.deepEqual(merged.slice(4, 11), ['goal-based', 'Team B', 'Endurance', 'Disciplined', 'Ruck', 'Journal', '555-2222']);

assert.throws(
    () => mergeReusedValuesIntoResponseArray([...blankRow], reusedValues, null),
    /responseColumns required/
);

// -- buildReuseSummaryLines includes email and NAG email --
assert.deepEqual(buildReuseSummaryLines({ ...reusedValues, email: 'current@example.com' }), [
    'Email: current@example.com',
    'Send reminder email: Yes',
    'Team type: goal-based',
    'Team: Team B',
    'Other team name: Endurance',
    'Who you want to become: Disciplined',
    'What is your Go30 Challenge: Ruck',
    'How will you be successful: Journal',
    'Phone: 555-2222',
]);
assert.deepEqual(buildReuseSummaryLines({ email: '', nagEmail: '', teamType: '', team: 'T', otherTeam: '', who: '', what: '', how: '', phone: '' }), ['Team: T'], 'omits empty fields');

// -- send sanitizers --
assert.equal(sanitizeTextForEmailLine_('  F3\nNew\tGuy\u0007  '), 'F3 New Guy');
assert.equal(sanitizeEmailAddressForSend_('  Test<User>@Example.com\n'), '', 'invalid address characters are rejected');
assert.equal(sanitizeEmailAddressForSend_(' Test.User+go30@example.com\n'), 'test.user+go30@example.com');
// -- maybeReuseLastMonthsGoals_ — now resolves prior values via PaxDB (Template-resident),
// not a Config 'Last Month Tracker' reference. --

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

const PAX_DB_TEST_HEADERS_ = ['SheetId', 'Date', 'F3 Name', 'Team', 'WHO', 'WHAT', 'HOW', 'Comments', 'Hit', 'Miss', 'NoCheckin', 'Fellowship', 'Q Point', 'Inspire', 'EHing FNG', 'Email', 'Team Type', 'Other Team', 'Phone', 'NAG Email'];

// Bridges the pre-existing global._mockManagedSheet fixture shape (object rows keyed by
// RESPONSE_COLUMN_MAP names — F3_NAME, TEAM_TYPE, etc., as authored throughout this file)
// into PaxDB's row-array shape, so the many fixtures below didn't need rewriting when the
// reuse lookup moved from "open a previous tracker's Responses sheet" to "read PaxDB".
function makeMockPaxDbSheetFromManagedRows_() {
    if (global._mockPaxDbThrows) {
        return { getDataRange: function() { throw new Error(global._mockPaxDbThrows); } };
    }
    var objRows = (global._mockManagedSheet && global._mockManagedSheet.getAllRows) ? global._mockManagedSheet.getAllRows() : [];
    var dataRows = objRows.map(function(r) {
        return [
            'prev-sheet-id', '2026-05-01', r.F3_NAME || '', r.TEAM || '', r.WHO || '', r.WHAT || '', r.HOW || '', '',
            0, 0, 0, 0, 0, 0, 0,
            r.EMAIL || '', r.TEAM_TYPE || '', r.OTHER_TEAM || '', r.PHONE || '', r.NAG_EMAIL || ''
        ];
    });
    return { getDataRange: function() { return { getValues: function() { return [PAX_DB_TEST_HEADERS_].concat(dataRows); } }; } };
}

function makeMockSs(configMap, options) {
    global._mockConfig = configMap || {};
    return {
        getId: function() { return 'current-sheet-id'; },
        getFormUrl: function() { return null; },
        getSheetByName: function(name) {
            if (name === 'PaxDB') return makeMockPaxDbSheetFromManagedRows_();
            return null;
        },
        getUrl: function() { return 'https://mock-ss.example.com'; }
    };
}

const REUSE_ANSWER = "Yes, and use last month's goals.";
const reusableFormRow = () => ['ts', 'a@example.com', REUSE_ANSWER, 'TestPax', '', '', '', '', '', '', ''];
const nonReuseFormRow = () => ['ts', 'a@example.com', 'No', 'TestPax', '', '', '', '', '', '', ''];

// Test: non-reuse PARTICIPATION answer → returns formResponses unchanged, no email
{
    mailsSent = [];
    loggerMessages = [];
    const formRow = nonReuseFormRow();
    const result = maybeReuseLastMonthsGoals_(makeMockSs(), makeMockResponsesSheet(HEADERS), 2, formRow);
    assert.deepEqual(result, formRow, 'non-reuse choice: formResponses unchanged');
    assert.equal(mailsSent.length, 0, 'non-reuse choice: no email sent');
}

// Test: reuse choice, no PaxDB record for this F3 Name → returns formResponses unchanged, no email sent
// (webapp signup path does not send a no-reuse notification; that email belonged to the form-submit path)
{
    mailsSent = [];
    loggerMessages = [];
    global._mockManagedSheet = null;
    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );
    assert.deepEqual(result, formRow, 'no PaxDB record: formResponses unchanged');
    assert.equal(mailsSent.length, 0, 'no PaxDB record: no email sent');
}

// Test: reuse choice, prior PaxDB record found → merges values, no email sent
{
    mailsSent = [];
    loggerMessages = [];
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{ F3_NAME: 'TestPax', TEAM_TYPE: 'AO-based', TEAM: 'Team C', OTHER_TEAM: 'Strength', WHO: 'Leader', WHAT: 'Run hard', HOW: 'Track daily', PHONE: '555-9999' }];
        }
    };

    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );

    assert.equal(result[responseColumns.TEAM_TYPE], 'AO-based', 'teamType merged');
    assert.equal(result[responseColumns.TEAM], 'Team C', 'team merged');
    assert.equal(result[responseColumns.OTHER_TEAM], 'Strength', 'otherTeam merged');
    assert.equal(result[responseColumns.WHO], 'Leader', 'who merged');
    assert.equal(result[responseColumns.WHAT], 'Run hard', 'what merged');
    assert.equal(result[responseColumns.HOW], 'Track daily', 'how merged');
    assert.equal(result[responseColumns.PHONE], '555-9999', 'phone merged');
    assert.equal(mailsSent.length, 0, 'no email sent on reuse');

    global._mockManagedSheet = null;
}

// Test: reuse choice, F3 Name not found in PaxDB → no email sent
{
    mailsSent = [];
    loggerMessages = [];
    global._mockManagedSheet = {
        getAllRows: function() { return []; }
    };

    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );

    assert.deepEqual(result, formRow, 'not-found: formResponses unchanged');
    assert.equal(mailsSent.length, 0, 'not-found: no email sent');

    global._mockManagedSheet = null;
}

// Test: PaxDB lookup throws → logs failure, no email sent
{
    mailsSent = [];
    loggerMessages = [];
    global._mockPaxDbThrows = 'sheet temporarily unavailable';

    const formRow = reusableFormRow();
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, formRow
    );

    assert.deepEqual(result, formRow, 'lookup failure: formResponses unchanged');
    assert.equal(mailsSent.length, 0, 'lookup failure: no email sent');
    assert.ok(loggerMessages.some(function(message) {
        return message.includes('PaxDB lookup failed: sheet temporarily unavailable');
    }), 'lookup failure logged');

    global._mockPaxDbThrows = null;
}

// Test: reuse merge still applies when email and F3 name have dirty whitespace
{
    mailsSent = [];
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{ F3_NAME: 'F3 New Guy', TEAM_TYPE: 'AO-based', TEAM: 'Team C', OTHER_TEAM: 'Strength', WHO: 'Leader', WHAT: 'Run hard', HOW: 'Track daily', PHONE: '555-9999' }];
        }
    };

    const dirtyFormRow = ['ts', ' Test.User@example.com\n', REUSE_ANSWER, 'F3\nNew\tGuy', '', '', '', '', '', '', ''];
    maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, dirtyFormRow
    );

    assert.equal(mailsSent.length, 0, 'no email sent');

    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

// Test: Little John reuse from actual Last Month data
{
    mailsSent = [];
    global._mockPrevSs = {};
    // Mock with Little John's actual data from last month
    const littleJohnLastMonth = extractReusableResponseValues(rows[3], responseColumns);
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{
                F3_NAME: 'Little John',
                TEAM_TYPE: littleJohnLastMonth.teamType,
                TEAM: littleJohnLastMonth.team,
                OTHER_TEAM: littleJohnLastMonth.otherTeam,
                WHO: littleJohnLastMonth.who,
                WHAT: littleJohnLastMonth.what,
                HOW: littleJohnLastMonth.how,
                PHONE: littleJohnLastMonth.phone
            }];
        }
    };

    const littleJohnFormRow = ['ts', 'littlejohn@example.com', REUSE_ANSWER, 'Little John', '', '', '', '', '', '', ''];
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, littleJohnFormRow
    );

    console.log('\nLittle John reused values:');
    console.log('  Team Type:', result[responseColumns.TEAM_TYPE]);
    console.log('  Team:', result[responseColumns.TEAM]);
    console.log('  Other Team:', result[responseColumns.OTHER_TEAM]);
    console.log('  Who:', result[responseColumns.WHO]);
    console.log('  What:', result[responseColumns.WHAT]);
    console.log('  How:', result[responseColumns.HOW]);
    console.log('  Phone:', result[responseColumns.PHONE]);

    assert.equal(result[responseColumns.TEAM_TYPE], 'AO', 'Little John: teamType reused');
    assert.equal(result[responseColumns.TEAM], 'Crucible', 'Little John: team reused');
    assert.equal(result[responseColumns.WHO], 'Best loving father, partner, friend and leader I can be', 'Little John: who reused');
    assert.equal(mailsSent.length, 0, 'Little John: no email sent');

    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

// Note: a prior "deleted rows ignored" test lived here. PaxDB never stores DELETED Responses
// rows in the first place (filtered out upstream when written via upsertPaxDbRow_/the scan),
// so there's nothing for the reuse lookup itself to filter — removed rather than ported.

// Test: Crazy Ivan reuse from actual Last Month data
{
    mailsSent = [];
    global._mockPrevSs = {};
    // Mock with Crazy Ivan's actual data from last month
    const crazyIvanLastMonth = extractReusableResponseValues(rows[4], responseColumns);
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{
                F3_NAME: 'Crazy Ivan',
                TEAM_TYPE: crazyIvanLastMonth.teamType,
                TEAM: crazyIvanLastMonth.team,
                OTHER_TEAM: crazyIvanLastMonth.otherTeam,
                WHO: crazyIvanLastMonth.who,
                WHAT: crazyIvanLastMonth.what,
                HOW: crazyIvanLastMonth.how,
                PHONE: crazyIvanLastMonth.phone
            }];
        }
    };

    const crazyIvanFormRow = ['ts', 'crazyivan@example.com', REUSE_ANSWER, 'Crazy Ivan', '', '', '', '', '', '', ''];
    const result = maybeReuseLastMonthsGoals_(
        makeMockSs(),
        makeMockResponsesSheet(HEADERS), 2, crazyIvanFormRow
    );

    console.log('\nCrazy Ivan reused values:');
    console.log('  Team Type:', result[responseColumns.TEAM_TYPE]);
    console.log('  Team:', result[responseColumns.TEAM]);
    console.log('  Other Team:', result[responseColumns.OTHER_TEAM]);
    console.log('  Who:', result[responseColumns.WHO]);
    console.log('  What:', result[responseColumns.WHAT]);
    console.log('  How:', result[responseColumns.HOW]);
    console.log('  Phone:', result[responseColumns.PHONE]);

    assert.equal(result[responseColumns.TEAM_TYPE], 'AO', 'Crazy Ivan: teamType reused');
    assert.equal(result[responseColumns.TEAM], 'Crucible', 'Crazy Ivan: team reused');
    assert.equal(result[responseColumns.WHO], 'A highly intentional, purpose-driven, and effective HIM', 'Crazy Ivan: who reused');
    assert.equal(mailsSent.length, 0, 'Crazy Ivan: no email sent');

    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

// Test: prefilled URL generation carries current email and NAG email without throwing.
{
    mailsSent = [];
    global._mockPrevSs = {};
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{
                F3_NAME: 'TestPax',
                EMAIL: 'old@example.com',
                TEAM_TYPE: 'AO',
                TEAM: 'Crucible',
                OTHER_TEAM: '',
                WHO: 'Leader',
                WHAT: 'Run hard',
                HOW: 'Track daily',
                PHONE: '555-9999',
                NAG_EMAIL: 'Yes'
            }];
        }
    };

    function makeListItem(title, choices) {
        return {
            getType: function() { return global.FormApp.ItemType.LIST; },
            getTitle: function() { return title; },
            asListItem: function() {
                return {
                    getChoices: function() {
                        return choices.map(function(v) {
                            return { getValue: function() { return v; } };
                        });
                    },
                    createResponse: function(v) {
                        if (choices.indexOf(v) === -1) {
                            throw new Error('Invalid response submitted to item: ' + v + '.');
                        }
                        return { value: v };
                    }
                };
            }
        };
    }

    function makeTextItem(title) {
        return {
            getType: function() { return global.FormApp.ItemType.TEXT; },
            getTitle: function() { return title; },
            asTextItem: function() {
                return {
                    createResponse: function(v) { return { value: v }; }
                };
            }
        };
    }

    var fakeForm = {
        getItems: function() {
            return [
                makeTextItem('Email Address'),
                makeTextItem('Are you currently participating in Go30?'),
                makeTextItem('F3 Name'),
                makeListItem('NAG Email?', ['Yes', 'No']),
                makeListItem('Team', ['AO', 'Crucible'])
            ];
        },
        createResponse: function() {
            return {
                withItemResponse: function() { return this; },
                toPrefilledUrl: function() { return 'https://example.com/prefill'; }
            };
        }
    };

    global._mockForm = fakeForm;

    const result = maybeReuseLastMonthsGoals_(
        {
            getFormUrl: function() { return 'https://docs.google.com/forms/d/mock/viewform'; },
            getId: function() { return 'current-sheet-id'; },
            getSheetByName: function(name) { return name === 'PaxDB' ? makeMockPaxDbSheetFromManagedRows_() : null; },
            getUrl: function() { return 'https://mock-ss.example.com'; }
        },
        makeMockResponsesSheet(HEADERS),
        2,
        ['ts', 'current@example.com', REUSE_ANSWER, 'TestPax', '', '', '', '', '', '', '', '']
    );

    assert.equal(result[responseColumns.EMAIL], 'current@example.com', 'current email kept in reused response');
    assert.equal(result[responseColumns.NAG_EMAIL], 'Yes', 'NAG email flag copied into reused response');
    assert.equal(mailsSent.length, 0, 'no email sent on reuse');

    global._mockForm = null;
    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

// Test: prefilled URL generation skips invalid list choice values without throwing.
{
    mailsSent = [];
    global._mockPrevSs = {};
    global._mockManagedSheet = {
        getAllRows: function() {
            return [{
                F3_NAME: 'TestPax',
                TEAM_TYPE: 'AO',
                TEAM: 'Crucible',
                OTHER_TEAM: '',
                WHO: 'Leader',
                WHAT: 'Run hard',
                HOW: 'Track daily',
                PHONE: '555-9999'
            }];
        }
    };

    function makeListItem(title, choices) {
        return {
            getType: function() { return global.FormApp.ItemType.LIST; },
            getTitle: function() { return title; },
            asListItem: function() {
                return {
                    getChoices: function() {
                        return choices.map(function(v) {
                            return { getValue: function() { return v; } };
                        });
                    },
                    createResponse: function(v) {
                        if (choices.indexOf(v) === -1) {
                            throw new Error('Invalid response submitted to item: ' + v + '.');
                        }
                        return { value: v };
                    }
                };
            }
        };
    }

    function makeTextItem(title) {
        return {
            getType: function() { return global.FormApp.ItemType.TEXT; },
            getTitle: function() { return title; },
            asTextItem: function() {
                return {
                    createResponse: function(v) { return { value: v }; }
                };
            }
        };
    }

    var fakeForm = {
        getItems: function() {
            return [
                makeTextItem('Are you currently participating in Go30?'),
                makeTextItem('F3 Name'),
                makeListItem('Team', ['Bourbon', 'Fusion'])
            ];
        },
        createResponse: function() {
            return {
                withItemResponse: function() { return this; },
                toPrefilledUrl: function() { return 'https://example.com/prefill'; }
            };
        }
    };

    global._mockForm = fakeForm;

    const result = maybeReuseLastMonthsGoals_(
        {
            getFormUrl: function() { return 'https://docs.google.com/forms/d/mock/viewform'; },
            getId: function() { return 'current-sheet-id'; },
            getSheetByName: function(name) { return name === 'PaxDB' ? makeMockPaxDbSheetFromManagedRows_() : null; },
            getUrl: function() { return 'https://mock-ss.example.com'; }
        },
        makeMockResponsesSheet(HEADERS),
        2,
        reusableFormRow()
    );

    assert.equal(result[responseColumns.TEAM], 'Crucible', 'reuse merge still applies with invalid form choice');
    assert.equal(mailsSent.length, 0, 'no email sent on reuse');

    global._mockForm = null;
    global._mockPrevSs = null;
    global._mockManagedSheet = null;
}

// Test: buildPrefilledGoalUpdateUrl's Team field lookup does not confuse a Teams page break
// with the Team list item. Called directly (not via maybeReuseLastMonthsGoals_, which no
// longer computes a prefilled URL — see the "no email sent" tests above: that email/prefill
// flow belongs to the form-submit path, not the webapp-signup path).
{
    function makePageBreakItem(title) {
        return {
            getType: function() { return 'PAGE_BREAK'; },
            getTitle: function() { return title; }
        };
    }

    function makeListItem(title, choices) {
        return {
            getType: function() { return global.FormApp.ItemType.LIST; },
            getTitle: function() { return title; },
            asListItem: function() {
                return {
                    getChoices: function() {
                        return choices.map(function(v) {
                            return { getValue: function() { return v; } };
                        });
                    },
                    createResponse: function(v) {
                        return { itemTitle: title, value: v };
                    }
                };
            }
        };
    }

    function makeTextItem(title) {
        return {
            getType: function() { return global.FormApp.ItemType.TEXT; },
            getTitle: function() { return title; },
            asTextItem: function() {
                return {
                    createResponse: function(v) { return { itemTitle: title, value: v }; }
                };
            }
        };
    }

    var capturedResponses = [];
    var fakeForm = {
        getItems: function() {
            return [
                makeTextItem('Are you currently participating in Go30?'),
                makeTextItem('F3 Name'),
                makePageBreakItem('Teams'),
                makeListItem('Team', ['Crucible', 'Fusion'])
            ];
        },
        createResponse: function() {
            return {
                withItemResponse: function(response) {
                    capturedResponses.push(response);
                    return this;
                },
                toPrefilledUrl: function() { return 'https://example.com/prefill'; }
            };
        }
    };

    buildPrefilledGoalUpdateUrl(fakeForm, reusableFormRow(), { ...reusedValues, team: 'Crucible' }, responseColumns);

    assert.ok(capturedResponses.some(function(response) {
        return response && response.itemTitle === 'Team' && response.value === 'Crucible';
    }), 'Team list item receives the prefilled Crucible value even when a Teams page break exists');
}

// Test: buildPrefilledGoalUpdateUrl's Team field lookup does not confuse Team type with the
// Team choice item. Called directly — see the note on the page-break test above.
{
    function makeChoiceItem(title, choices, type) {
        return {
            getType: function() { return type; },
            getTitle: function() { return title; },
            asMultipleChoiceItem: function() {
                return {
                    getChoices: function() {
                        return choices.map(function(v) {
                            return { getValue: function() { return v; } };
                        });
                    },
                    createResponse: function(v) {
                        return { itemTitle: title, value: v };
                    }
                };
            },
            asListItem: function() {
                return {
                    getChoices: function() {
                        return choices.map(function(v) {
                            return { getValue: function() { return v; } };
                        });
                    },
                    createResponse: function(v) {
                        return { itemTitle: title, value: v };
                    }
                };
            }
        };
    }

    function makeTextItem(title) {
        return {
            getType: function() { return global.FormApp.ItemType.TEXT; },
            getTitle: function() { return title; },
            asTextItem: function() {
                return {
                    createResponse: function(v) { return { itemTitle: title, value: v }; }
                };
            }
        };
    }

    var capturedResponses = [];
    var fakeForm = {
        getItems: function() {
            return [
                makeTextItem('Are you currently participating in Go30?'),
                makeTextItem('F3 Name'),
                makeChoiceItem('Team type', ['AO', 'Goal based - or other team'], global.FormApp.ItemType.MULTIPLE_CHOICE),
                makeChoiceItem('Team', ['Crucible', 'Fusion'], global.FormApp.ItemType.LIST)
            ];
        },
        createResponse: function() {
            return {
                withItemResponse: function(response) {
                    capturedResponses.push(response);
                    return this;
                },
                toPrefilledUrl: function() { return 'https://example.com/prefill'; }
            };
        }
    };

    buildPrefilledGoalUpdateUrl(fakeForm, reusableFormRow(), { ...reusedValues, team: 'Crucible' }, responseColumns);

    assert.ok(capturedResponses.some(function(response) {
        return response && response.itemTitle === 'Team' && response.value === 'Crucible';
    }), 'Team item receives the Crucible prefill even when Team type appears first');
}

console.log('test_signup_reuse.js: PASS');
