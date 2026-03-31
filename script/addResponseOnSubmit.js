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
  var sheet = SpreadsheetApp.getActiveSpreadsheet(); // Get the active spreadsheet
  var responsesSheet = sheet.getSheetByName("Responses"); // Adjust based on actual use-case
  var destinationSheet = sheet.getSheetByName("Tracker");

  if (!responsesSheet || !destinationSheet) {
    Logger.log('handleFormSubmit_: required sheet not found — Responses: ' + !!responsesSheet + ', Tracker: ' + !!destinationSheet);
    return;
  }

  // Use e.range to identify the exact submitted row, avoiding getLastRow() race with concurrent submissions
  var formResponses = e.range.getValues()[0];
  if (formResponses.length < 7) { // Check if there are at least 7 responses (indices 0-6 required)
    Logger.log("Not enough responses.");
    return; // Exit the function if not enough responses
  }

  var f3Name = formResponses[3]; // Get the fourth response
    
  // If Column F (team) is empty, log the assumed value from Column G — do not mutate the Responses sheet
  if (!formResponses[5]) {
    Logger.log("Assuming team is " + formResponses[6]);
  }

  // Guard: Tracker must have at least 4 rows before range operations are safe
  var trackerLastRow = destinationSheet.getLastRow();
  if (trackerLastRow < 4) {
    Logger.log("onFormSubmit: Tracker has " + trackerLastRow + " rows — need at least 4 to process. Skipping.");
    return;
  }

  // Search for f3Name in the Tracker sheet to avoid duplicates
  var dataRange = destinationSheet.getRange(4, 1, trackerLastRow - 3, 1); // Adjust range to search in column A, starting from row 4
  var lastColumn = destinationSheet.getLastColumn();

  var dataValues = dataRange.getValues();
  var f3NameExists = dataValues.some(function(row) { return row[0] === f3Name; });

  if (f3NameExists) {
    Logger.log("f3Name already exists in the Tracker sheet.");
  } else {
    // Find the first empty row in column A using the already-fetched dataValues — no extra API calls
    var emptyIdx = dataValues.findIndex(function(row) { return row[0] === ""; });
    var nextRow = emptyIdx === -1 ? trackerLastRow + 1 : 4 + emptyIdx;


    // Set the F3 Name in the found row
    destinationSheet.getRange(nextRow, 1).setValue(f3Name); // Append the F3 Name

    // Copy formulas and formatting from the last filled row to the new row for columns B through the last column
    // if we add a row, then fill the previous row down.
    if (nextRow > 4) {
        var rangeToCopy = destinationSheet.getRange(nextRow - 1, 2, 1, lastColumn - 1);
        var targetRange = destinationSheet.getRange(nextRow, 2, 1, lastColumn - 1);
        rangeToCopy.copyTo(targetRange); // This copies both the formulas and formatting

        // If you need to only copy formulas or formatting, you can specify that with the options in copyTo method
        // For example, to copy only the formatting:
        // rangeToCopy.copyFormatToRange(destinationSheet, 2, lastColumn, nextRow, nextRow);
    }

    // Clear the PAX entered numbers.  These should be numeric values that are not formulas.
    // Batch the clears into a single RangeList call instead of one API call per cell.
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
