
/**
 * Returns the Drive file ID for the LogFile, creating it if necessary.
 *
 * Reads the Config sheet for a 'LogFile' row (Column A). If Column B is empty
 * or missing, creates a new plain-text Drive file named 'F3Go30-LogFile' with
 * 'anyone with the link' read permissions, writes the URL back to Config Column B,
 * and returns the new file ID. If a URL already exists, extracts and returns its ID.
 *
 * @returns {string} Drive file ID.
 */
function getOrCreateLogFile_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('Config');
  if (!configSheet) throw new Error('getOrCreateLogFile: Config sheet not found');

  const data = configSheet.getDataRange().getValues();
  let logFileRowIdx = -1;
  let existingUrl = '';
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === 'LogFile') {
      logFileRowIdx = i + 1; // 1-indexed for Sheets range API
      existingUrl = String(data[i][1] || '').trim();
      break;
    }
  }

  if (existingUrl) {
    const m = existingUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  }

  // Create plain-text file; Drive places it in root by default
  const file = DriveApp.createFile('F3Go30-LogFile', '', MimeType.PLAIN_TEXT);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.READ);
  const fileUrl = file.getUrl();
  const fileId = file.getId();

  if (logFileRowIdx > 0) {
    configSheet.getRange(logFileRowIdx, 2).setValue(fileUrl);
  } else {
    configSheet.appendRow(['LogFile', fileUrl]);
  }
  SpreadsheetApp.flush();

  return fileId;
}

/**
 * Appends a structured log entry to the LogFile.
 *
 * Entry format (each call appends):
 *   === <ISO-8601 timestamp> <triggerName> ===
 *   <JSON.stringify(payload, null, 2)>
 *   <blank line>
 *
 * Uses the Drive REST API via UrlFetchApp to overwrite file content with
 * existing content + new entry (Drive plain-text files have no native append).
 *
 * @param {string} fileId      Drive file ID returned by getOrCreateLogFile_.
 * @param {string} triggerName Label for this log entry (e.g. 'copyAndInit').
 * @param {Object} payload     Plain JS object; serialised as indented JSON.
 */
function appendToLogFile_(fileId, triggerName, payload) {
  const ts = new Date().toISOString();
  const entry = '=== ' + ts + ' ' + triggerName + ' ===\n' +
    JSON.stringify(payload, null, 2) + '\n\n';

  const file = DriveApp.getFileById(fileId);
  const existing = file.getBlob().getDataAsString();
  const newContent = existing + entry;

  UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media',
    {
      method: 'PATCH',
      contentType: 'text/plain; charset=UTF-8',
      payload: newContent,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    }
  );
}
