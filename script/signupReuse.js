/*
 * signupReuse.js
 *
 * Implements the "reuse last month's goals" flow used by the Go30 HC signup.
 * Key exported function: maybeReuseLastMonthsGoals_(spreadsheet, responsesSheet, submittedRowNumber, formResponses)
 * - When the participant selected the reuse option, this function locates the
 *   most recent prior response for the same email in the previous tracker (as
 *   configured in the Config sheet), copies the relevant goal fields into the
 *   current Responses row, merges them into the in-memory formResponses, and
 *   emails the participant a summary with a prefilled edit link.
 */

// Mapping used by ManagedSheet to map internal keys to canonical header names.
// All keys are required; resolveResponseColumns throws if any are absent.
var RESPONSE_COLUMN_MAP = {
    EMAIL: 'Email Address',
    F3_NAME: 'F3 Name',
    PARTICIPATION: 'Are you currently participating in Go30?',
    TEAM: 'Team',
    GOAL_SELECTION: 'Goal selection',
    WHO: 'WHO do you ultimately want to become?',
    WHAT: 'WHAT is your Go30 Challenge?',
    HOW: 'HOW are you going to be successful this month?',
    PHONE: 'Cell Phone Number'
};

// Alternative header phrasings for the same question — form text changes between tracker versions.
// resolveResponseColumns tries these after the primary name fails.
var RESPONSE_COLUMN_ALIASES = {
    GOAL_SELECTION: ['What is your goal?'],
    TEAM_PREFERENCE: ['Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?']
};

// Optional columns: resolved when header present, skipped silently when absent.
var OPTIONAL_RESPONSE_COLUMN_MAP = {
    NAG_EMAIL: 'NAG Email?',
    TEAM_PREFERENCE: 'Team preference'
};

// GAS global alias — callers in nag.js and response_utils.js reference this name.
var resolveResponseColumns_ = resolveResponseColumns;

function getResponseValue_(responseRow, columnMap, key) {
    if (!columnMap || typeof columnMap[key] !== 'number') throw new Error('Missing header mapping for ' + key);
    return responseRow[columnMap[key]];
}

// Returns '' instead of throwing when key is absent — for optional columns (e.g. NAG_EMAIL).
function getOptionalResponseValue_(responseRow, columnMap, key) {
    if (!columnMap || typeof columnMap[key] !== 'number') return '';
    return responseRow[columnMap[key]] || '';
}

function setResponseValue_(responseRow, columnMap, key, value) {
    if (!columnMap || typeof columnMap[key] !== 'number') throw new Error('Missing header mapping for ' + key);
    responseRow[columnMap[key]] = value;
}

function normalizeHeaderName(val) {
    return String(val || '').trim().toLowerCase();
}

// Returns the 0-based index of primaryName (or any alias) in normalizedHeaders, or -1.
function findHeaderIndex_(normalizedHeaders, primaryName, aliases) {
    var names = [primaryName].concat(aliases || []);
    for (var n = 0; n < names.length; n++) {
        var norm = normalizeHeaderName(names[n]);
        for (var h = 0; h < normalizedHeaders.length; h++) {
            if (normalizedHeaders[h] === norm) return h;
        }
    }
    return -1;
}

function resolveResponseColumns(responsesSheetOrHeaders) {
    var headers = Array.isArray(responsesSheetOrHeaders)
        ? responsesSheetOrHeaders
        : (responsesSheetOrHeaders ? responsesSheetOrHeaders.getRange(1, 1, 1, responsesSheetOrHeaders.getLastColumn()).getValues()[0] : []);

    var normalized = headers.map(normalizeHeaderName);
    var resolved = {};

    // Required columns — throw if absent under both canonical name and any alias.
    for (var canonical in RESPONSE_COLUMN_MAP) {
        var found = findHeaderIndex_(normalized, RESPONSE_COLUMN_MAP[canonical], RESPONSE_COLUMN_ALIASES[canonical]);
        if (found === -1) {
            throw new Error('Missing expected header: ' + RESPONSE_COLUMN_MAP[canonical]);
        }
        resolved[canonical] = found;
    }

    // Optional columns — silently skip when absent under both canonical name and any alias.
    for (var optKey in OPTIONAL_RESPONSE_COLUMN_MAP) {
        var optIdx = findHeaderIndex_(normalized, OPTIONAL_RESPONSE_COLUMN_MAP[optKey], RESPONSE_COLUMN_ALIASES[optKey]);
        if (optIdx !== -1) resolved[optKey] = optIdx;
    }

    return resolved;
}

