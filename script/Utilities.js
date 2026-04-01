/**
 * Escapes HTML special characters in a string to prevent XSS when embedding
 * user-controlled values in innerHTML or HTML attribute values.
 */
function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

/**
 * Builds the standard Slack copy-paste message for a new monthly tracker.
 * @param {number} year - Full year (e.g. 2026).
 * @param {string} month - Long month name (e.g. 'April').
 * @param {string} formUrl - HC form URL (TinyURL preferred).
 * @param {string} trackerUrl - Tracker sheet URL (TinyURL preferred).
 * @returns {string} Slack message text.
 */
function buildSlackMessage_(year, month, formUrl, trackerUrl) {
  const prefix = year + ' ' + month;
  return prefix + ' Hard Commit Signup form is up:\n' + formUrl + '\n\n' + prefix + ' Tracker:\n' + trackerUrl;
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
