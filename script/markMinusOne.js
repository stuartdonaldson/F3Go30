function setupDailyMinusOneTrigger() {
  clearDailyMinusOne();
  
  // Create a new daily trigger for markEmptyCellsAsMinusOne
  ScriptApp.newTrigger('markEmptyCellsAsMinusOne')
    .timeBased()
    .everyDays(1) // Set to trigger daily
    .inTimezone(Session.getScriptTimeZone()) // Use the correct method to get the script's time zone
    .atHour(1) // Specify the hour (1 AM)
    .nearMinute(0) // You can use this to specify the minute, but it's not precise in the hour range
    .create();
}

function clearDailyMinusOne() {
    // First, delete existing triggers for the function to avoid duplicates
  var existingTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === 'markEmptyCellsAsMinusOne') {
      ScriptApp.deleteTrigger(existingTriggers[i]);
    }
  }
}
function markEmptyCellsAsMinusOne() {
  var sheetName = "Tracker";
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (sheet) {
    var currentDate = new Date();
    var currentDateString = Utilities.formatDate(currentDate, sheet.getParent().getSpreadsheetTimeZone(), "MM/dd/yyyy");

    // Calculate the date for thresholdday - Day before yesterday.
    var thresholdday = new Date(currentDate);
    thresholdday.setDate(thresholdday.getDate() - 2);
    var thresholddayString = Utilities.formatDate(thresholdday, sheet.getParent().getSpreadsheetTimeZone(), "MM/dd/yyyy");
    
    // Check if the time is it's past 10:00 AM today
    var ok2run = true; // use time based at 2am to run at night.  Was currentDate.getHours() >= 10;

    // Find the column index with thresholdday's date
    var lastColumnIndex = sheet.getLastColumn();
    var thresholddayColumnIndex = -2;

    for (var i = 1; i <= lastColumnIndex; i++) {
      var cellValue = sheet.getRange(3, i).getValue();

      if (cellValue instanceof Date) {
        var cellDateString = Utilities.formatDate(cellValue, sheet.getParent().getSpreadsheetTimeZone(), "MM/dd/yyyy");

        if (cellDateString === thresholddayString) {
          thresholddayColumnIndex = i;
          break;
        }
      }
    }

    if (thresholddayColumnIndex > 1 && ok2run) {
      var dataRange = sheet.getRange(4, thresholddayColumnIndex, sheet.getLastRow() - 3, 1); 
      var values = dataRange.getValues();

      // Iterate through the data in thresholdday's column and mark empty cells as -1 for rows with F3 Name
      for (var j = 0; j < values.length; j++) {
        if (values[j][0] === '') {
          var f3NameValue = sheet.getRange(j + 4, 1).getValue();
          if (f3NameValue !== '') {
            values[j][0] = -1;
          }
        }
      }

      dataRange.setValues(values);
    }
  }
}