function normalizeEmailAddress(email) {
    return String(email || '').trim().toLowerCase();
}

function isReuseLastMonthsGoalsChoice(answer) {
    var s = String(answer || '').trim();
    if (!s) return false;
    var lower = s.toLowerCase();
    // Simple rule: answer must start with "yes" and contain the word "last"
    return /^yes\b/.test(lower) && lower.indexOf('last') !== -1;
}

// Config-aware wrapper. When the 'Reuse Goals Trigger' Config row is present its
// primary value is matched exactly (case-insensitive). Falls back to the regex
// heuristic above when absent — avoids breaking existing trackers that haven't
// added the Config row yet.
function checkIsReuseChoice_(answer, reuseTriggerPhrase) {
    if (reuseTriggerPhrase) {
        return String(answer || '').trim().toLowerCase() === String(reuseTriggerPhrase).trim().toLowerCase();
    }
    return isReuseLastMonthsGoalsChoice(answer);
}

function findLatestResponseByEmail(rows, emailAddress, responseColumns) {
    if (!responseColumns || typeof responseColumns.EMAIL !== 'number') throw new Error('responseColumns required for findLatestResponseByEmail');
    var norm = normalizeEmailAddress(emailAddress);
    if (!norm) return null;
    for (var i = rows.length - 1; i >= 0; i--) {
        var row = rows[i];
        if (!row) continue;
        if (normalizeEmailAddress(row[responseColumns.EMAIL]) === norm) return { rowIndex: i, row: row };
    }
    return null;
}

function extractReusableResponseValues(responseRow, responseColumns) {
    if (!responseRow) return null;
    if (!responseColumns) throw new Error('responseColumns required for extractReusableResponseValues');
    function v(key) {
        var idx = responseColumns[key];
        return (typeof idx === 'number' && idx >= 0) ? (responseRow[idx] || '') : '';
    }
    return {
        teamPreference: v('TEAM_PREFERENCE'),
        team: v('TEAM'),
        goalSelection: v('GOAL_SELECTION'),
        who: v('WHO'),
        what: v('WHAT'),
        how: v('HOW'),
        phone: v('PHONE')
    };
}

function mergeReusedValuesIntoResponseArray(responseArray, reusedValues, responseColumns) {
    if (!responseArray || !reusedValues) return responseArray;
    if (!responseColumns) throw new Error('responseColumns required for mergeReusedValuesIntoResponseArray');
    function setVal(key, value) {
        var idx = responseColumns[key];
        if (typeof idx === 'number' && idx >= 0) responseArray[idx] = value;
    }
    setVal('TEAM_PREFERENCE', reusedValues.teamPreference);
    setVal('TEAM', reusedValues.team);
    setVal('GOAL_SELECTION', reusedValues.goalSelection);
    setVal('WHO', reusedValues.who);
    setVal('WHAT', reusedValues.what);
    setVal('HOW', reusedValues.how);
    setVal('PHONE', reusedValues.phone);
    return responseArray;
}

function buildReuseSummaryLines(reusedValues) {
    if (!reusedValues) return [];
    var lines = [
        ['Team preference', reusedValues.teamPreference],
        ['Team', reusedValues.team],
        ['Goal selection', reusedValues.goalSelection],
        ['Who', reusedValues.who],
        ['What', reusedValues.what],
        ['How', reusedValues.how],
        ['Phone', reusedValues.phone]
    ];
    return lines.filter(function(e) { return String(e[1] || '').trim() !== ''; }).map(function(e) { return e[0] + ': ' + e[1]; });
}

function findFormItemByTitle(form, titlePrefix) {
    if (!form) return null;
    var items = form.getItems();
    var norm = String(titlePrefix || '').trim().toLowerCase();
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (typeof item.getTitle !== 'function') continue;
        var title = String(item.getTitle() || '').trim().toLowerCase();
        if (title === norm || title.indexOf(norm) === 0) return item;
    }
    return null;
}

