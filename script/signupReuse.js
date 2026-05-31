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
var signupReuseUtilitiesModule_ = (typeof module !== 'undefined' && module.exports)
    ? require('./Utilities.js')
    : null;

var RESPONSE_COLUMN_MAP = (responseUtilsModule_ && responseUtilsModule_.RESPONSE_COLUMN_MAP)
    || (typeof globalThis !== 'undefined' && globalThis.RESPONSE_COLUMN_MAP);
var getResponseFieldTitles_ = (responseUtilsModule_ && responseUtilsModule_.getResponseFieldTitles_)
    || (typeof globalThis !== 'undefined' && globalThis.getResponseFieldTitles_);
var sanitizeTextForEmailLine_ = (responseUtilsModule_ && responseUtilsModule_.sanitizeTextForEmailLine_)
    || (typeof globalThis !== 'undefined' && globalThis.sanitizeTextForEmailLine_);
var sanitizeEmailAddressForSend_ = (responseUtilsModule_ && responseUtilsModule_.sanitizeEmailAddressForSend_)
    || (typeof globalThis !== 'undefined' && globalThis.sanitizeEmailAddressForSend_);
var buildGoalSummaryLines_ = (responseUtilsModule_ && responseUtilsModule_.buildGoalSummaryLines_)
    || (typeof globalThis !== 'undefined' && globalThis.buildGoalSummaryLines_);
var getResponseEmailValue_ = (responseUtilsModule_ && responseUtilsModule_.getResponseEmailValue_)
    || (typeof globalThis !== 'undefined' && globalThis.getResponseEmailValue_);
var resolveResponseColumns = (responseUtilsModule_ && responseUtilsModule_.resolveResponseColumns)
    || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns);
var resolveResponseColumns_ = (responseUtilsModule_ && responseUtilsModule_.resolveResponseColumns_)
    || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns_)
    || resolveResponseColumns;
var sendConfiguredEmail_ = (signupReuseUtilitiesModule_ && signupReuseUtilitiesModule_.sendConfiguredEmail_)
    || (typeof globalThis !== 'undefined' && globalThis.sendConfiguredEmail_);

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

function formatTrackerReferenceDate_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value.getFullYear()
            + '-' + String(value.getMonth() + 1).padStart(2, '0')
            + '-' + String(value.getDate()).padStart(2, '0');
    }
    return String(value || '').trim();
}

function extractSpreadsheetIdFromReference_(trackerReference) {
    var reference = String(trackerReference || '').trim();
    if (!reference) return '';

    var trackerIdMatch = reference.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (trackerIdMatch) return trackerIdMatch[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(reference)) return reference;
    return '';
}

function resolveTrackerReferenceFromLinks_(spreadsheet, previousTrackerConfig) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') return '';

    var trackerName = String((previousTrackerConfig && previousTrackerConfig.primary) || '').trim();
    if (!trackerName) return '';

    var linksSheet = spreadsheet.getSheetByName('Links');
    if (!linksSheet || typeof linksSheet.getDataRange !== 'function') return '';

    var values = linksSheet.getDataRange().getValues();
    if (!values || values.length < 2) return '';

    var headers = values[0].map(function(header) {
        return String(header || '').trim().toLowerCase();
    });
    var startDateIndex = headers.indexOf('startdate');
    if (startDateIndex === -1) startDateIndex = headers.indexOf('month');
    if (startDateIndex === -1) return '';

    var sheetIdIndex = headers.indexOf('sheetid');
    var trackerUrlIndex = headers.indexOf('trackerurl');
    if (trackerUrlIndex === -1) trackerUrlIndex = headers.indexOf('tracker url');
    var shortTrackerIndex = headers.indexOf('shorttracker');

    for (var i = values.length - 1; i >= 1; i--) {
        var row = values[i] || [];
        if (formatTrackerReferenceDate_(row[startDateIndex]) !== trackerName) continue;

        var sheetId = sheetIdIndex >= 0 ? String(row[sheetIdIndex] || '').trim() : '';
        if (sheetId) return sheetId;

        var trackerUrl = trackerUrlIndex >= 0 ? String(row[trackerUrlIndex] || '').trim() : '';
        if (trackerUrl) return trackerUrl;

        return shortTrackerIndex >= 0 ? String(row[shortTrackerIndex] || '').trim() : '';
    }

    return '';
}

