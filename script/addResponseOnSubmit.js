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

  // Phase 1 — Reuse last month's goals if the participant requested it.
  // Returns formResponses unchanged when reuse was not selected.
  formResponses = maybeReuseLastMonthsGoals_(sheet, responsesSheet, submittedRowNumber, formResponses);

  // Phase 2 — Dedup Responses sheet: remove any prior row for the same F3 Name so that
  // sheets querying Responses (Goals by HIM, Goals by AO) show only the latest submission.
  // Keyed on F3 Name (not email) per ADR-008 — allows a PAX to change their email address.
  var f3Name = getResponseValue_(formResponses, responseColumns, 'F3_NAME');
  Logger.log('handleFormSubmit_: dedup start — submittedRow: ' + submittedRowNumber + ', f3Name: "' + f3Name + '"');
  deduplicateResponsesSheet_(responsesSheet, submittedRowNumber, f3Name, responseColumns);

  // Phase 3 — Resolve Team: if the Team column is blank, log the inferred value from Other team name.
  if (!getResponseValue_(formResponses, responseColumns, 'TEAM')) {
    Logger.log('handleFormSubmit_: Team blank — inferred from Other team name: ' + getResponseValue_(formResponses, responseColumns, 'OTHER_TEAM'));
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
    Logger.log('handleFormSubmit_: mark duplicate Responses row failed for row ' + rowNumber + ' — falling back to deleteRow: ' + (e && e.message));
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
  Logger.log('handleFormSubmit_: dedup scan — rows: ' + keyValues.map(function(row, idx) {
    return (idx + 2) + '="' + String(row[0] || '') + '"';
  }).join(', '));
  var toDelete = findDuplicateResponseRows_(keyValues, submittedRowNumber, f3Name);
  Logger.log('handleFormSubmit_: dedup matches — submittedRow: ' + submittedRowNumber + ', f3Name: "' + f3Name + '", toDelete: [' + toDelete.join(', ') + ']');

  for (var j = 0; j < toDelete.length; j++) {
    var action = removeDuplicateResponseRow_(responsesSheet, toDelete[j], responseColumns);
    Logger.log('handleFormSubmit_: ' + action + ' prior Responses row ' + toDelete[j] + ' for F3 Name "' + f3Name + '" (kept: ' + submittedRowNumber + ')');
    GasLogger.log('formSubmit.responseDeduplicated', { removedRow: toDelete[j], keptRow: submittedRowNumber, action: action });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findDuplicateResponseRows_, removeDuplicateResponseRow_, deduplicateResponsesSheet_ };
}
