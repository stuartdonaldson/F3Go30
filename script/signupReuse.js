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
var responseUtilsModule_ = (typeof module !== 'undefined' && module.exports)
    ? require('./response_utils.js')
    : null;

var RESPONSE_COLUMN_MAP = (responseUtilsModule_ && responseUtilsModule_.RESPONSE_COLUMN_MAP)
    || (typeof globalThis !== 'undefined' && globalThis.RESPONSE_COLUMN_MAP);
var getResponseFieldTitles_ = (responseUtilsModule_ && responseUtilsModule_.getResponseFieldTitles_)
    || (typeof globalThis !== 'undefined' && globalThis.getResponseFieldTitles_);
var sanitizeTextForEmailLine_ = (responseUtilsModule_ && responseUtilsModule_.sanitizeTextForEmailLine_)
    || (typeof globalThis !== 'undefined' && globalThis.sanitizeTextForEmailLine_);
var sanitizeEmailAddressForSend_ = (responseUtilsModule_ && responseUtilsModule_.sanitizeEmailAddressForSend_)
    || (typeof globalThis !== 'undefined' && globalThis.sanitizeEmailAddressForSend_);
var resolveResponseColumns = (responseUtilsModule_ && responseUtilsModule_.resolveResponseColumns)
    || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns);
var resolveResponseColumns_ = (responseUtilsModule_ && responseUtilsModule_.resolveResponseColumns_)
    || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns_)
    || resolveResponseColumns;

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

function findLatestResponseByF3Name(rows, f3Name, responseColumns) {
    if (!responseColumns || typeof responseColumns.F3_NAME !== 'number') throw new Error('responseColumns required for findLatestResponseByF3Name');
    var norm = String(f3Name || '').trim().toLowerCase();
    if (!norm) return null;
    for (var i = rows.length - 1; i >= 0; i--) {
        var row = rows[i];
        if (!row) continue;
        if (String(row[responseColumns.F3_NAME] || '').trim().toLowerCase() === norm) return { rowIndex: i, row: row };
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
        email: v('EMAIL'),
        teamType: v('TEAM_TYPE'),
        team: v('TEAM'),
        otherTeam: v('OTHER_TEAM'),
        who: v('WHO'),
        what: v('WHAT'),
        how: v('HOW'),
        phone: v('PHONE'),
        nagEmail: v('NAG_EMAIL')
    };
}

function mergeReusedValuesIntoResponseArray(responseArray, reusedValues, responseColumns) {
    if (!responseArray || !reusedValues) return responseArray;
    if (!responseColumns) throw new Error('responseColumns required for mergeReusedValuesIntoResponseArray');
    function setVal(key, value) {
        var idx = responseColumns[key];
        if (typeof idx === 'number' && idx >= 0) responseArray[idx] = value;
    }
    setVal('EMAIL', reusedValues.email);
    setVal('TEAM_TYPE', reusedValues.teamType);
    setVal('TEAM', reusedValues.team);
    setVal('OTHER_TEAM', reusedValues.otherTeam);
    setVal('WHO', reusedValues.who);
    setVal('WHAT', reusedValues.what);
    setVal('HOW', reusedValues.how);
    setVal('PHONE', reusedValues.phone);
    setVal('NAG_EMAIL', reusedValues.nagEmail);
    return responseArray;
}

function buildReuseSummaryLines(reusedValues) {
    if (!reusedValues) return [];
    var lines = [
        ['Email', reusedValues.email],
        ['NAG Email', reusedValues.nagEmail],
        ['Team type', reusedValues.teamType],
        ['Team', reusedValues.team],
        ['Other team name', reusedValues.otherTeam],
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

function findResponseFormItemByKey_(form, key) {
    var titles = getResponseFieldTitles_(key);
    for (var i = 0; i < titles.length; i++) {
        var item = findFormItemByTitle(form, titles[i]);
        if (item) return item;
    }
    return null;
}

function resolveChoiceValue_(choices, value) {
    var normValue = String(value || '').trim().toLowerCase();
    if (!normValue) return '';
    for (var i = 0; i < (choices || []).length; i++) {
        var choiceValue = String(choices[i].getValue() || '');
        if (choiceValue.trim().toLowerCase() === normValue) {
            return choiceValue;
        }
    }
    return '';
}

function addPrefilledItemResponse(draftResponse, item, value) {
    if (!item || String(value || '').trim() === '') return;
    try {
        switch (item.getType()) {
            case FormApp.ItemType.TEXT:
                draftResponse.withItemResponse(item.asTextItem().createResponse(String(value)));
                return;
            case FormApp.ItemType.PARAGRAPH_TEXT:
                draftResponse.withItemResponse(item.asParagraphTextItem().createResponse(String(value)));
                return;
            case FormApp.ItemType.MULTIPLE_CHOICE:
                var mcItem = item.asMultipleChoiceItem();
                var mcChoice = resolveChoiceValue_(mcItem.getChoices(), value);
                if (!mcChoice) {
                    Logger.log('buildPrefilledGoalUpdateUrl: skipping invalid multiple-choice value "' + value + '" for item "' + item.getTitle() + '"');
                    return;
                }
                draftResponse.withItemResponse(mcItem.createResponse(mcChoice));
                return;
            case FormApp.ItemType.LIST:
                var listItem = item.asListItem();
                var listChoice = resolveChoiceValue_(listItem.getChoices(), value);
                if (!listChoice) {
                    Logger.log('buildPrefilledGoalUpdateUrl: skipping invalid list value "' + value + '" for item "' + item.getTitle() + '"');
                    return;
                }
                draftResponse.withItemResponse(listItem.createResponse(listChoice));
                return;
        }
    } catch (e) {
        Logger.log('buildPrefilledGoalUpdateUrl: prefill failed for item "' + (item.getTitle ? item.getTitle() : '(unknown)') + '" with value "' + value + '" — ' + (e && e.message));
    }
}

function buildPrefilledGoalUpdateUrl(form, currentResponseRow, reusedValues, responseColumns) {
    if (!form) return '';
    var draft = form.createResponse();
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'PARTICIPATION'), 'Yes');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'EMAIL'), (currentResponseRow && currentResponseRow[responseColumns.EMAIL]) || reusedValues.email || '');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'F3_NAME'), (currentResponseRow && currentResponseRow[responseColumns.F3_NAME]) || '');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'TEAM_TYPE'), reusedValues.teamType);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'TEAM'), reusedValues.team);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'OTHER_TEAM'), reusedValues.otherTeam);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'WHO'), reusedValues.who);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'WHAT'), reusedValues.what);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'HOW'), reusedValues.how);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'PHONE'), reusedValues.phone);
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'NAG_EMAIL'), reusedValues.nagEmail);
    return draft.toPrefilledUrl();
}