function openSpreadsheetFromReference_(trackerReference) {
    var trackerId = extractSpreadsheetIdFromReference_(trackerReference);
    if (trackerId) return SpreadsheetApp.openById(trackerId);
    return SpreadsheetApp.openByUrl(String(trackerReference || '').trim());
}

function describePriorTrackerContext_(prevSs, trackerReference) {
    var parts = ['reference=' + JSON.stringify(String(trackerReference || '').trim())];
    if (!prevSs) return parts.join(', ');

    try {
        if (typeof prevSs.getName === 'function') {
            parts.push('spreadsheetName=' + JSON.stringify(prevSs.getName()));
        }
    } catch (e) {}

    try {
        if (typeof prevSs.getId === 'function') {
            parts.push('spreadsheetId=' + JSON.stringify(prevSs.getId()));
        }
    } catch (e) {}

    try {
        if (typeof prevSs.getUrl === 'function') {
            parts.push('spreadsheetUrl=' + JSON.stringify(prevSs.getUrl()));
        }
    } catch (e) {}

    try {
        if (typeof prevSs.getSheetByName === 'function') {
            var responsesSheet = prevSs.getSheetByName('Responses');
            parts.push('responsesSheet=' + (responsesSheet ? 'present' : 'missing'));
            if (responsesSheet && typeof responsesSheet.getDataRange === 'function') {
                var values = responsesSheet.getDataRange().getValues();
                var headerRow = values && values.length ? values[0] : [];
                parts.push('responsesHeaders=' + JSON.stringify(headerRow));
                parts.push('responsesRowCount=' + (values ? values.length : 0));
            }
        }
    } catch (e) {
        parts.push('responsesInspectError=' + JSON.stringify(e && e.message));
    }

    return parts.join(', ');
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

function findLatestResponseByEmail(rows, emailAddress, responseColumns, responseHeaders) {
    if (!responseColumns || typeof responseColumns.EMAIL !== 'number') throw new Error('responseColumns required for findLatestResponseByEmail');
    var norm = normalizeEmailAddress(emailAddress);
    if (!norm) return null;
    for (var i = rows.length - 1; i >= 0; i--) {
        var row = rows[i];
        if (!row) continue;
        if (normalizeEmailAddress(getResponseEmailValue_(row, responseColumns, responseHeaders)) === norm) return { rowIndex: i, row: row };
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
        if (key === 'EMAIL') return getResponseEmailValue_(responseRow, responseColumns);
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

function isDeletedResponseRow_(responseRow) {
    return String(responseRow && responseRow.PARTICIPATION || '').trim().toLowerCase() === 'deleted';
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
    return typeof buildGoalSummaryLines_ === 'function' ? buildGoalSummaryLines_({
        EMAIL: reusedValues && reusedValues.email,
        NAG_EMAIL: reusedValues && reusedValues.nagEmail,
        TEAM_TYPE: reusedValues && reusedValues.teamType,
        TEAM: reusedValues && reusedValues.team,
        OTHER_TEAM: reusedValues && reusedValues.otherTeam,
        WHO: reusedValues && reusedValues.who,
        WHAT: reusedValues && reusedValues.what,
        HOW: reusedValues && reusedValues.how,
        PHONE: reusedValues && reusedValues.phone
    }) : [];
}

function isFormTitleMatch_(title, titlePrefix) {
    var normalizedTitle = String(title || '').trim().toLowerCase();
    var normalizedPrefix = String(titlePrefix || '').trim().toLowerCase();
    if (!normalizedTitle || !normalizedPrefix) return false;
    if (normalizedTitle === normalizedPrefix) return true;
    if (normalizedTitle.indexOf(normalizedPrefix) !== 0) return false;

    var nextChar = normalizedTitle.charAt(normalizedPrefix.length);
    return /[:;,.!?()[\]{}\-_/]/.test(nextChar);
}

function findFormItemByTitle(form, titlePrefix) {
    if (!form) return null;
    var items = form.getItems();
    var norm = String(titlePrefix || '').trim().toLowerCase();
    var prefixMatch = null;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (typeof item.getTitle !== 'function') continue;
        var title = String(item.getTitle() || '').trim().toLowerCase();
        if (title === norm) return item;
        if (!prefixMatch && isFormTitleMatch_(title, norm)) prefixMatch = item;
    }
    return prefixMatch;
}

function findResponseFormItemByKey_(form, key) {
    var titles = getResponseFieldTitles_(key);
    for (var i = 0; i < titles.length; i++) {
        var item = findFormItemByTitle(form, titles[i]);
        if (item) return item;
    }
    return null;
}

function ensureReuseOptionOnLinkedForm_(form) {
  var reuseChoiceText = "Yes, and use last month's goals.";
  var item = findResponseFormItemByKey_(form, 'PARTICIPATION');
  if (!item) {
    Logger.log('ensureReuseOptionOnLinkedForm_: PARTICIPATION item not found — skipping');
    return;
  }
  var type = item.getType();
  var typedItem;
  if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
    typedItem = item.asMultipleChoiceItem();
  } else if (type === FormApp.ItemType.LIST) {
    typedItem = item.asListItem();
  } else {
    Logger.log('ensureReuseOptionOnLinkedForm_: PARTICIPATION item type not supported — skipping');
    return;
  }
  var existingChoices = typedItem.getChoices();
  var norm = reuseChoiceText.trim().toLowerCase();
  for (var i = 0; i < existingChoices.length; i++) {
    if (existingChoices[i].getValue().trim().toLowerCase() === norm) return;
  }
  // Forms API requires all choices to be created via createChoice() — cannot mix
  // existing Choice objects with new ones in setChoices().
  var newChoices = existingChoices.map(function(c) { return typedItem.createChoice(c.getValue()); });
  newChoices.push(typedItem.createChoice(reuseChoiceText));
  typedItem.setChoices(newChoices);
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

function getChoiceValuesForLog_(item) {
    if (!item || typeof item.getType !== 'function') return [];
    try {
        switch (item.getType()) {
            case FormApp.ItemType.MULTIPLE_CHOICE:
                return item.asMultipleChoiceItem().getChoices().map(function(choice) { return choice.getValue(); });
            case FormApp.ItemType.LIST:
                return item.asListItem().getChoices().map(function(choice) { return choice.getValue(); });
            default:
                return [];
        }
    } catch (e) {
        return [];
    }
}

function addPrefilledItemResponse(draftResponse, item, value, fieldKey) {
    var safeFieldKey = fieldKey || '(unknown)';
    var safeValue = String(value || '');
    if (!item) {
        Logger.log('buildPrefilledGoalUpdateUrl: item not found for field ' + safeFieldKey + ' using titles [' + getResponseFieldTitles_(safeFieldKey).join(', ') + ']' + (safeFieldKey === 'EMAIL' ? ' (possible built-in form email collection)' : ''));
        return;
    }
    if (safeValue.trim() === '') {
        Logger.log('buildPrefilledGoalUpdateUrl: skipping blank value for field ' + safeFieldKey + ' on item "' + item.getTitle() + '"');
        return;
    }
    try {
        switch (item.getType()) {
            case FormApp.ItemType.TEXT:
                draftResponse.withItemResponse(item.asTextItem().createResponse(safeValue));
                return;
            case FormApp.ItemType.PARAGRAPH_TEXT:
                draftResponse.withItemResponse(item.asParagraphTextItem().createResponse(safeValue));
                return;
            case FormApp.ItemType.MULTIPLE_CHOICE:
                var mcItem = item.asMultipleChoiceItem();
                var mcChoice = resolveChoiceValue_(mcItem.getChoices(), safeValue);
                if (!mcChoice) {
                    Logger.log('buildPrefilledGoalUpdateUrl: skipping invalid multiple-choice value "' + safeValue + '" for field ' + safeFieldKey + ' on item "' + item.getTitle() + '". Available choices: [' + getChoiceValuesForLog_(item).join(', ') + ']');
                    return;
                }
                draftResponse.withItemResponse(mcItem.createResponse(mcChoice));
                return;
            case FormApp.ItemType.LIST:
                var listItem = item.asListItem();
                var listChoice = resolveChoiceValue_(listItem.getChoices(), safeValue);
                if (!listChoice) {
                    Logger.log('buildPrefilledGoalUpdateUrl: skipping invalid list value "' + safeValue + '" for field ' + safeFieldKey + ' on item "' + item.getTitle() + '". Available choices: [' + getChoiceValuesForLog_(item).join(', ') + ']');
                    return;
                }
                draftResponse.withItemResponse(listItem.createResponse(listChoice));
                return;
            default:
                Logger.log('buildPrefilledGoalUpdateUrl: unsupported item type ' + item.getType() + ' for field ' + safeFieldKey + ' on item "' + item.getTitle() + '"');
                return;
        }
    } catch (e) {
        Logger.log('buildPrefilledGoalUpdateUrl: prefill failed for field ' + safeFieldKey + ' on item "' + (item.getTitle ? item.getTitle() : '(unknown)') + '" with value "' + safeValue + '" — ' + (e && e.message));
    }
}

function buildPrefilledGoalUpdateUrl(form, currentResponseRow, reusedValues, responseColumns) {
    if (!form) return '';
    var draft = form.createResponse();
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'PARTICIPATION'), 'Yes', 'PARTICIPATION');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'EMAIL'), (currentResponseRow && getResponseEmailValue_(currentResponseRow, responseColumns)) || reusedValues.email || '', 'EMAIL');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'F3_NAME'), (currentResponseRow && currentResponseRow[responseColumns.F3_NAME]) || '', 'F3_NAME');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'TEAM_TYPE'), reusedValues.teamType, 'TEAM_TYPE');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'TEAM'), reusedValues.team, 'TEAM');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'OTHER_TEAM'), reusedValues.otherTeam, 'OTHER_TEAM');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'WHO'), reusedValues.who, 'WHO');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'WHAT'), reusedValues.what, 'WHAT');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'HOW'), reusedValues.how, 'HOW');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'PHONE'), reusedValues.phone, 'PHONE');
    addPrefilledItemResponse(draft, findResponseFormItemByKey_(form, 'NAG_EMAIL'), reusedValues.nagEmail, 'NAG_EMAIL');
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
function getPriorResponse(prevSs, f3Name, trackerReference) {
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
            if (isDeletedResponseRow_(r)) continue;
            if (String(r.F3_NAME || '').trim().toLowerCase() === normF3Name) { foundObj = r; break; }
        }
        if (!foundObj) {
            var ssName = ''; var ssId = '';
            try { ssName = prevSs.getName(); } catch (e) {}
            try { ssId = prevSs.getId(); } catch (e) {}
            var sampleNames = prevRowsObj.slice(0, 5).map(function(r) { return r && r.F3_NAME || '(blank)'; });
            return { ok: false, error: 'not-found', message: 'no previous response found for F3 Name: ' + f3Name + ' — prevSs=' + JSON.stringify(ssName) + ' id=' + JSON.stringify(ssId) + ' rowCount=' + prevRowsObj.length + ' sampleNames=' + JSON.stringify(sampleNames) };
        }
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
        return {
            ok: false,
            error: 'lookup-failed',
            message: 'prior tracker lookup failed: ' + (err && err.message) + ' (' + describePriorTrackerContext_(prevSs, trackerReference) + ')'
        };
    }
}

