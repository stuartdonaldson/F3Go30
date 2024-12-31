function test() {
  logCellColor("M2");
  logCellColor("M3");
  logCellColor("N2");
  logCellColor("N3");
}

function logCellColor(cellReference) {
  // Get the active sheet from the active spreadsheet
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Get the range from the passed-in cell reference
  var cell = sheet.getRange(cellReference);
  
  // Get the background color of the cell
  var color = cell.getBackground();
  
  // Log the color to the Google Apps Script console
  Logger.log('The background color of cell ' + cellReference + ' is: ' + color);
}

function getLockedRowA1Notation(sheet, row, column) {
  var cellNotation = sheet.getRange(row, column).getA1Notation();
  
  // Extract the column letter(s) and row number from the A1 notation
  var match = cellNotation.match(/([A-Z]+)(\d+)/);
  var columnLetters = match[1];
  var rowNumber = match[2];
  
  // Create a new A1 notation with the row number locked
  var lockedRowNotation = columnLetters + "$" + rowNumber;
  
  return lockedRowNotation;
}