function addPrefilledItemResponse(draftResponse, item, value) {
    if (!item || String(value || '').trim() === '') return;
    switch (item.getType()) {
        case FormApp.ItemType.TEXT:
            draftResponse.withItemResponse(item.asTextItem().createResponse(String(value)));
            return;
        case FormApp.ItemType.PARAGRAPH_TEXT:
            draftResponse.withItemResponse(item.asParagraphTextItem().createResponse(String(value)));
            return;
        case FormApp.ItemType.MULTIPLE_CHOICE:
            draftResponse.withItemResponse(item.asMultipleChoiceItem().createResponse(String(value)));
            return;
        case FormApp.ItemType.LIST:
            draftResponse.withItemResponse(item.asListItem().createResponse(String(value)));
            return;
    }
}

function buildPrefilledGoalUpdateUrl(form, currentResponseRow, reusedValues, responseColumns) {
    if (!form) return '';
    var draft = form.createResponse();
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'Are you currently participating in Go30?'), 'Yes');
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'F3 Name'), (currentResponseRow && currentResponseRow[responseColumns.F3_NAME]) || '');
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'Team preference'), reusedValues.teamPreference);
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'Team'), reusedValues.team);
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'Goal selection'), reusedValues.goalSelection);
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'WHO do you ultimately want to become?'), reusedValues.who);
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'WHAT is your Go30 Challenge?'), reusedValues.what);
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'HOW are you going to be successful this month?'), reusedValues.how);
    addPrefilledItemResponse(draft, findFormItemByTitle(form, 'Cell Phone Number'), reusedValues.phone);
    return draft.toPrefilledUrl();
}

/**
 * getPriorResponse
 * - prevSs: Spreadsheet object for previous tracker
 * - emailAddress: email to lookup
 * - form: Form object (may be null)
 * - currentResponseRow/currentResponseColumns: used to build prefilled URL
 *
 * Returns { ok: true, reusedValues: {...}, prefilledUrl: '...' }
 * or { ok: false, error: 'reason', message: 'human message' }
 */
function getPriorResponse(prevSs, emailAddress) {
    if (!prevSs) return { ok: false, error: 'no-ss', message: 'previous spreadsheet not provided' };
    try {
        var prevManager = new SpreadsheetManager(prevSs);
        var prevMs = prevManager.openExistingSheet('Responses', RESPONSE_COLUMN_MAP);
        var prevRowsObj = prevMs.getAllRows();
        var foundObj = null;
        for (var i = prevRowsObj.length - 1; i >= 0; i--) {
            var r = prevRowsObj[i];
            if (!r) continue;
            if (normalizeEmailAddress(r.EMAIL) === normalizeEmailAddress(emailAddress)) { foundObj = r; break; }
        }
        if (!foundObj) return { ok: false, error: 'not-found', message: 'no previous response found for ' + emailAddress };
        return {
            ok: true,
            reusedValues: {
                teamPreference: foundObj.TEAM_PREFERENCE || '',
                team: foundObj.TEAM || '',
                goalSelection: foundObj.GOAL_SELECTION || '',
                who: foundObj.WHO || '',
                what: foundObj.WHAT || '',
                how: foundObj.HOW || '',
                phone: foundObj.PHONE || ''
            }
        };
    } catch (err) {
        return { ok: false, error: 'lookup-failed', message: 'prior tracker lookup failed: ' + (err && err.message) };
    }
}

function sendGoalReuseEmail(emailAddress, f3Name, trackerUrl, prefilledUrl, summaryLines, usedPriorGoals) {
    if (!emailAddress) { Logger.log('sendGoalReuseEmail: missing email'); return; }
    var body = ['F3 Name: ' + (f3Name || '(unknown)'), ''];
    if (usedPriorGoals) {
        body.push('We reused your most recent prior Go30 entries for this month:');
        body = body.concat(summaryLines);
        body.push('');
        body.push('Tracker: ' + trackerUrl);
        if (prefilledUrl) {
            body.push('');
            body.push('If you want to adjust those defaults, open this prefilled form link and submit again:');
            body.push(prefilledUrl);
        }
    } else {
        body.push('We could not find a prior Go30 entry to reuse for this email address.');
        body.push('');
        body.push('Tracker: ' + trackerUrl);
        if (prefilledUrl) {
            body.push('');
            body.push('Use this form link to enter or update your goals:');
            body.push(prefilledUrl);
        }
    }
    MailApp.sendEmail(emailAddress, 'F3 Go30: ' + (usedPriorGoals ? 'last month\'s goals reused' : 'enter your goals'), body.join('\n'));
}

