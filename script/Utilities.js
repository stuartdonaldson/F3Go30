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
    if (typeof ManagedConfigSheet !== 'undefined' && ManagedConfigSheet && typeof ManagedConfigSheet.findValue === 'function') {
      return ManagedConfigSheet.findValue(variableName, data);
    }

    var rowIndex = findConfigRowIndex_(data, variableName);
    if (rowIndex === -1) return null;
    return {
      primary: data[rowIndex][1],
      secondary: data[rowIndex][2]
    };
  }
  if (!spreadsheet) {
    return null;
  }

  const config = openConfigSheet(spreadsheet);
  if (!config) {
    return null;
  }

  return config.getPair(variableName);
}

function findConfigRowIndex_(rows, variableName) {
  var target = String(variableName || '').trim();
  for (var i = 0; i < (rows || []).length; i++) {
    if (String(rows[i][0] || '').trim() === target) return i;
  }
  return -1;
}

function upsertConfigSheetRow_(configSheet, rows, key, primary, secondary) {
  var rowIndex = findConfigRowIndex_(rows, key);
  var nextPrimary = primary === undefined || primary === null ? '' : primary;
  var nextSecondary = secondary === undefined || secondary === null ? '' : secondary;

  if (rowIndex !== -1) {
    configSheet.getRange(rowIndex + 1, 2).setValue(nextPrimary);
    configSheet.getRange(rowIndex + 1, 3).setValue(nextSecondary);
    rows[rowIndex][1] = nextPrimary;
    rows[rowIndex][2] = nextSecondary;
    return rowIndex;
  }

  configSheet.appendRow([key, nextPrimary, nextSecondary]);
  rows.push([key, nextPrimary, nextSecondary]);
  return rows.length - 1;
}

function initializeConfigSheet_(configSheet) {
  if (!configSheet) return null;

  var values = configSheet.getDataRange().getValues();
  var rows = (values || []).map(function(row) {
    return [row[0] || '', row[1] || '', row[2] || ''];
  });
  var parentSpreadsheet = typeof configSheet.getParent === 'function' ? configSheet.getParent() : null;
  var activeSpreadsheetUrl = parentSpreadsheet && typeof parentSpreadsheet.getUrl === 'function'
    ? String(parentSpreadsheet.getUrl() || '').trim()
    : '';

  var siteQ = getConfigValue_(null, 'Site Q', rows) || { primary: '', secondary: '' };
  var nameSpace = getConfigValue_(null, 'NameSpace', rows) || { primary: '', secondary: '' };
  var logFile = getConfigValue_(null, 'LogFile', rows) || { primary: '', secondary: '' };
  var signupHcForm = getConfigValue_(null, 'Signup HC Form', rows) || { primary: '', secondary: '' };
  var sheetTemplate = getConfigValue_(null, 'Sheet Template', rows) || { primary: '', secondary: '' };
  var emailTestMode = getConfigValue_(null, 'Email Test Mode', rows);
  var legacyEmailTest = getConfigValue_(null, 'Email Test', rows);

  var emailPrimary = emailTestMode && emailTestMode.primary;
  if (!emailPrimary && legacyEmailTest && legacyEmailTest.primary) {
    emailPrimary = legacyEmailTest.primary;
  }
  if (!emailPrimary) emailPrimary = 'No';

  var emailSecondary = emailTestMode && emailTestMode.secondary;
  if (!emailSecondary && legacyEmailTest && legacyEmailTest.secondary) {
    emailSecondary = legacyEmailTest.secondary;
  }

  var sheetTemplatePrimary = sheetTemplate.primary;
  if (!sheetTemplatePrimary && activeSpreadsheetUrl) {
    sheetTemplatePrimary = activeSpreadsheetUrl;
  }

  upsertConfigSheetRow_(configSheet, rows, 'NameSpace', nameSpace.primary, nameSpace.secondary);
  upsertConfigSheetRow_(configSheet, rows, 'Site Q', siteQ.primary, siteQ.secondary);
  upsertConfigSheetRow_(configSheet, rows, 'LogFile', logFile.primary, logFile.secondary);
  upsertConfigSheetRow_(configSheet, rows, 'Signup HC Form', signupHcForm.primary, signupHcForm.secondary);
  upsertConfigSheetRow_(configSheet, rows, 'Sheet Template', sheetTemplatePrimary, sheetTemplate.secondary);
  upsertConfigSheetRow_(configSheet, rows, 'Email Test Mode', emailPrimary, emailSecondary);

  return rows;
}

function isConfigYesLike_(val) {
  if (val === undefined || val === null) return false;
  var s = String(val).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1' || s.indexOf('yes') === 0;
}

