// Named with trailing underscore so GAS does not auto-register it as a simple trigger.
var FORM_SUBMIT_HANDLER_ = 'handleFormSubmit_';

// Old handler name — kept here so clearFormSubmitTrigger can remove stale triggers registered
// before the handler was renamed. Safe to remove once all trackers have been re-triggered.
var LEGACY_FORM_SUBMIT_HANDLER_ = 'onFormSubmit';

function setupFormSubmitTrigger() {
  clearFormSubmitTrigger();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger(FORM_SUBMIT_HANDLER_)
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
}

function clearFormSubmitTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var toRemove = [FORM_SUBMIT_HANDLER_, LEGACY_FORM_SUBMIT_HANDLER_];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (toRemove.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function handleFormSubmit_(e) {
  GasLogger.init('handleFormSubmit_');
  if (!runWithLock(function() { onFormSubmitLocked_(e); })) {
    Logger.log('handleFormSubmit_: lock timeout — event: ' + JSON.stringify(e));
    GasLogger.log('handleFormSubmit_', { result: 'lock_timeout' });
  }
  GasLogger.flush();
}

function onFormSubmitLocked_(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  var responsesSheet = sheet.getSheetByName('Responses');
  var destinationSheet = sheet.getSheetByName('Tracker');

  if (!responsesSheet || !destinationSheet) {
    Logger.log('handleFormSubmit_: required sheet not found — Responses: ' + !!responsesSheet + ', Tracker: ' + !!destinationSheet);
    return;
  }

  // resolveResponseColumns throws fast if any required header is absent — no silent failures.
  var responseColumns = resolveResponseColumns(responsesSheet);

  // Use e.range to identify the exact submitted row, avoiding getLastRow() race with concurrent submissions.
  var submittedRowNumber = e.range.getRow();
  var formResponses = e.range.getValues()[0];

  // Guard: email and F3 name must be present — a row without them cannot be processed.
  if (!formResponses[responseColumns.EMAIL] || !formResponses[responseColumns.F3_NAME]) {
    Logger.log('handleFormSubmit_: submitted row missing EMAIL or F3_NAME — skipping');
    return;
  }

  var emailAddress = formResponses[responseColumns.EMAIL];

  // Phase 1 — Reuse last month's goals if the participant requested it.
  // Returns formResponses unchanged when reuse was not selected.
  formResponses = maybeReuseLastMonthsGoals_(sheet, responsesSheet, submittedRowNumber, formResponses);

  // Phase 2 — Dedup Responses sheet: remove any prior row for the same email so that
  // sheets querying Responses (Goals by HIM, Goals by AO) show only the latest submission.
  deduplicateResponsesSheet_(responsesSheet, submittedRowNumber, emailAddress, responseColumns);

  // Phase 3 — Resolve Team: if the Team column is blank, log the inferred value from Goal selection.
  var f3Name = getResponseValue_(formResponses, responseColumns, 'F3_NAME');
  if (!getResponseValue_(formResponses, responseColumns, 'TEAM')) {
    Logger.log('handleFormSubmit_: Team blank — inferred from Goal selection: ' + getResponseValue_(formResponses, responseColumns, 'GOAL_SELECTION'));
  }

  // Phase 4 — Write to Tracker.
  var trackerLastRow = destinationSheet.getLastRow();
  if (trackerLastRow < 4) {
    Logger.log('handleFormSubmit_: Tracker has ' + trackerLastRow + ' rows — need at least 4 to process. Skipping.');
    return;
  }

  var lastColumn = destinationSheet.getLastColumn();
  var dataRange = destinationSheet.getRange(4, 1, trackerLastRow - 3, 1);
  var dataValues = dataRange.getValues();
  var f3NameExists = dataValues.some(function(row) { return row[0] === f3Name; });

  if (f3NameExists) {
    Logger.log('handleFormSubmit_: f3Name already in Tracker — skipping Tracker write, Responses already updated.');
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
 * Returns the 1-based row numbers of Responses rows that match emailAddress but are NOT
 * the submitted row, sorted descending so callers can delete them highest-first without
 * index drift.
 *
 * emailValues: output of getRange(...).getValues() — array of [email] single-column rows,
 *              where index 0 corresponds to sheet row 2 (first data row after header).
 */
function findDuplicateResponseRows_(emailValues, submittedRowNumber, emailAddress) {
  var normEmail = String(emailAddress || '').trim().toLowerCase();
  if (!normEmail) return [];

  var toDelete = [];
  for (var i = 0; i < emailValues.length; i++) {
    var rowNum = i + 2; // i=0 → sheet row 2
    if (rowNum === submittedRowNumber) continue;
    if (String(emailValues[i][0] || '').trim().toLowerCase() === normEmail) {
      toDelete.push(rowNum);
    }
  }
  return toDelete.sort(function(a, b) { return b - a; });
}

/**
 * Removes prior Responses rows for emailAddress, keeping only submittedRowNumber.
 * Deletions go highest-row-first to avoid index drift.
 */
function deduplicateResponsesSheet_(responsesSheet, submittedRowNumber, emailAddress, responseColumns) {
  if (!emailAddress) return;
  var lastRow = responsesSheet.getLastRow();
  if (lastRow < 3) return; // header + submitted row only — nothing else to check

  var emailColNum = responseColumns.EMAIL + 1; // 1-based column for getRange
  var emailValues = responsesSheet.getRange(2, emailColNum, lastRow - 1, 1).getValues();
  var toDelete = findDuplicateResponseRows_(emailValues, submittedRowNumber, emailAddress);

  for (var j = 0; j < toDelete.length; j++) {
    Logger.log('handleFormSubmit_: removing prior Responses row ' + toDelete[j] + ' for ' + emailAddress + ' (kept: ' + submittedRowNumber + ')');
    GasLogger.log('formSubmit.responseDeduplicated', { removedRow: toDelete[j], keptRow: submittedRowNumber });
    responsesSheet.deleteRow(toDelete[j]);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findDuplicateResponseRows_ };
}
