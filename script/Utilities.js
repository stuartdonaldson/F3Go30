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
 * @param {Spreadsheet} spreadsheet - Required when data is not provided.
 * @param {string} variableName - Value to match in column A.
 * @param {Array[][]=} data - Optional pre-fetched Config sheet values (avoids a sheet read when
 *   doing multiple lookups; pass the result of configSheet.getDataRange().getValues()).
 * @returns {{primary: *, secondary: *}|null} Matched row values, or null if not found.
 */
function getConfigValue_(spreadsheet, variableName, data) {
  const rows = data || (() => {
    const sheet = spreadsheet.getSheetByName('Config');
    return sheet ? sheet.getDataRange().getValues() : null;
  })();
  if (!rows) return null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === variableName) {
      return { primary: rows[i][1], secondary: rows[i][2] };
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
