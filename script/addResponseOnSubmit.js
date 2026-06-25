// Named with trailing underscore so GAS does not auto-register it as a simple trigger.
var FORM_SUBMIT_HANDLER_ = 'handleFormSubmit_';

var addResponseResponseUtilsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./response_utils.js')
  : null;

// Old handler name — kept here so clearFormSubmitTrigger can remove stale triggers registered
// before the handler was renamed. Safe to remove once all trackers have been re-triggered.
var LEGACY_FORM_SUBMIT_HANDLER_ = 'onFormSubmit';
var REGISTRATION_MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

var buildGoalSummaryLinesFromResponse_ = (typeof globalThis !== 'undefined' && globalThis.buildGoalSummaryLinesFromResponse_) || null;
var sendRegistrationConfirmationEmail_ = (typeof globalThis !== 'undefined' && globalThis.sendRegistrationConfirmationEmail_) || null;
var checkIsReuseChoice_ = (typeof globalThis !== 'undefined' && globalThis.checkIsReuseChoice_) || null;
var getConfigValue_ = (typeof globalThis !== 'undefined' && globalThis.getConfigValue_) || null;
var getResponseEmailValue_ = (addResponseResponseUtilsModule_ && addResponseResponseUtilsModule_.getResponseEmailValue_)
  || (typeof globalThis !== 'undefined' && globalThis.getResponseEmailValue_)
  || null;
var buildResponseFieldCopyPlan_ = (addResponseResponseUtilsModule_ && addResponseResponseUtilsModule_.buildResponseFieldCopyPlan_)
  || (typeof globalThis !== 'undefined' && globalThis.buildResponseFieldCopyPlan_)
  || null;

/**
 * Installs the form-submit trigger for a specific tracker spreadsheet. Callable from any
 * script project with access to `spreadsheet` (e.g. the Template, for a tracker it just
 * created) — installable triggers run using the code of the project that creates them, not
 * the project bound to the watched spreadsheet, so centralizing this call centralizes the
 * handler code too (ADR-010). Defaults to the active spreadsheet only for the existing
 * per-copy "Initialize Triggers" menu flow (onOpen.js), which predates centralization.
 * @param {Spreadsheet=} spreadsheet Target tracker spreadsheet. Defaults to the active spreadsheet.
 */
function setupFormSubmitTrigger(spreadsheet) {
  var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  clearFormSubmitTrigger(ss);

  ScriptApp.newTrigger(FORM_SUBMIT_HANDLER_)
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
}

/**
 * Removes any existing form-submit trigger for a specific tracker spreadsheet only.
 * Scoped by getTriggerSourceId() so that once trigger setup is centralized on the
 * Template, clearing one tracker's trigger never touches another tracker's.
 * @param {Spreadsheet=} spreadsheet Target tracker spreadsheet. Defaults to the active spreadsheet.
 */
