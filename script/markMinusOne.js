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

    var row3Values = sheet.getRange(3, 1, 1, lastColumnIndex).getValues()[0];
    for (var i = 0; i < row3Values.length; i++) {
      var cellValue = row3Values[i];
      if (cellValue instanceof Date) {
        var cellDateString = Utilities.formatDate(cellValue, sheet.getParent().getSpreadsheetTimeZone(), "MM/dd/yyyy");
        if (cellDateString === thresholddayString) {
          thresholddayColumnIndex = i + 1; // convert 0-based array index to 1-based column number
          break;
        }
      }
    }

    if (thresholddayColumnIndex <= 0) {
      Logger.log('markEmptyCellsAsMinusOne: threshold day column not found for ' + thresholddayString);
    }
    if (thresholddayColumnIndex > 0 && ok2run) {
      var dataRange = sheet.getRange(4, thresholddayColumnIndex, sheet.getLastRow() - 3, 1); 
      var values = dataRange.getValues();

      // Iterate through the data in thresholdday's column and mark empty cells as -1 for rows with F3 Name
      var columnAValues = sheet.getRange(4, 1, values.length, 1).getValues();
      for (var j = 0; j < values.length; j++) {
        if (values[j][0] === '' && columnAValues[j][0] !== '') {
          values[j][0] = -1;
        }
      }

      dataRange.setValues(values);
    }
  }
}