/**
 * maybeReuseLastMonthsGoals_
 * - spreadsheet: active Spreadsheet object
 * - responsesSheet: the Responses sheet object (Sheet)
 * - submittedRowNumber: the 1-based row number in the Responses sheet where this submission landed
 * - formResponses: array representing the submitted response row (same shape as sheet row)
 *
 * Returns the possibly-modified formResponses.
 */
function maybeReuseLastMonthsGoals_(spreadsheet, responsesSheet, submittedRowNumber, formResponses) {
    var currentResponseColumns = resolveResponseColumns(responsesSheet);

    // Read optional Config trigger phrase so the reuse option text is not hardcoded.
    var triggerConfig = getConfigValue_(spreadsheet, 'Reuse Goals Trigger');
    var reuseTriggerPhrase = triggerConfig && (triggerConfig.primary || triggerConfig.secondary) || '';

    if (!checkIsReuseChoice_(formResponses[currentResponseColumns.PARTICIPATION], reuseTriggerPhrase)) {
        return formResponses;
    }

    var emailAddress = formResponses[currentResponseColumns.EMAIL];
    var f3Name = formResponses[currentResponseColumns.F3_NAME];
    var trackerUrl = (spreadsheet.getSheetByName('Tracker') ? spreadsheet.getUrl() + '#gid=' + spreadsheet.getSheetByName('Tracker').getSheetId() : spreadsheet.getUrl());
    var form = spreadsheet.getFormUrl() ? FormApp.openByUrl(spreadsheet.getFormUrl()) : null;
    var prefilledUrl = spreadsheet.getFormUrl() || '';

    // Resolve previous tracker reference from Config — exit early if absent.
    var previousTrackerConfig = getConfigValue_(spreadsheet, 'Last Month Tracker');
    var trackerReference = String((previousTrackerConfig && (previousTrackerConfig.secondary || previousTrackerConfig.primary)) || '').trim();
    if (!trackerReference) {
        Logger.log('maybeReuseLastMonthsGoals_: no previous tracker found in Config sheet');
        sendGoalReuseEmail(emailAddress, f3Name, trackerUrl, prefilledUrl, [], false);
        return formResponses;
    }

    // Open the previous tracker spreadsheet.
    var priorResult;
    try {
        var match = trackerReference.match(/\/d\/([a-zA-Z0-9_-]+)/);
        var prevSs = match ? SpreadsheetApp.openById(match[1]) : SpreadsheetApp.openByUrl(trackerReference);
        priorResult = getPriorResponse(prevSs, emailAddress);
    } catch (e) {
        priorResult = { ok: false, error: 'open-failed', message: 'failed to open previous tracker: ' + (e && e.message) };
    }
    if (!priorResult.ok) {
        Logger.log('maybeReuseLastMonthsGoals_: ' + priorResult.message);
        sendGoalReuseEmail(emailAddress, f3Name, trackerUrl, prefilledUrl, [], false);
        return formResponses;
    }

    var reusedValues = priorResult.reusedValues;

    // Merge reused values into in-memory row, then write back in one shot (P1-8).
    mergeReusedValuesIntoResponseArray(formResponses, reusedValues, currentResponseColumns);
    try {
        responsesSheet.getRange(submittedRowNumber, 1, 1, formResponses.length).setValues([formResponses]);
    } catch (e) {
        Logger.log('maybeReuseLastMonthsGoals_: setValues failed — ' + (e && e.message));
    }

    // Recompute prefilled URL from merged values.
    if (form) {
        prefilledUrl = buildPrefilledGoalUpdateUrl(form, formResponses, reusedValues, currentResponseColumns) || prefilledUrl;
    }

    sendGoalReuseEmail(emailAddress, f3Name, trackerUrl, prefilledUrl, buildReuseSummaryLines(reusedValues), true);
    return formResponses;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        maybeReuseLastMonthsGoals_,
        isReuseLastMonthsGoalsChoice,
        checkIsReuseChoice_,
        resolveResponseColumns,
        findLatestResponseByEmail,
        extractReusableResponseValues,
        mergeReusedValuesIntoResponseArray,
        buildReuseSummaryLines,
        getResponseValue_,
        getOptionalResponseValue_,
        setResponseValue_
    };
}