/**
 * getPriorResponse
 * - prevSs: Spreadsheet object for previous tracker
 * - f3Name: F3 Name to lookup
 *
 * Returns { ok: true, reusedValues: {...} }
 * or { ok: false, error: 'reason', message: 'human message' }
 */
function getPriorResponse(prevSs, f3Name) {
    if (!prevSs) return { ok: false, error: 'no-ss', message: 'previous spreadsheet not provided' };
    try {
        var prevManager = new SpreadsheetManager(prevSs);
        var prevMs = prevManager.openExistingSheet('Responses', RESPONSE_COLUMN_MAP);
        var prevRowsObj = prevMs.getAllRows();
        var foundObj = null;
        var normF3Name = String(f3Name || '').trim().toLowerCase();
        for (var i = prevRowsObj.length - 1; i >= 0; i--) {
            var r = prevRowsObj[i];
            if (!r) continue;
            if (String(r.F3_NAME || '').trim().toLowerCase() === normF3Name) { foundObj = r; break; }
        }
        if (!foundObj) return { ok: false, error: 'not-found', message: 'no previous response found for F3 Name: ' + f3Name };
        return {
            ok: true,
            reusedValues: {
                email: foundObj.EMAIL || '',
                teamType: foundObj.TEAM_TYPE || '',
                team: foundObj.TEAM || '',
                otherTeam: foundObj.OTHER_TEAM || '',
                who: foundObj.WHO || '',
                what: foundObj.WHAT || '',
                how: foundObj.HOW || '',
                phone: foundObj.PHONE || '',
                nagEmail: foundObj.NAG_EMAIL || ''
            }
        };
    } catch (err) {
        return { ok: false, error: 'lookup-failed', message: 'prior tracker lookup failed: ' + (err && err.message) };
    }
}

function sendGoalReuseEmail(emailAddress, f3Name, trackerUrl, prefilledUrl, summaryLines, usedPriorGoals) {
    var recipient = sanitizeEmailAddressForSend_(emailAddress);
    if (!recipient) { Logger.log('sendGoalReuseEmail: invalid email'); return; }
    var safeF3Name = sanitizeTextForEmailLine_(f3Name) || '(unknown)';
    var message = buildSignupReuseEmailTemplate_({
        usedPriorGoals: !!usedPriorGoals,
        f3Name: safeF3Name,
        trackerUrl: trackerUrl,
        prefilledUrl: prefilledUrl,
        summaryLines: summaryLines || []
    });

    try {
        MailApp.sendEmail({ to: recipient, subject: message.subject, body: message.body, htmlBody: message.htmlBody });
    } catch (e) {
        // Fallback to plain text send if templated send fails
        Logger.log('sendGoalReuseEmail: template send failed — ' + (e && e.message));
        MailApp.sendEmail(recipient, message.subject, message.body);
    }
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
        priorResult = getPriorResponse(prevSs, f3Name);
    } catch (e) {
        priorResult = { ok: false, error: 'open-failed', message: 'failed to open previous tracker: ' + (e && e.message) };
    }
    if (!priorResult.ok) {
        Logger.log('maybeReuseLastMonthsGoals_: ' + priorResult.message);
        sendGoalReuseEmail(emailAddress, f3Name, trackerUrl, prefilledUrl, [], false);
        return formResponses;
    }

    var reusedValues = priorResult.reusedValues;
    reusedValues.email = emailAddress || reusedValues.email || '';

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
        findLatestResponseByF3Name,
        extractReusableResponseValues,
        mergeReusedValuesIntoResponseArray,
        buildReuseSummaryLines,
        sanitizeTextForEmailLine_,
        sanitizeEmailAddressForSend_,
        getResponseValue_,
        getOptionalResponseValue_,
        setResponseValue_
    };
}