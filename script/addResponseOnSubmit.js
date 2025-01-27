/**
 * Manages triggers for a Google Sheets project by removing any existing 'onFormSubmit' triggers to avoid duplicates,
 * then creates a new trigger that executes the 'onFormSubmit' function whenever a form is submitted.
 * This setup ensures the spreadsheet has only one active trigger for form submission processing.
 */
function setupFormSubmitTrigger() {
  clearFormSubmitTrigger();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Create a new form submit trigger for the 'onFormSubmit' function.
  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
}

function clearFormSubmitTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() == 'onFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Triggered by form submissions, this adds the most recent PAX entry to the Tracker sheet following these steps:
 * 1. Verifies there are at least four responses to proceed.
 * 2. Checks for duplicates by ensuring the specific response (the fourth one) doesn't already exist in the "Tracker" sheet.
 * 3. Records the unique response in the first empty row of the "Tracker" sheet.
 * 4. Copies formulas and formatting from the previous row to the new row to maintain consistency.
 * 5. Sorts the "Tracker" sheet based on a specified column to organize the data efficiently.
 */
function onFormSubmit(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet(); // Get the active spreadsheet
  var responsesSheet = sheet.getSheetByName("Responses"); // Adjust based on actual use-case
  var destinationSheet = sheet.getSheetByName("Tracker");

  // Check if there are enough responses
  var lastRow = responsesSheet.getLastRow();
  var formResponses = responsesSheet.getRange(lastRow, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  if (formResponses.length < 4) { // Check if there are at least 4 responses
    Logger.log("Not enough responses.");
    return; // Exit the function if not enough responses
  }

  var f3Name = formResponses[3]; // Get the fourth response
    
  // Check if Column F (index 5) is empty and place the value of Column G (index 6) into Column F if so
  if (!formResponses[5]) { // If Column F is empty
    Logger.log("Assuming team is " + formResponses[6]);
    responsesSheet.getRange(lastRow, 6).setValue(formResponses[6]); // Update the sheet with the new value in Column F
  }

  // Search for f3Name in the Tracker sheet to avoid duplicates
  var dataRange = destinationSheet.getRange(4, 1, destinationSheet.getLastRow() - 3, 1); // Adjust range to search in column A, starting from row 4
  var lastColumn = destinationSheet.getLastColumn();

  var dataValues = dataRange.getValues();
  var f3NameExists = dataValues.some(function(row) { return row[0] === f3Name; });

  if (f3NameExists) {
    Logger.log("f3Name already exists in the Tracker sheet.");
  } else {
    // Find the first empty row in column A, starting from row 3
    var nextRow = 3; // Start searching from row 3
    while (destinationSheet.getRange(nextRow, 1).getValue() !== "") {
      nextRow++;
    }


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
    var rowValues = destinationSheet.getRange(nextRow, 1, 1, lastColumn).getValues()[0];
    var rowFormulas = destinationSheet.getRange(nextRow, 1, 1, lastColumn).getFormulas()[0];
    for (var i = 0; i < lastColumn; i++) {
      if (!rowFormulas[i] && typeof rowValues[i] === 'number') {
        destinationSheet.getRange(nextRow, i + 1).clearContent();
      }
    }
  }

    // Sort the table by the AO in column B, considering the header is in row 3
  var rangeToSort = destinationSheet.getRange(4, 1, destinationSheet.getLastRow() - 3, lastColumn); // Adjust range to exclude header row
  rangeToSort.sort([{column: 2, ascending: true}, {column: 1, ascending: true}]);

  logActivity('Response',f3Name);

}
