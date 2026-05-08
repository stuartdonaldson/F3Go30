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
  if (data) {
    return ManagedConfigSheet.findValue(variableName, data);
  }
  if (!spreadsheet) {
    return null;
  }

  const config = openConfigSheet(spreadsheet);
  if (!config) {
    return null;
  }

  return config.getValue(variableName);
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

/**
 * Developer test: exercises GasLogger behavioral scenarios and writes to Drive.
 * Run from the GAS editor, then verify with: python test/test_gas_logger_live.py
 *
 * Sets F3GO30_TEST_RUN_ID='gaslogger-test' so the local verifier can filter entries.
 */
function testGasLogger() {
  PropertiesService.getScriptProperties().setProperty('F3GO30_TEST_RUN_ID', 'gaslogger-test');
  GasLogger.init('testGasLogger');

  // AC2: Normal run — two entries flushed together into one Drive file.
  GasLogger.log('normal.first', { scenario: 'normal' });
  GasLogger.log('normal.second', { scenario: 'normal' });
  GasLogger.flush();

  // AC3: Inline flush — entry written to Drive immediately.
  GasLogger.log('inline.flush', { scenario: 'inline' }, true);

  // AC4: newLog reset — newlog.before and newlog.after land in separate Drive files.
  GasLogger.log('newlog.before', { scenario: 'newlog' }, true, true);
  GasLogger.log('newlog.after', { scenario: 'newlog' }, true);

  Logger.log('[testGasLogger_] complete — check Drive folder for runId=gaslogger-test');
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
