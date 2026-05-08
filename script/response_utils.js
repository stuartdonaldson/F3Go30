/**
 * Manual admin utility — copies one participant's responses from last month's
 * tracker into the current tracker and emails them a summary.
 *
 * NOT called from the automated reuse flow (maybeReuseLastMonthsGoals_ handles
 * that). Use this when a PAX needs their data backfilled manually outside the
 * normal form-submit path.
 *
 * Usage: copyResponsesToCurrentTracker('foo@example.com')
 */
function copyResponsesToCurrentTracker(email) {
  if (!email) throw new Error('email required');

  const currentSs = SpreadsheetApp.getActiveSpreadsheet();

  const prevTrackerConfig = getConfigValue_(currentSs, 'Last Month Tracker');
  const prevTrackerUrl = String((prevTrackerConfig && (prevTrackerConfig.secondary || prevTrackerConfig.primary)) || '').trim();
  if (!prevTrackerUrl) throw new Error('Previous tracker URL not found in Config sheet Last Month Tracker');

  const prevSs = SpreadsheetApp.openByUrl(prevTrackerUrl);
  const prevResponses = prevSs.getSheetByName('Responses');
  if (!prevResponses) throw new Error('Responses sheet not found in previous tracker');

  const prevData = prevResponses.getDataRange().getValues();
  if (prevData.length < 2) throw new Error('No responses in previous tracker');

  const prevHeaders = prevData[0].map(h => String(h || '').trim());
  const prevResponseColumns = resolveResponseColumns_(prevHeaders);
  const emailColPrev = prevResponseColumns.EMAIL;
  if (emailColPrev === -1) throw new Error('Email column not found in previous Responses headers');

  let prevRowIndex = findRowIndexByNormalizedValue_(prevData, emailColPrev, email, { startRow: 1 });
  if (prevRowIndex === -1) throw new Error('Email not found in previous Responses');

  const prevRowValues = prevData[prevRowIndex];

  // Current Responses sheet
  const curResponses = currentSs.getSheetByName('Responses');
  if (!curResponses) throw new Error('Responses sheet not found in current spreadsheet');
  const curData = curResponses.getDataRange().getValues();
  if (curData.length < 2) throw new Error('No responses in current Responses sheet');

  const curHeaders = curData[0].map(h => String(h || '').trim());
  const curResponseColumns = resolveResponseColumns_(curHeaders);
  const emailColCur = curResponseColumns.EMAIL;
  if (emailColCur === -1) throw new Error('Email column not found in current Responses headers');

  let curRowIndex = findRowIndexByNormalizedValue_(curData, emailColCur, email, { startRow: 1 });
  // If the email is not present in current Responses, append a new row and use it
  if (curRowIndex === -1) {
    const newRowIdx = curData.length + 1; // 1-based rows
    curResponses.insertRowAfter(curData.length);
    curRowIndex = newRowIdx - 1; // zero-based index into curData-like arrays for later +1 conversion
  }

  // Copy values for headers that exist in both
  const copiedPairs = [];
  const copyPlan = buildSharedHeaderCopyPlan_(prevHeaders, prevRowValues, curHeaders);
  copyPlan.forEach((entry) => {
    curResponses.getRange(curRowIndex + 1, entry.targetIndex + 1).setValue(entry.value);
    copiedPairs.push({ header: entry.header, value: entry.value });
  });

  // Notify via helper
  try {
    sendResponseSettingsEmail(email, copiedPairs);
  } catch (e) {
    Logger.log('copyResponsesToCurrentTracker: failed to send email — ' + e.message);
  }

  GasLogger.log('copyResponsesToCurrentTracker', { copied: copiedPairs.length, prevTracker: prevTrackerUrl });

  return { copied: copiedPairs.length, details: copiedPairs };
}


/**
 * Sends an email to `email` summarizing the copied response settings.
 * `data` is an array of {header, value} objects.
 */
function sendResponseSettingsEmail(email, data) {
  if (!email) throw new Error('email required');
  if (!data || !Array.isArray(data)) throw new Error('data required');

  const subject = 'Your Go30 signup settings';
  let body = 'Hello,\n\nThe following signup settings were copied into the current tracker for your account:\n\n';
  data.forEach(d => {
    body += d.header + ': ' + (d.value === undefined || d.value === null ? '' : String(d.value)) + '\n';
  });
  body += '\nIf any value looks incorrect, please update your form response or contact the Site Q.';

  MailApp.sendEmail(email, subject, body);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sendResponseSettingsEmail
  };
}
