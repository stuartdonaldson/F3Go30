var ACTIVITY_MAX_ROWS_ = 500; // prune oldest rows when this is exceeded

function logActivity(message, sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Activity');

  if (!sheet) {
    sheet = ss.insertSheet('Activity');
    sheet.getRange('A1:D1').setValues([['Datetime', 'User', 'Message', 'Sheetname']]);
    sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#ADD8E6');
    sheet.hideSheet();
  } else if (!sheet.isSheetHidden()) {
    // Only hide when visible — avoids a redundant API call on every invocation
    sheet.hideSheet();
  }

  // Prune oldest rows when the log exceeds the cap (keep header + newest rows)
  var lastRow = sheet.getLastRow();
  if (lastRow > ACTIVITY_MAX_ROWS_) {
    sheet.deleteRows(2, lastRow - ACTIVITY_MAX_ROWS_);
  }

  sheet.insertRowAfter(1);
  sheet.getRange('A2:D2').clearFormat();

  var datetime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  // getActiveUser().getEmail() returns '' in trigger context; fall back to a label
  var userEmail = Session.getActiveUser().getEmail() || '(trigger)';

  sheet.getRange('A2:D2').setValues([[datetime, userEmail, message, sheetName]]);
  sheet.autoResizeColumns(1, 4);
}
