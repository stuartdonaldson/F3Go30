function logActivity(message, sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Activity');
  
  // Check if the 'Activity' sheet exists, if not, create it
  if (!sheet) {
    sheet = ss.insertSheet('Activity');
    
    // Set the header in the first row
    var header = ['Datetime', 'User', 'Message', 'Sheetname'];
    sheet.getRange('A1:D1').setValues([header]);
    
    // Format the header row
    sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#ADD8E6'); // Light blue background
  }
  sheet.hideSheet(); // keep the activity sheet out of site.
  
  // Insert a new row after the header
  sheet.insertRowAfter(1);
  
  // Clear any formatting that may have been inherited from the header row
  sheet.getRange('A2:D2').clearFormat();
  
  // Get the current datetime and user email
  var datetime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var userEmail = Session.getActiveUser().getEmail();
  
  // Populate the row with the datetime, user email, message, and sheetname
  sheet.getRange('A2').setValue(datetime);
  sheet.getRange('B2').setValue(userEmail);
  sheet.getRange('C2').setValue(message);
  sheet.getRange('D2').setValue(sheetName);
  
  // Auto-resize the columns for better readability
  sheet.autoResizeColumns(1, 4);
}
