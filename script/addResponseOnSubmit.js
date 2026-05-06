// Named with trailing underscore so GAS does not auto-register it as a simple trigger.
var FORM_SUBMIT_HANDLER_ = 'handleFormSubmit_';

/**
 * Manages triggers for a Google Sheets project by removing any existing form-submit triggers to avoid duplicates,
 * then creates a new installable trigger for form submission processing.
 */
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
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() == FORM_SUBMIT_HANDLER_) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Triggered by form submissions, this adds the most recent PAX entry to the Tracker sheet following these steps:
 * 1. Verifies there are at least seven form response fields to proceed.
 * 2. Checks for duplicates by ensuring the F3 Name (field index 3) doesn't already exist in the "Tracker" sheet.
 * 3. Records the unique response in the first empty row of the "Tracker" sheet.
 * 4. Copies formulas and formatting from the previous row to the new row to maintain consistency.
 * 5. Sorts the "Tracker" sheet based on a specified column to organize the data efficiently.
 */
function handleFormSubmit_(e) {
  if (!runWithLock(function() { onFormSubmitLocked_(e); })) {
    Logger.log('handleFormSubmit_: lock timeout — event: ' + JSON.stringify(e));
  }
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
  var formResponses = e.range.getValues()[0];

  // Guard: email and F3 name must be present — a row without them cannot be processed.
  if (!formResponses[responseColumns.EMAIL] || !formResponses[responseColumns.F3_NAME]) {
    Logger.log('handleFormSubmit_: submitted row missing EMAIL or F3_NAME — skipping');
    return;
  }

  formResponses = maybeReuseLastMonthsGoals_(sheet, responsesSheet, e.range.getRow(), formResponses);

  var f3Name = getResponseValue_(formResponses, responseColumns, 'F3_NAME');
    
  // If Column F (team) is empty, log the assumed value from Column G — do not mutate the Responses sheet
  if (!getResponseValue_(formResponses, responseColumns, 'TEAM')) {
    Logger.log("Assuming team is " + getResponseValue_(formResponses, responseColumns, 'GOAL_SELECTION'));
  }

  // Guard: Tracker must have at least 4 rows before range operations are safe
  var trackerLastRow = destinationSheet.getLastRow();
  if (trackerLastRow < 4) {
    Logger.log("onFormSubmit: Tracker has " + trackerLastRow + " rows — need at least 4 to process. Skipping.");
    return;
  }

  var lastColumn = destinationSheet.getLastColumn();

  // Always read column-A data from row 4 down — used for both duplicate detection and
  // first-empty-row placement. A single read serves both, regardless of ManagedSheet availability.
  var dataRange = destinationSheet.getRange(4, 1, trackerLastRow - 3, 1);
  var dataValues = dataRange.getValues();

  var f3NameExists = dataValues.some(function(row) { return row[0] === f3Name; });

  if (f3NameExists) {
    Logger.log("f3Name already exists in the Tracker sheet.");
  } else {
    // Find first empty slot in column A (rows 4+), falling back to next row after last.
    var emptyIdx = dataValues.findIndex(function(row) { return row[0] === ""; });
    var nextRow = emptyIdx === -1 ? trackerLastRow + 1 : 4 + emptyIdx;

    // Always use setValue at nextRow — ManagedSheet.appendRow ignores the computed position.
    destinationSheet.getRange(nextRow, 1).setValue(f3Name);

    // Copy formulas and formatting from the last filled row to the new row for columns B through the last column
    if (nextRow > 4) {
      var rangeToCopy = destinationSheet.getRange(nextRow - 1, 2, 1, lastColumn - 1);
      var targetRange = destinationSheet.getRange(nextRow, 2, 1, lastColumn - 1);
      rangeToCopy.copyTo(targetRange);
    }

    // Clear the PAX entered numbers. Batch clears into a single RangeList call.
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

    // Re-read last row so the newly inserted PAX row is included in the sort range
    trackerLastRow = destinationSheet.getLastRow();
  }

  var rangeToSort = destinationSheet.getRange(4, 1, trackerLastRow - 3, lastColumn);
  rangeToSort.sort([{column: 2, ascending: true}, {column: 1, ascending: true}]);

  logActivity('Response',f3Name);

}