function sanitizePolicyEmailAddress_(email) {
  var flattened = String(email || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (/[<>\",;]/.test(flattened)) return '';
  var cleaned = flattened.replace(/\s+/g, '');
  if (!cleaned) return '';
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(cleaned)) return '';
  return cleaned.toLowerCase();
}

function sanitizeEmailDisplayName_(name) {
  var flattened = String(name || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!flattened) return '';

  var normalized = typeof flattened.normalize === 'function'
    ? flattened.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    : flattened;

  return normalized
    .replace(/[^A-Za-z0-9 ._'()-]+/g, ' ')
    .replace(/[<>",;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEmailRecipientList_(recipients) {
  if (typeof recipients === 'string') return String(recipients || '').trim();

  return (recipients || []).map(function(recipient) {
    var email = sanitizePolicyEmailAddress_(recipient && recipient.email);
    if (!email) return '';

    var displayName = sanitizeEmailDisplayName_(recipient && recipient.name);
    return displayName ? (displayName + ' <' + email + '>') : email;
  }).filter(function(entry) {
    return !!entry;
  }).join(',');
}

function getFirstConfigValue_(spreadsheet, variableNames, configData, configReader) {
  var names = variableNames || [];
  for (var i = 0; i < names.length; i++) {
    var value = configReader(spreadsheet || null, names[i], configData);
    if (value) return value;
  }
  return null;
}

function readEmailDeliveryPolicy_(spreadsheet, configData) {
  var configReader = getConfigValue_;
  if (!configData && typeof globalThis !== 'undefined' && typeof globalThis.getConfigValue_ === 'function' && globalThis.getConfigValue_ !== getConfigValue_) {
    configReader = globalThis.getConfigValue_;
  }

  var testModeConfig = getFirstConfigValue_(spreadsheet, ['Email Test Mode', 'Email Test'], configData, configReader);
  var siteQConfig = configReader(spreadsheet || null, 'Site Q', configData);

  return {
    emailTestMode: isConfigYesLike_(testModeConfig && (testModeConfig.primary || testModeConfig.secondary)),
    siteQEmail: sanitizePolicyEmailAddress_(siteQConfig && siteQConfig.secondary),
    siteQName: String(siteQConfig && siteQConfig.primary || '').trim()
  };
}

/**
 * Returns the ManagedConfigSheet for the authoritative config spreadsheet.
 * When IS_TEMPLATE_HOST is set, config always comes from the template (active spreadsheet).
 * Otherwise falls back to the provided tracker spreadsheet.
 * @param {Spreadsheet=} trackerSpreadsheet - Tracker spreadsheet (used only when not template host).
 * @returns {ManagedConfigSheet|null}
 */
function openAppConfigSheet_(trackerSpreadsheet) {
  var isTemplateHost = PropertiesService.getScriptProperties().getProperty('IS_TEMPLATE_HOST') === 'true';
  return openConfigSheet(isTemplateHost ? undefined : trackerSpreadsheet);
}

/**
 * Reads the email delivery policy from a ManagedConfigSheet using typed accessors.
 * Use in place of readEmailDeliveryPolicy_() when the config sheet is already resolved
 * via openAppConfigSheet_().
 * @param {ManagedConfigSheet|null} configSheet
 * @returns {{emailTestMode: boolean, siteQEmail: string, siteQName: string}}
 */
function readEmailDeliveryPolicyFromSheet_(configSheet) {
  var testModeVal = configSheet && (
    configSheet.getValue('Email Test Mode') || configSheet.getValue('Email Test')
  );
  var siteQPair = configSheet && configSheet.getPair('Site Q');
  return {
    emailTestMode: isConfigYesLike_(testModeVal),
    siteQEmail: sanitizePolicyEmailAddress_(siteQPair && siteQPair.secondary),
    siteQName: String(siteQPair && siteQPair.primary || '').trim()
  };
}

function buildTestModeNoticeText_(recipientList) {
  return 'TEST MODE - Intended Recipients: ' + String(recipientList || '').trim();
}

function buildTestModeNoticeHtml_(recipientList) {
  return [
    '<div style="margin:0 0 16px;padding:12px 14px;border:2px solid #b42318;background:#fef3f2;color:#7a271a;font-weight:bold;">',
    escapeHtml_(buildTestModeNoticeText_(recipientList)),
    '</div>'
  ].join('');
}

function prependEmailHtmlNotice_(htmlBody, noticeHtml) {
  var html = String(htmlBody || '');
  if (!noticeHtml) return html;

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, function(match) {
      return match + noticeHtml;
    });
  }

  return noticeHtml + html;
}

function prepareOutboundEmailDelivery_(options) {
  var policy = options && options.policy || readEmailDeliveryPolicy_(options && options.spreadsheet, options && options.configData);
  var intendedRecipients = buildEmailRecipientList_(options && (options.recipients || options.recipientList));
  var subject = String(options && options.subject || '');
  var body = String(options && options.body || '');
  var htmlBody = String(options && options.htmlBody || '');

  if (!intendedRecipients) {
    return { ok: false, error: 'No intended recipients configured for outbound email.' };
  }

  var smokeMode = PropertiesService.getScriptProperties().getProperty('SMOKE_MODE') === 'true';

  if (!policy.emailTestMode && !smokeMode) {
    return {
      ok: true,
      message: {
        to: intendedRecipients,
        subject: subject,
        body: body,
        htmlBody: htmlBody
      },
      intendedRecipients: intendedRecipients,
      effectiveRecipients: intendedRecipients,
      testMode: false,
      smokeMode: false
    };
  }

  if (!policy.siteQEmail) {
    var modeLabel = smokeMode ? 'Smoke mode' : 'Email test mode';
    return { ok: false, error: modeLabel + ' is enabled but Site Q email is missing or invalid.' };
  }

  var noticeText = buildTestModeNoticeText_(intendedRecipients);
  var noticeHtml = buildTestModeNoticeHtml_(intendedRecipients);
  var subjectPrefix = smokeMode ? '[SMOKE] ' : '[TEST MODE] ';

  return {
    ok: true,
    message: {
      to: policy.siteQEmail,
      subject: subjectPrefix + subject,
      body: noticeText + '\n\n' + body,
      htmlBody: prependEmailHtmlNotice_(htmlBody, noticeHtml)
    },
    intendedRecipients: intendedRecipients,
    effectiveRecipients: policy.siteQEmail,
    testMode: policy.emailTestMode,
    smokeMode: smokeMode
  };
}

function sendConfiguredEmail_(options) {
  var delivery = prepareOutboundEmailDelivery_(options);
  if (!delivery.ok) {
    throw new Error(delivery.error);
  }

  try {
    MailApp.sendEmail(delivery.message);
  } catch (err) {
    if (!options || !options.allowPlainTextFallback || !delivery.message.htmlBody) {
      throw err;
    }

    Logger.log((options.logLabel || 'sendConfiguredEmail_') + ': html send failed — ' + err.message);
    MailApp.sendEmail(delivery.message.to, delivery.message.subject, delivery.message.body);
    delivery.fellBackToPlainText = true;
  }

  // Metadata only — never subject/body, which may contain PAX names. Recipients are
  // masked (see GasLogger.js maskRecipientListForLog_) since GasLogger.log() data must
  // never contain a raw email address.
  GasLogger.log((options && options.logLabel || 'sendConfiguredEmail_') + '.sent', {
    testMode: delivery.testMode,
    effectiveRecipients: maskRecipientListForLog_(delivery.effectiveRecipients),
    fellBackToPlainText: !!delivery.fellBackToPlainText
  });

  return delivery;
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
 * Builds the Slack copy-paste message for autoGenerateNextMonthTracker_. The signup web app
 * URL is the primary, stable entry point PAX should use to sign up themselves; the tracker
 * link lets them see where their commit will land. The HC form link is included only as an
 * optional fallback for PAX who prefer it — it is not the primary instruction.
 * @param {number} year - Full year (e.g. 2026).
 * @param {string} month - Long month name (e.g. 'April').
 * @param {string} signupUrl - Stable, NameSpace-derived signup short URL.
 * @param {string} trackerUrl - Tracker sheet URL (TinyURL preferred).
 * @param {string=} formUrl - HC form URL, mentioned only as an optional alternative.
 * @returns {string} Slack message text.
 */
function buildSignupSlackMessage_(year, month, signupUrl, trackerUrl, formUrl) {
  const prefix = year + ' ' + month;
  var lines = [
    prefix + ' Hard Commit Signup is open!',
    '',
    'Sign up here: ' + signupUrl,
    '',
    prefix + ' Tracker: ' + trackerUrl
  ];
  if (formUrl) {
    lines.push('');
    lines.push('(Prefer the old HC form? You can still use it: ' + formUrl + ')');
  }
  return lines.join('\n');
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml_: escapeHtml_,
    getConfigValue_: getConfigValue_,
    initializeConfigSheet_: initializeConfigSheet_,
    sanitizeEmailDisplayName_: sanitizeEmailDisplayName_,
    buildEmailRecipientList_: buildEmailRecipientList_,
    openAppConfigSheet_: openAppConfigSheet_,
    readEmailDeliveryPolicy_: readEmailDeliveryPolicy_,
    readEmailDeliveryPolicyFromSheet_: readEmailDeliveryPolicyFromSheet_,
    prepareOutboundEmailDelivery_: prepareOutboundEmailDelivery_,
    sendConfiguredEmail_: sendConfiguredEmail_,
    buildSlackMessage_: buildSlackMessage_,
    buildSignupSlackMessage_: buildSignupSlackMessage_
  };
}