function sendGoalReuseEmail(spreadsheet, emailAddress, f3Name, trackerUrl, prefilledUrl, summaryLines, usedPriorGoals) {
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
        sendConfiguredEmail_({
            spreadsheet: spreadsheet,
            recipients: [{ name: safeF3Name, email: recipient }],
            subject: message.subject,
            body: message.body,
            htmlBody: message.htmlBody,
            allowPlainTextFallback: true,
            logLabel: 'sendGoalReuseEmail'
        });
    } catch (e) {
        Logger.log('sendGoalReuseEmail: send failed — ' + (e && e.message));
    }
}

function sendRegistrationConfirmationEmail_(spreadsheet, emailAddress, f3Name, trackerUrl, prefilledUrl, summaryLines, registrationMonth) {
    var recipient = sanitizeEmailAddressForSend_(emailAddress);
    if (!recipient) { Logger.log('sendRegistrationConfirmationEmail_: invalid email'); return; }

    var safeF3Name = sanitizeTextForEmailLine_(f3Name) || '(unknown)';
    var safeRegistrationMonth = sanitizeTextForEmailLine_(registrationMonth);
    if (!safeRegistrationMonth) {
        Logger.log('sendRegistrationConfirmationEmail_: registration month required');
        return;
    }

    var message = buildSignupReuseEmailTemplate_({
        mode: 'confirmation',
        f3Name: safeF3Name,
        trackerUrl: trackerUrl,
        prefilledUrl: prefilledUrl,
        summaryLines: summaryLines || [],
        registrationMonth: safeRegistrationMonth
    });

    sendConfiguredEmail_({
        spreadsheet: spreadsheet,
        recipients: [{ name: safeF3Name, email: recipient }],
        subject: message.subject,
        body: message.body,
        htmlBody: message.htmlBody,
        allowPlainTextFallback: true,
        logLabel: 'sendRegistrationConfirmationEmail_'
    });
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
    var currentResponseHeaders = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];

    // Read optional Config trigger phrase so the reuse option text is not hardcoded.
    var triggerConfig = getConfigValue_(spreadsheet, 'Reuse Goals Trigger');
    var reuseTriggerPhrase = triggerConfig && (triggerConfig.primary || triggerConfig.secondary) || '';

    if (!checkIsReuseChoice_(formResponses[currentResponseColumns.PARTICIPATION], reuseTriggerPhrase)) {
        return formResponses;
    }

    var emailAddress = getResponseEmailValue_(formResponses, currentResponseColumns, currentResponseHeaders);
    var f3Name = formResponses[currentResponseColumns.F3_NAME];
    var trackerUrl = (spreadsheet.getSheetByName('Tracker') ? spreadsheet.getUrl() + '#gid=' + spreadsheet.getSheetByName('Tracker').getSheetId() : spreadsheet.getUrl());
    var form = spreadsheet.getFormUrl() ? FormApp.openByUrl(spreadsheet.getFormUrl()) : null;
    var prefilledUrl = spreadsheet.getFormUrl() || '';

    // Resolve previous tracker reference from Config — exit early if absent.
    var previousTrackerConfig = getConfigValue_(spreadsheet, 'Last Month Tracker');
    var trackerReference = String((previousTrackerConfig && (previousTrackerConfig.secondary || previousTrackerConfig.primary)) || '').trim();
    if (!trackerReference) {
        Logger.log('maybeReuseLastMonthsGoals_: no previous tracker found in Config sheet');
        sendGoalReuseEmail(spreadsheet, emailAddress, f3Name, trackerUrl, prefilledUrl, [], false);
        return formResponses;
    }

    var priorResult;
    try {
        var prevSs;
        try {
            prevSs = openSpreadsheetFromReference_(trackerReference);
        } catch (openErr) {
            var linksFallbackReference = resolveTrackerReferenceFromLinks_(spreadsheet, previousTrackerConfig);
            if (!linksFallbackReference || linksFallbackReference === trackerReference) throw openErr;
            prevSs = openSpreadsheetFromReference_(linksFallbackReference);
        }
        priorResult = getPriorResponse(prevSs, f3Name, trackerReference);
    } catch (e) {
        priorResult = { ok: false, error: 'open-failed', message: 'failed to open previous tracker: ' + (e && e.message) };
    }
    if (!priorResult.ok) {
        Logger.log('maybeReuseLastMonthsGoals_: ' + priorResult.message);
        sendGoalReuseEmail(spreadsheet, emailAddress, f3Name, trackerUrl, prefilledUrl, [], false);
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

    sendGoalReuseEmail(spreadsheet, emailAddress, f3Name, trackerUrl, prefilledUrl, buildReuseSummaryLines(reusedValues), true);
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
        sendRegistrationConfirmationEmail_,
        sanitizeTextForEmailLine_,
        sanitizeEmailAddressForSend_,
        resolveTrackerReferenceFromLinks_,
        getResponseValue_,
        getOptionalResponseValue_,
        setResponseValue_
    };
}