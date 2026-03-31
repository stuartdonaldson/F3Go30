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

/**
 * Reads a variable from the Config sheet of the given spreadsheet.
 * Config sheet schema: column A = variable name, column B = primary value, column C = secondary value.
 * @param {Spreadsheet} spreadsheet
 * @param {string} variableName - Value to match in column A.
 * @returns {{primary: *, secondary: *}|null} Matched row values, or null if not found or Config sheet absent.
 */
function getConfigValue_(spreadsheet, variableName) {
  const configSheet = spreadsheet.getSheetByName('Config');
  if (!configSheet) return null;
  const data = configSheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === variableName) {
      return { primary: data[i][1], secondary: data[i][2] };
    }
  }
  return null;
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
