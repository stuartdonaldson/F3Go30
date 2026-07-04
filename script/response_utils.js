var libSheetsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./libSheets.js')
  : null;
var responseUtilitiesModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./Utilities.js')
  : null;
var responseUtilsGo30ToolsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./go30tools.js')
  : null;
var responseUtilsCreateNewTrackerModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./CreateNewTracker.js')
  : null;

var resolveManagedHeaderMap_ = (libSheetsModule_ && libSheetsModule_.resolveManagedHeaderMap_)
  || (typeof globalThis !== 'undefined' && globalThis.resolveManagedHeaderMap_);
var findRowIndexByNormalizedValue_ = (libSheetsModule_ && libSheetsModule_.findRowIndexByNormalizedValue_)
  || (typeof globalThis !== 'undefined' && globalThis.findRowIndexByNormalizedValue_);
var sendConfiguredEmail_ = (responseUtilitiesModule_ && responseUtilitiesModule_.sendConfiguredEmail_)
  || (typeof globalThis !== 'undefined' && globalThis.sendConfiguredEmail_);
var findMostRecentPaxRecordForEmail_ = (responseUtilsGo30ToolsModule_ && responseUtilsGo30ToolsModule_.findMostRecentPaxRecordForEmail_)
  || (typeof globalThis !== 'undefined' && globalThis.findMostRecentPaxRecordForEmail_);
var getTemplateSpreadsheetForInit_ = (responseUtilsCreateNewTrackerModule_ && responseUtilsCreateNewTrackerModule_.getTemplateSpreadsheetForInit_)
  || (typeof globalThis !== 'undefined' && globalThis.getTemplateSpreadsheetForInit_);

var RESPONSE_COLUMN_MAP = {
  EMAIL: { header: 'Email Address', aliases: ['Email'] },
  F3_NAME: { header: 'F3 Name' },
  PARTICIPATION: { header: 'Are you currently participating in Go30?' },
  TEAM_TYPE: {
    header: 'Team type',
    aliases: [
      'Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?',
      'Team preference'
    ],
    optional: true
  },
  TEAM: { header: 'Team' },
  OTHER_TEAM: {
    header: 'Other team name',
    aliases: [
      "Great! Here are some goals that other HIM's are focused on this month. Pick one or choose 'other' and we will try and pair you with someone else who has a similar goal. Or specify another team name for grouping",
      'Goal or other team name',
      'What is your goal?',
      'Goal selection'
    ]
  },
  WHO: { header: 'WHO do you ultimately want to become?' },
  WHAT: { header: 'WHAT is your Go30 Challenge?' },
  HOW: { header: 'HOW are you going to be successful this month?' },
  PHONE: { header: 'Cell Phone Number' },
  NAG_EMAIL: {
    header: 'NAG Email?',
    aliases: ['NAG Email', 'Nag Email?', 'NAG'],
    optional: true
  },
  // Written only by the webapp signup form's feedback step (signup-webapp-requirements.md §11).
  // Optional: the comment column already existed unused; the rating column is new and may not
  // exist yet on older trackers — both are skipped gracefully when absent, never required.
  FEEDBACK_RATING: {
    header: 'Feedback Rating',
    optional: true
  },
  FEEDBACK_COMMENT: {
    header: 'Constructive Comments',
    optional: true
  }
};

function getResponseColumnSpec_(key) {
  if (!(key in RESPONSE_COLUMN_MAP)) throw new Error('Unknown response column key: ' + key);
  return RESPONSE_COLUMN_MAP[key];
}

function getResponseColumnHeader_(key) {
  return getResponseColumnSpec_(key).header;
}

function getResponseFieldTitles_(key) {
  var spec = getResponseColumnSpec_(key);
  return [spec.header].concat(spec.aliases || []);
}

function resolveResponseColumns(responsesSheetOrHeaders) {
  var headers = Array.isArray(responsesSheetOrHeaders)
    ? responsesSheetOrHeaders
    : (responsesSheetOrHeaders ? responsesSheetOrHeaders.getRange(1, 1, 1, responsesSheetOrHeaders.getLastColumn()).getValues()[0] : []);

  return resolveManagedHeaderMap_(headers, RESPONSE_COLUMN_MAP);
}

var resolveResponseColumns_ = resolveResponseColumns;

function buildResponseFieldCopyPlan_(sourceColumns, sourceRow, targetColumns) {
  var copyPlan = [];
  Object.keys(RESPONSE_COLUMN_MAP).forEach(function(key) {
    if (typeof sourceColumns[key] !== 'number' || typeof targetColumns[key] !== 'number') return;
    copyPlan.push({
      field: key,
      header: getResponseColumnHeader_(key),
      targetIndex: targetColumns[key],
      value: sourceRow[sourceColumns[key]]
    });
  });
  return copyPlan;
}