function clearFormSubmitTrigger(spreadsheet) {
  var ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId();
  var toRemove = [FORM_SUBMIT_HANDLER_, LEGACY_FORM_SUBMIT_HANDLER_];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (toRemove.indexOf(trigger.getHandlerFunction()) !== -1 && trigger.getTriggerSourceId() === ssId) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getTrackerStartDate_(trackerSheet) {
  if (!trackerSheet || typeof trackerSheet.getLastColumn !== 'function') return null;

  var lastColumn = trackerSheet.getLastColumn();
  if (lastColumn < 9) return null;

  var rowValues = trackerSheet.getRange(3, 9, 1, lastColumn - 8).getValues()[0];
  for (var i = 0; i < rowValues.length; i++) {
    var value = rowValues[i];
    if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
    var text = String(value || '').trim();
    if (!text) continue;
    var parsed = new Date(text);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function formatRegistrationMonth_(startDate) {
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) return '';
  return REGISTRATION_MONTH_NAMES_[startDate.getMonth()] + ' ' + startDate.getFullYear();
}

function maybeSendRegistrationConfirmation_(spreadsheet, trackerSheet, responseColumns, formResponses, responseHeaders) {
  if (typeof sendRegistrationConfirmationEmail_ !== 'function' || typeof buildGoalSummaryLinesFromResponse_ !== 'function') {
    return false;
  }

  var reuseTriggerConfig = typeof getConfigValue_ === 'function' ? getConfigValue_(spreadsheet, 'Reuse Goals Trigger') : null;
  var reuseTriggerPhrase = reuseTriggerConfig && (reuseTriggerConfig.primary || reuseTriggerConfig.secondary) || '';
  var participation = getResponseValue_(formResponses, responseColumns, 'PARTICIPATION');
  if (typeof checkIsReuseChoice_ === 'function' && checkIsReuseChoice_(participation, reuseTriggerPhrase)) {
    return false;
  }

  var startDate = getTrackerStartDate_(trackerSheet);
  var registrationMonth = formatRegistrationMonth_(startDate);
  if (!registrationMonth) {
    GasLogger.log('formSubmit.registrationConfirmationSkipped', { reason: 'tracker_start_date_unavailable' });
    return false;
  }

  var email = typeof getResponseEmailValue_ === 'function'
    ? getResponseEmailValue_(formResponses, responseColumns, responseHeaders)
    : getResponseValue_(formResponses, responseColumns, 'EMAIL');
  if (!email) return false;

  var trackerUrl = spreadsheet.getUrl() + '#gid=' + trackerSheet.getSheetId();
  sendRegistrationConfirmationEmail_(
    spreadsheet,
    email,
    getResponseValue_(formResponses, responseColumns, 'F3_NAME'),
    trackerUrl,
    spreadsheet.getFormUrl ? (spreadsheet.getFormUrl() || '') : '',
    buildGoalSummaryLinesFromResponse_(formResponses, responseColumns, responseHeaders),
    registrationMonth
  );
  return true;
}

function handleFormSubmit_(e) {
  return GasLogger.run('handleFormSubmit_', function() {
    if (!runWithLock(function() { onFormSubmitLocked_(e); })) {
      GasLogger.log('handleFormSubmit_', { result: 'lock_timeout', event: JSON.stringify(e) });
    }
  });
}

/**
 * Resolves the spreadsheet a form-submit event landed in directly from the event's own
 * range, rather than assuming the handler runs bound to the target spreadsheet (ADR-010).
 * This is always unambiguous — e.range belongs to exactly one spreadsheet, the one whose
 * trigger fired — unlike SpreadsheetApp.getActiveSpreadsheet(), which is meaningless once
 * the handler runs centrally from the Template's script project.
 * @param {Object} e Form-submit event object (forSpreadsheet().onFormSubmit()).
 * @returns {Spreadsheet}
 */
function resolveFormSubmitSpreadsheet_(e) {
  return e.range.getSheet().getParent();
}

/**
 * Maps a processed form-submission row (form column order) into the Responses sheet
 * (template column order) and appends it. Returns the 1-based row number of the appended row.
 */
function appendToResponsesSheet_(responsesSheet, formResponses, formColumns) {
  var responsesColumns = resolveResponseColumns(responsesSheet);
  var responsesRow = new Array(responsesSheet.getLastColumn()).fill('');
  if (typeof buildResponseFieldCopyPlan_ === 'function') {
    buildResponseFieldCopyPlan_(formColumns, formResponses, responsesColumns).forEach(function(item) {
      if (item.targetIndex < responsesRow.length) responsesRow[item.targetIndex] = item.value;
    });
  }
  responsesSheet.appendRow(responsesRow);
  return responsesSheet.getLastRow();
}

function onFormSubmitLocked_(e) {
  var sheet = resolveFormSubmitSpreadsheet_(e);
  // formSubmitSheet: the form destination sheet created by setDestination — resolved from
  // e.range so this handler works centrally from the Template project (ADR-010).
  var formSubmitSheet = e.range.getSheet();
  var responsesSheet = sheet.getSheetByName('Responses');
  var destinationSheet = sheet.getSheetByName('Tracker');

  if (!responsesSheet || !destinationSheet) {
    GasLogger.log('formSubmit.missingSheet', { responsesFound: !!responsesSheet, trackerFound: !!destinationSheet });
    return;
  }

  // Resolve columns from the form destination sheet — its header order matches the submitted row.
  var responseColumns = resolveResponseColumns(formSubmitSheet);
  var responseHeaders = formSubmitSheet.getRange(1, 1, 1, formSubmitSheet.getLastColumn()).getValues()[0];

  // Use e.range to identify the exact submitted row, avoiding getLastRow() race with concurrent submissions.
  var submittedRowNumber = e.range.getRow();
  var formResponses = e.range.getValues()[0];

  // Guard: email and F3 name must be present — a row without them cannot be processed.
  var submittedEmail = typeof getResponseEmailValue_ === 'function'
    ? getResponseEmailValue_(formResponses, responseColumns, responseHeaders)
    : formResponses[responseColumns.EMAIL];
  if (!submittedEmail || !formResponses[responseColumns.F3_NAME]) {
    GasLogger.log('formSubmit.missingRequiredFields', {});
    return;
  }

  // Phase 1 — Reuse last month's goals if the participant requested it.
  // Passes formSubmitSheet so in-place updates land on the row where e.range lives.
  // Returns formResponses unchanged when reuse was not selected.
  formResponses = maybeReuseLastMonthsGoals_(sheet, formSubmitSheet, submittedRowNumber, formResponses);
  maybeSendRegistrationConfirmation_(sheet, destinationSheet, responseColumns, formResponses, responseHeaders);

  // Phase 3 — Resolve Team: if TEAM is blank but OTHER_TEAM is set, promote OTHER_TEAM → TEAM.
  // Runs after reuse so it applies whether data came from this submission or last month's.
  // Writes back to formSubmitSheet (the authoritative submitted row).
  var otherTeamVal = getResponseValue_(formResponses, responseColumns, 'OTHER_TEAM');
  if (!getResponseValue_(formResponses, responseColumns, 'TEAM') && otherTeamVal) {
    formResponses[responseColumns.TEAM] = otherTeamVal;
    formSubmitSheet.getRange(submittedRowNumber, responseColumns.TEAM + 1).setValue(otherTeamVal);
    GasLogger.log('formSubmit.teamPromoted', { otherTeam: otherTeamVal });
  }

  // Append the processed row to Responses (template column order) — Goals by HIM/AO read here.
  var f3Name = getResponseValue_(formResponses, responseColumns, 'F3_NAME');
  var appendedRowNumber = appendToResponsesSheet_(responsesSheet, formResponses, responseColumns);

  // Phase 2 — Dedup Responses sheet using the just-appended row as the keeper.
  // Keyed on F3 Name (not email) per ADR-008 — allows a PAX to change their email address.
  GasLogger.log('formSubmit.dedupStart', { submittedRow: appendedRowNumber, f3Name: f3Name });
  var responsesColumns = resolveResponseColumns(responsesSheet);
  deduplicateResponsesSheet_(responsesSheet, appendedRowNumber, f3Name, responsesColumns);

  // Phase 4 — Write to Tracker.
  var trackerLastRow = destinationSheet.getLastRow();
  if (trackerLastRow < 4) {
    GasLogger.log('formSubmit.trackerTooFewRows', { rows: trackerLastRow });
    return;
  }

  var lastColumn = destinationSheet.getLastColumn();
  var dataRange = destinationSheet.getRange(4, 1, trackerLastRow - 3, 1);
  var dataValues = dataRange.getValues();
  var f3NameExists = dataValues.some(function(row) { return row[0] === f3Name; });

  if (f3NameExists) {
    GasLogger.log('formSubmit.trackerDuplicate', { row: submittedRowNumber, f3Name: f3Name });
  } else {
    // Find first empty slot in column A (rows 4+), falling back to next row after last.
    var emptyIdx = dataValues.findIndex(function(row) { return row[0] === ''; });
    var nextRow = emptyIdx === -1 ? trackerLastRow + 1 : 4 + emptyIdx;

    destinationSheet.getRange(nextRow, 1).setValue(f3Name);

    if (nextRow > 4) {
      var rangeToCopy = destinationSheet.getRange(nextRow - 1, 2, 1, lastColumn - 1);
      var targetRange = destinationSheet.getRange(nextRow, 2, 1, lastColumn - 1);
      rangeToCopy.copyTo(targetRange);
    }

    // Clear manually-entered numbers so copied formula rows start clean.
    var rowRange = destinationSheet.getRange(nextRow, 1, 1, lastColumn);
    var rowValues = rowRange.getValues()[0];
    var rowFormulas = rowRange.getFormulas()[0];
    var clearRanges = [];
    for (var i = 0; i < lastColumn; i++) {
      if (!rowFormulas[i] && typeof rowValues[i] === 'number') {
        clearRanges.push(destinationSheet.getRange(nextRow, i + 1).getA1Notation());
      }
    }
    if (clearRanges.length > 0) {
      destinationSheet.getRangeList(clearRanges).clearContent();
    }

    // Re-read last row so the newly inserted row is included in the sort range.
    trackerLastRow = destinationSheet.getLastRow();
    GasLogger.log('formSubmit.processed', { row: nextRow });
  }

  // Phase 5 — Sort Tracker and log the activity.
  var rangeToSort = destinationSheet.getRange(4, 1, trackerLastRow - 3, lastColumn);
  rangeToSort.sort([{column: 2, ascending: true}, {column: 1, ascending: true}]);

  logActivity('Response', f3Name);
}

/**
 * Returns the 1-based row numbers of Responses rows that match keyValue but are NOT
 * the submitted row, sorted descending so callers can delete them highest-first without
 * index drift.
 *
 * keyValues: output of getRange(...).getValues() — array of single-column rows,
 *            where index 0 corresponds to sheet row 2 (first data row after header).
 */
function findDuplicateResponseRows_(keyValues, submittedRowNumber, keyValue) {
  var normKey = String(keyValue || '').trim().toLowerCase();
  if (!normKey) return [];

  var toDelete = [];
  for (var i = 0; i < keyValues.length; i++) {
    var rowNum = i + 2; // i=0 → sheet row 2
    if (rowNum === submittedRowNumber) continue;
    if (String(keyValues[i][0] || '').trim().toLowerCase() === normKey) {
      toDelete.push(rowNum);
    }
  }
  return toDelete.sort(function(a, b) { return b - a; });
}

function removeDuplicateResponseRow_(responsesSheet, rowNumber, responseColumns) {
  try {
    responsesSheet.getRange(rowNumber, responseColumns.PARTICIPATION + 1).setValue('DELETED');
    return 'marked_deleted';
  } catch (e) {
    GasLogger.log('formSubmit.markDuplicateFailed', { row: rowNumber, error: e && e.message });
    responsesSheet.deleteRow(rowNumber);
    return 'deleted';
  }
}

/**
 * Removes prior Responses rows whose F3 Name matches f3Name, keeping only submittedRowNumber.
 * Keyed on F3 Name per ADR-008. Rows are marked DELETED highest-row-first to avoid mutating
 * the linked form response sheet structure during submit handling; deleteRow is a fallback.
 */
function deduplicateResponsesSheet_(responsesSheet, submittedRowNumber, f3Name, responseColumns) {
  if (!f3Name) return;
  var lastRow = responsesSheet.getLastRow();
  if (lastRow < 3) return; // header + submitted row only — nothing else to check

  var f3NameColNum = responseColumns.F3_NAME + 1; // 1-based column for getRange
  var keyValues = responsesSheet.getRange(2, f3NameColNum, lastRow - 1, 1).getValues();
  GasLogger.log('formSubmit.dedupScan', { rows: keyValues.map(function(row, idx) {
    return (idx + 2) + '="' + String(row[0] || '') + '"';
  }) });
  var toDelete = findDuplicateResponseRows_(keyValues, submittedRowNumber, f3Name);
  GasLogger.log('formSubmit.dedupMatches', { submittedRow: submittedRowNumber, f3Name: f3Name, toDelete: toDelete });

  for (var j = 0; j < toDelete.length; j++) {
    var action = removeDuplicateResponseRow_(responsesSheet, toDelete[j], responseColumns);
    GasLogger.log('formSubmit.responseDeduplicated', { removedRow: toDelete[j], keptRow: submittedRowNumber, action: action, f3Name: f3Name });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findDuplicateResponseRows_,
    removeDuplicateResponseRow_,
    deduplicateResponsesSheet_,
    getTrackerStartDate_,
    formatRegistrationMonth_,
    maybeSendRegistrationConfirmation_,
    appendToResponsesSheet_,
    onFormSubmitLocked_,
    resolveFormSubmitSpreadsheet_,
    setupFormSubmitTrigger,
    clearFormSubmitTrigger
  };
}