function sanitizeTextForEmailLine_(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeEmailAddressForSend_(email) {
  var cleaned = cleanEmailAddressValue_(email);
  return cleaned ? cleaned.toLowerCase() : '';
}

function cleanEmailAddressValue_(email) {
  var flattened = sanitizeTextForEmailLine_(email);
  if (/[<>\",;]/.test(flattened)) return '';

  var cleaned = flattened.replace(/\s+/g, '');

  if (!cleaned) return '';
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(cleaned)) return '';
  return cleaned;
}

function normalizeResponseHeader_(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getResponseEmailColumnIndexes_(responseColumns, responseHeaders) {
  var indexes = [];
  var seen = {};

  function pushIndex(index) {
    if (typeof index !== 'number' || index < 0 || seen[index]) return;
    seen[index] = true;
    indexes.push(index);
  }

  if (responseColumns && typeof responseColumns.EMAIL === 'number') pushIndex(responseColumns.EMAIL);
  if (!Array.isArray(responseHeaders)) return indexes;

  var preferredHeaders = {};
  getResponseFieldTitles_('EMAIL')
    .concat(['Email Address 2', 'Email Address 3'])
    .forEach(function(title) {
      preferredHeaders[normalizeResponseHeader_(title)] = true;
    });

  for (var i = 0; i < responseHeaders.length; i++) {
    var normalizedHeader = normalizeResponseHeader_(responseHeaders[i]);
    if (!normalizedHeader) continue;
    if (preferredHeaders[normalizedHeader] || /^email address \d+$/.test(normalizedHeader)) {
      pushIndex(i);
    }
  }

  return indexes;
}

function getResponseEmailValue_(responseRow, responseColumns, responseHeaders) {
  if (!responseRow) return '';

  var emailIndexes = getResponseEmailColumnIndexes_(responseColumns, responseHeaders);
  for (var i = 0; i < emailIndexes.length; i++) {
    var candidate = cleanEmailAddressValue_(responseRow[emailIndexes[i]]);
    if (candidate) return candidate;
  }

  return '';
}

function findResponseRowIndexByEmail_(rows, emailAddress, responseColumns, responseHeaders, startRow) {
  var target = sanitizeEmailAddressForSend_(emailAddress);
  if (!target || !Array.isArray(rows)) return -1;

  var firstRow = typeof startRow === 'number' && startRow >= 0 ? startRow : 0;
  for (var i = firstRow; i < rows.length; i++) {
    if (getResponseEmailValue_(rows[i], responseColumns, responseHeaders) === target) return i;
  }

  return -1;
}

var GOAL_SUMMARY_FIELDS_ = [
  ['EMAIL', 'Email'],
  ['NAG_EMAIL', 'Send reminder email'],
  ['TEAM_TYPE', 'Team type'],
  ['TEAM', 'Team'],
  ['OTHER_TEAM', 'Other team name'],
  ['WHO', 'Who you want to become'],
  ['WHAT', 'What is your Go30 Challenge'],
  ['HOW', 'How will you be successful'],
  ['PHONE', 'Phone']
];

function buildGoalSummaryLines_(valuesByField) {
  if (!valuesByField) return [];

  return GOAL_SUMMARY_FIELDS_
    .filter(function(field) {
      return String(valuesByField[field[0]] || '').trim() !== '';
    })
    .map(function(field) {
      return field[1] + ': ' + valuesByField[field[0]];
    });
}

function buildGoalSummaryLinesFromResponse_(responseRow, responseColumns, responseHeaders) {
  if (!responseRow || !responseColumns) return [];

  var valuesByField = {};
  GOAL_SUMMARY_FIELDS_.forEach(function(field) {
    if (field[0] === 'EMAIL') {
      valuesByField[field[0]] = getResponseEmailValue_(responseRow, responseColumns, responseHeaders);
      return;
    }
    var idx = responseColumns[field[0]];
    valuesByField[field[0]] = (typeof idx === 'number' && idx >= 0) ? responseRow[idx] : '';
  });

  return buildGoalSummaryLines_(valuesByField);
}

/**
 * Manual admin utility — reads a PAX's most recent PaxDB record and writes their prior
 * goal settings (Team/WHO/WHAT/HOW/TeamType/OtherTeam/Phone/NagEmail) into the current
 * tracker's Responses sheet, then emails them a summary.
 *
 * Use when a PAX needs their settings backfilled manually outside the normal form-submit
 * path (which handles this automatically via maybeReuseLastMonthsGoals_). Looks up by
 * email via PaxDB's Email column since only an email address is known at call time.
 *
 * Usage: applyPaxDbSettingsToCurrentTracker('foo@example.com')
 */
function applyPaxDbSettingsToCurrentTracker(email) {
  if (!email) throw new Error('email required');

  const currentSs = SpreadsheetApp.getActiveSpreadsheet();

  const templateSpreadsheet = getTemplateSpreadsheetForInit_(currentSs, currentSs.getSheetByName('Config'));
  const priorRecord = findMostRecentPaxRecordForEmail_(templateSpreadsheet, email, currentSs.getId());
  if (!priorRecord) throw new Error('No PaxDB record found for email: ' + email);

  // Current Responses sheet
  const curResponses = currentSs.getSheetByName('Responses');
  if (!curResponses) throw new Error('Responses sheet not found in current spreadsheet');
  const curData = curResponses.getDataRange().getValues();
  if (curData.length < 2) throw new Error('No responses in current Responses sheet');

  const curHeaders = curData[0].map(h => String(h || '').trim());
  const curResponseColumns = resolveResponseColumns_(curHeaders);
  let curRowIndex = findResponseRowIndexByEmail_(curData, email, curResponseColumns, curHeaders, 1);
  // If the email is not present in current Responses, append a new row and use it
  if (curRowIndex === -1) {
    const newRowIdx = curData.length + 1; // 1-based rows
    curResponses.insertRowAfter(curData.length);
    curRowIndex = newRowIdx - 1; // zero-based index into curData-like arrays for later +1 conversion
  }

  // Synthesize a source row/column map from the PaxDB record so the existing generic
  // copy-plan logic (buildResponseFieldCopyPlan_) stays unchanged — only the source
  // acquisition method (PaxDB instead of a previous tracker's Responses sheet) changed.
  const sourceColumns = { EMAIL: 0, TEAM_TYPE: 1, TEAM: 2, OTHER_TEAM: 3, WHO: 4, WHAT: 5, HOW: 6, PHONE: 7, NAG_EMAIL: 8 };
  const sourceRow = [
    priorRecord.email || '', priorRecord.teamType || '', priorRecord.team || '', priorRecord.otherTeam || '',
    priorRecord.who || '', priorRecord.what || '', priorRecord.how || '', priorRecord.phone || '', priorRecord.nagEmail || ''
  ];

  // Copy values for headers that exist in both
  const copiedPairs = [];
  const copyPlan = buildResponseFieldCopyPlan_(sourceColumns, sourceRow, curResponseColumns);
  copyPlan.forEach((entry) => {
    curResponses.getRange(curRowIndex + 1, entry.targetIndex + 1).setValue(entry.value);
    copiedPairs.push({ header: entry.header, value: entry.value });
  });

  // Notify via helper
  try {
    sendResponseSettingsEmail(currentSs, email, priorRecord.f3Name || '', copiedPairs);
  } catch (e) {
    GasLogger.log('applyPaxDbSettingsToCurrentTracker.emailFailed', { error: e.message });
  }

  GasLogger.log('applyPaxDbSettingsToCurrentTracker', { copied: copiedPairs.length, sourceSheetId: priorRecord.sheetId });

  return { copied: copiedPairs.length, details: copiedPairs };
}


/**
 * Sends an email to `email` summarizing the copied response settings.
 * `data` is an array of {header, value} objects.
 */
function sendResponseSettingsEmail(spreadsheet, email, recipientName, data) {
  var recipient = sanitizeEmailAddressForSend_(email);
  if (!recipient) throw new Error('valid email required');
  if (!data || !Array.isArray(data)) throw new Error('data required');
  var safeRecipientName = sanitizeTextForEmailLine_(recipientName) || 'there';

  var responseSettingsEmailModule_ = (typeof module !== 'undefined' && module.exports)
    ? require('./responseSettingsEmail.js')
    : null;
  var buildResponseSettingsEmailTemplate_ = (responseSettingsEmailModule_ && responseSettingsEmailModule_.buildResponseSettingsEmailTemplate_)
    || (typeof globalThis !== 'undefined' && globalThis.buildResponseSettingsEmailTemplate_);

  if (typeof buildResponseSettingsEmailTemplate_ !== 'function') {
    throw new Error('buildResponseSettingsEmailTemplate_ is unavailable');
  }

  var message = buildResponseSettingsEmailTemplate_({
    copiedSettings: data,
    recipientName: safeRecipientName
  });

  sendConfiguredEmail_({
    spreadsheet: spreadsheet,
    recipients: [{ name: safeRecipientName, email: recipient }],
    subject: message.subject,
    body: message.body,
    htmlBody: message.htmlBody,
    allowPlainTextFallback: true,
    logLabel: 'sendResponseSettingsEmail'
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RESPONSE_COLUMN_MAP,
    getResponseColumnSpec_,
    getResponseColumnHeader_,
    getResponseFieldTitles_,
    resolveResponseColumns,
    resolveResponseColumns_,
    buildResponseFieldCopyPlan_,
    sanitizeTextForEmailLine_,
    sanitizeEmailAddressForSend_,
    getResponseEmailColumnIndexes_,
    getResponseEmailValue_,
    findResponseRowIndexByEmail_,
    buildGoalSummaryLines_,
    buildGoalSummaryLinesFromResponse_,
    sendResponseSettingsEmail
  };
}
