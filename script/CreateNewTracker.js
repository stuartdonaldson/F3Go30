
var MONTH_NAMES_ = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var LINKS_SHEET_HEADERS_ = ['Date Modified', 'StartDate', 'SpreadsheetName', 'ShortTracker', 'TrackerURL', 'ShortHC', 'HC URL', 'SheetId', 'FormId', 'TotalPAX', 'TotalTeams', 'AverageScore'];
var LINKS_SHEET_COLUMN_MAP_ = {
  date: { header: 'Date Modified', aliases: ['Date'] },
  startDate: { header: 'StartDate', aliases: ['Month'] },
  spreadsheetName: { header: 'SpreadsheetName', aliases: ['Spreadsheet Name'] },
  shortTracker: 'ShortTracker',
  trackerUrl: { header: 'TrackerURL', aliases: ['Tracker URL'] },
  shortHc: 'ShortHC',
  hcUrl: { header: 'HC URL', aliases: ['Form URL'] },
  sheetId: { header: 'SheetId', aliases: ['Spreadsheet ID'] },
  formId: { header: 'FormId', aliases: ['Form ID'] },
  totalPax: { header: 'TotalPAX', optional: true },
  totalTeams: { header: 'TotalTeams', optional: true },
  averageScore: { header: 'AverageScore', optional: true }
};

// Sheet disposition for tracker copies. Sheets marked Delete are skipped during copy;
// Hidden are copied but hidden; Visible are copied and left visible.
var TRACKER_SHEET_INDEX_ = {
  'Tracker':         'Visible',
  'Config':          'Hidden',
  'ListDB':          'Delete',
  'Links':           'Delete',
  'TrackerDB':       'Delete',
  'Inspiration':     'Hidden',
  'Bonus Tracker':   'Visible',
  'Periods':         'Hidden',
  'Controls':        'Hidden',
  'Team Score':      'Visible',
  'Responses':       'Hidden',
  'PaxDB':           'Delete',
  'Pivot Table 22':  'Delete',
  'HIM Score':       'Visible',
  'Goals by HIM':    'Visible',
  'UBonus Tracker':  'Hidden',
  'Goals by AO':     'Visible',
  'FunFacts':        'Hidden',
  'Help':            'Visible',
  'Activity':        'Delete'
};

function buildLinksHeaderIndex_(headers) {
  const headerIndex = {};
  (headers || []).forEach((header, index) => {
    headerIndex[String(header || '').trim().toLowerCase()] = index;
  });
  return headerIndex;
}

function ensureLinksSheetSchema_(linksSheet) {
  if (!linksSheet || !linksSheet.sheet) return linksSheet;

  const range = typeof linksSheet.sheet.getDataRange === 'function' ? linksSheet.sheet.getDataRange() : null;
  const values = range ? range.getValues() : [];
  const headerRow = values && values.length ? values[0] : [];
  const headerIndex = buildLinksHeaderIndex_(headerRow);
  let mutated = false;

  const columnSpecs = [
    { header: 'StartDate', backfillFrom: ['Month'] },
    { header: 'SpreadsheetName', backfillFrom: ['Spreadsheet Name'] },
    { header: 'ShortTracker', backfillFrom: ['Tracker URL', 'TrackerURL'] },
    { header: 'TrackerURL', backfillFrom: ['Tracker URL'] },
    { header: 'ShortHC', backfillFrom: ['Form URL', 'HC URL'] },
    { header: 'HC URL', backfillFrom: ['Form URL'] },
    { header: 'SheetId', backfillFrom: ['Spreadsheet ID'] },
    { header: 'FormId', backfillFrom: ['Form ID'] }
  ];

  columnSpecs.forEach((spec) => {
    const normalizedHeader = spec.header.toLowerCase();
    if (normalizedHeader in headerIndex) return;
    const nextColumn = Math.max(linksSheet.sheet.getLastColumn(), 0) + 1;
    linksSheet.sheet.getRange(1, nextColumn).setValue(spec.header);
    headerIndex[normalizedHeader] = nextColumn - 1;
    mutated = true;
  });

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const rowValues = values[rowIndex] || [];
    columnSpecs.forEach((spec) => {
      const targetIndex = headerIndex[spec.header.toLowerCase()];
      if (targetIndex === undefined) return;

      const currentValue = rowValues[targetIndex];
      if (currentValue !== undefined && currentValue !== null && currentValue !== '') return;

      for (let i = 0; i < spec.backfillFrom.length; i++) {
        const sourceIndex = headerIndex[String(spec.backfillFrom[i]).trim().toLowerCase()];
        if (sourceIndex === undefined) continue;

        const sourceValue = rowValues[sourceIndex];
        if (sourceValue === undefined || sourceValue === null || sourceValue === '') continue;

        linksSheet.sheet.getRange(rowIndex + 1, targetIndex + 1).setValue(sourceValue);
        rowValues[targetIndex] = sourceValue;
        mutated = true;
        break;
      }
    });
  }

  if (mutated) {
    linksSheet.refreshData();
  }
  return linksSheet;
}

function openLinksSheet_(spreadsheet) {
  const ssManager = new SpreadsheetManager(spreadsheet);
  const linksSheet = ssManager.openOrCreateManagedSheet('TrackerDB', LINKS_SHEET_COLUMN_MAP_, LINKS_SHEET_HEADERS_);
  return ensureLinksSheetSchema_(linksSheet);
}

function upsertLinksRow_(linksSheet, rowData) {
  if (!linksSheet) return 'skipped';

  const sheetId = rowData && rowData.sheetId ? String(rowData.sheetId).trim() : '';
  if (sheetId && typeof linksSheet.findRow === 'function' && linksSheet.findRow('sheetId', sheetId)) {
    linksSheet.updateRowByValue('sheetId', sheetId, rowData);
    return 'updated';
  }

  linksSheet.appendRow(rowData || {});
  return 'appended';
}

function writeTrackerConfigRows_(configSheet, formName, formUrl, templateUrl) {
  if (!configSheet) return;

  const cfgRange = configSheet.getDataRange();
  const cfgValues = cfgRange ? cfgRange.getValues() : [];

  function upsertConfigRow(sheet, values, key, primary, secondary) {
    for (let r = 0; r < values.length; r++) {
      if (String(values[r][0]).trim() === key) {
        sheet.getRange(r + 1, 2).setValue(primary || '');
        sheet.getRange(r + 1, 3).setValue(secondary || '');
        return;
      }
    }
    sheet.appendRow([key, primary || '', secondary || '']);
  }

  upsertConfigRow(configSheet, cfgValues, 'Signup HC Form', formName, formUrl);
  upsertConfigRow(configSheet, cfgValues, 'Sheet Template', templateUrl || '', '');
}

function hideInternalSheets_(spreadsheet) {
  if (!spreadsheet || typeof spreadsheet.getSheets !== 'function') return;

  spreadsheet.getSheets().forEach(function(sheet) {
    var name = sheet.getName();
    var disposition = TRACKER_SHEET_INDEX_[name];
    if (disposition === 'Delete') {
      if (typeof spreadsheet.deleteSheet === 'function') spreadsheet.deleteSheet(sheet);
    } else if (disposition !== 'Visible') {
      if (typeof sheet.hideSheet === 'function') sheet.hideSheet();
    }
  });
}

function getTemplateSpreadsheetForInit_(spreadsheet, configSheet) {
  const configRows = configSheet ? configSheet.getDataRange().getValues() : null;
  const templateConfig = getConfigValue_(null, 'Sheet Template', configRows);
  const templateUrl = String((templateConfig && templateConfig.primary) || '').trim();

  if (!templateUrl) return spreadsheet;

  try {
    return SpreadsheetApp.openByUrl(templateUrl);
  } catch (err) {
    GasLogger.log('getTemplateSpreadsheetForInit_.openFailed', { templateUrl: templateUrl, error: err.message });
    return spreadsheet;
  }
}

/**
 * Creates a new monthly tracker spreadsheet from the current template.
 * Spreadsheet name is auto-generated as YYYY-MM-NameSpace using the NameSpace
 * value from the Config sheet and the operator-supplied start date.
 */
function copyAndInit() {
  return GasLogger.run('copyAndInit', copyAndInit_);
}

/**
 * Shared tracker-creation core used by both copyAndInit_ (manual, sidebar) and
 * autoGenerateNextMonthTracker_ (automated, trigger). Performs the Drive file copy,
 * sheet cleanup, form copy + link, config writes, initSheets, TrackerDB upsert,
 * trigger installation, and signup URL resolution.
 *
 * @param {Object} options
 * @param {Spreadsheet} options.sourceSpreadsheet  Template spreadsheet
 * @param {Date}        options.startDate           First day of the new tracker month
 * @param {string}      options.newSpreadsheetName  Name for the new spreadsheet
 * @param {Folder}      options.folder              Drive folder for the new artifacts
 * @param {boolean}     options.smokeMode
 * @param {string}      options.nameSpace           e.g. "F3 Go30" or "F3 Go30 (Smoke)"
 * @param {Object}      options.siteQConfig         { primary: name, secondary: email }
 * @param {Sheet|null}  options.configSheet         Config sheet of sourceSpreadsheet
 * @param {Array[]|null} options.configData         Config sheet values
 * @param {Function}    [options.logFn]             Progress logger — defaults to no-op
 * @returns {{ newSpreadsheet, newSpreadsheetId, newSpreadsheetName, trackerSheetUrl,
 *             trackerSheetShortUrl, formUrl, formShortUrl, formName, formId,
 *             signupShortUrl, slackMsg, startDateIso }}
 */
function createTrackerSpreadsheet_(options) {
  var logFn = options.logFn || function() {};
  var sourceSpreadsheet = options.sourceSpreadsheet;
  var startDate = options.startDate;
  var newSpreadsheetName = options.newSpreadsheetName;
  var folder = options.folder;
  var smokeMode = options.smokeMode;
  var nameSpace = options.nameSpace;
  var siteQConfig = options.siteQConfig;
  var configSheet = options.configSheet;
  var configData = options.configData;
  var siteQEmail = siteQConfig.secondary;
  var siteQName = siteQConfig.primary || 'Site Q';
  var paddedMonth = String(startDate.getMonth() + 1).padStart(2, '0');
  var paddedDay = String(startDate.getDate()).padStart(2, '0');
  var startDateIso = startDate.getFullYear() + '-' + paddedMonth + '-' + paddedDay;

  var templateFormUrl = sourceSpreadsheet.getFormUrl();
  if (!templateFormUrl) {
    throw new Error('No form linked to the template spreadsheet — the template must have an associated Google Form.');
  }

  var newSpreadsheetId = null;
  try {
    logFn('Copying spreadsheet...');
    // Direct Drive file copy preserves cross-sheet formulas (sheet-by-sheet copy breaks them)
    var newFile = DriveApp.getFileById(sourceSpreadsheet.getId()).makeCopy(newSpreadsheetName, folder);
    newSpreadsheetId = newFile.getId();
    var newSpreadsheet = SpreadsheetApp.openById(newSpreadsheetId);

    if (smokeMode) {
      PropertiesService.getScriptProperties().setProperty('SMOKE_TRACKER_ID', newSpreadsheetId);
    }

    // PAX interact via the Form only — VIEW permission is sufficient and prevents data corruption
    newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Remove template-only sheets and any Form Responses inherited from the template copy
    newSpreadsheet.getSheets().forEach(function(s) {
      var name = s.getName();
      if (TRACKER_SHEET_INDEX_[name] === 'Delete' || /^Form Responses/.test(name)) {
        newSpreadsheet.deleteSheet(s);
      }
    });

    var trackerSheet = newSpreadsheet.getSheetByName('Tracker');
    if (!trackerSheet) {
      throw new Error('Tracker sheet not found in new spreadsheet.');
    }

    var trackerSheetUrl = newSpreadsheet.getUrl() + '#gid=' + trackerSheet.getSheetId();
    var trackerSheetShortUrl = trackerSheetUrl;
    try {
      trackerSheetShortUrl = shortenUrl(trackerSheetUrl, newSpreadsheetName, 5, 'tinyurl');
    } catch (e) {
      GasLogger.log('createTrackerSpreadsheet.shortenUrlFailed', { target: 'tracker', error: e.message });
    }

    logFn('Copying form...');
    var formName = newSpreadsheetName + ' HC';
    var ftitle = startDate.getFullYear() + '-' + paddedMonth + '-' + paddedDay + ' HC Form';
    var newFormFile = DriveApp.getFileById(FormApp.openByUrl(templateFormUrl).getId()).makeCopy(formName, folder);
    var form = FormApp.openById(newFormFile.getId());
    form.setTitle(ftitle);
    ensureReuseOptionOnLinkedForm_(form);
    form.setConfirmationMessage(
      'Thank you for your Hard Commit!\n\n' +
      'View the Go30 tracker here: ' + trackerSheetShortUrl + '\n\n' +
      'Questions? Contact ' + siteQName + ' (' + siteQEmail + ').'
    );

    // Link form to new spreadsheet — required for forSpreadsheet().onFormSubmit() trigger.
    // setDestination auto-creates "Form Responses 1"; delete it since Responses was already
    // copied from the template with the correct column order.
    form.setDestination(FormApp.DestinationType.SPREADSHEET, newSpreadsheetId);
    SpreadsheetApp.flush();
    newSpreadsheet.getSheets().forEach(function(s) {
      if (/^Form Responses/.test(s.getName())) newSpreadsheet.deleteSheet(s);
    });

    var formUrl = form.getPublishedUrl();
    var formShortUrl = formUrl;
    try {
      formShortUrl = shortenUrl(formUrl, formName, 5, 'tinyurl');
    } catch (e) {
      GasLogger.log('createTrackerSpreadsheet.shortenUrlFailed', { target: 'form', error: e.message });
    }

    var newConfigSheet = newSpreadsheet.getSheetByName('Config');
    writeTrackerConfigRows_(newConfigSheet, formName, formUrl, sourceSpreadsheet.getUrl());

    initSheets(newSpreadsheet, startDate);

    var linksSheet = openLinksSheet_(sourceSpreadsheet);
    upsertLinksRow_(linksSheet, {
      date: new Date(),
      startDate: startDateIso,
      spreadsheetName: newSpreadsheetName,
      sheetId: newSpreadsheetId,
      formId: form.getId(),
      shortTracker: trackerSheetShortUrl,
      trackerUrl: trackerSheetUrl,
      shortHc: formShortUrl,
      hcUrl: formUrl
    });

    // Form-submit dispatch (ADR-010): installed once here, from the Template, targeting
    // the new tracker directly — no per-copy "Initialize Triggers" step required.
    setupFormSubmitTrigger(newSpreadsheet);

    var signupShortUrl = ensureSignupShortUrl_(configSheet, configData, nameSpace);

    var slackMsg = buildSignupSlackMessage_(
      startDate.getFullYear(), MONTH_NAMES_[startDate.getMonth()],
      signupShortUrl, trackerSheetShortUrl, formShortUrl
    );

    return {
      newSpreadsheet: newSpreadsheet,
      newSpreadsheetId: newSpreadsheetId,
      newSpreadsheetName: newSpreadsheetName,
      trackerSheetUrl: trackerSheetUrl,
      trackerSheetShortUrl: trackerSheetShortUrl,
      formUrl: formUrl,
      formShortUrl: formShortUrl,
      formName: formName,
      formId: form.getId(),
      signupShortUrl: signupShortUrl,
      slackMsg: slackMsg,
      startDateIso: startDateIso
    };
  } catch (e) {
    e.orphanedSpreadsheetId = newSpreadsheetId;
    throw e;
  }
}

function copyAndInit_() {
  NoticeLogInit("Create New Tracker", "This script will create a new monthly tracker. Enter the start date when prompted.");

  const response = NoticePrompt("Enter start date YYYY-MM-DD");
  if (!response) {
    NoticeLog('Operation canceled.');
    return;
  }
  const startDate = new Date(response + 'T00:00:00'); // local time to avoid UTC offset shifting the date

  if (isNaN(startDate.getTime())) {
    NoticeLog('Invalid date format. Please use YYYY-MM-DD format.');
    NoticeLog('Operation canceled.');
    return;
  }
  // Catch JS date rollover (e.g. 2025-02-30 → March 2): parse month from input and compare
  const inputMonth = parseInt(response.split('-')[1], 10);
  if (startDate.getMonth() + 1 !== inputMonth) {
    NoticeLog('Invalid date: ' + response + ' does not exist. Please enter a valid calendar date.');
    NoticeLog('Operation canceled.');
    return;
  }

  const currentSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = currentSpreadsheet.getSheetByName('Config');
  const configData = configSheet ? configSheet.getDataRange().getValues() : null;

  const siteQConfig = getConfigValue_(null, 'Site Q', configData);
  if (!siteQConfig || !siteQConfig.secondary) {
    NoticeLog('Error: Site Q email not found in Config sheet — add a "Site Q" row with the email address in the secondary column.');
    return;
  }
  const siteQEmail = siteQConfig.secondary;

  let nameSpaceConfig = getConfigValue_(null, 'NameSpace', configData);
  if (!nameSpaceConfig || !nameSpaceConfig.primary) {
    const DEFAULT_NAMESPACE = 'F3 Go30';
    if (configSheet) {
      configSheet.appendRow(['NameSpace', DEFAULT_NAMESPACE]);
      SpreadsheetApp.flush();
      nameSpaceConfig = getConfigValue_(null, 'NameSpace', configSheet.getDataRange().getValues());
    }
    if (!nameSpaceConfig || !nameSpaceConfig.primary) {
      NoticeLog('Error: NameSpace not found in Config sheet — add a "NameSpace" row with the region identifier in the primary column.');
      return;
    }
    NoticeLog('Config: NameSpace was not set — wrote default "' + DEFAULT_NAMESPACE + '". Update the Config sheet NameSpace row to change the region identifier.');
  }
  const smokeMode = PropertiesService.getScriptProperties().getProperty('SMOKE_MODE') === 'true';
  const nameSpace = nameSpaceConfig.primary + (smokeMode ? ' (Smoke)' : '');
  const paddedMonth = String(startDate.getMonth() + 1).padStart(2, '0');
  const newSpreadsheetName = startDate.getFullYear() + '-' + paddedMonth + '-' + nameSpace;

  // Pre-checks before creating any artifacts — fail here so no orphan is created
  const currentSpreadsheetFile = DriveApp.getFileById(currentSpreadsheet.getId());
  const parents = currentSpreadsheetFile.getParents();
  if (!parents.hasNext()) {
    NoticeLog('Error: cannot determine folder — spreadsheet must be in a Drive folder, not in My Drive root.');
    return;
  }
  const folder = parents.next();

  NoticeLog('Creating ' + newSpreadsheetName + '. Please wait...');

  let result;
  try {
    result = createTrackerSpreadsheet_({
      sourceSpreadsheet: currentSpreadsheet,
      startDate: startDate,
      newSpreadsheetName: newSpreadsheetName,
      folder: folder,
      smokeMode: smokeMode,
      nameSpace: nameSpace,
      siteQConfig: siteQConfig,
      configSheet: configSheet,
      configData: configData,
      logFn: NoticeLog
    });
  } catch (err) {
    const orphanId = err.orphanedSpreadsheetId || null;
    if (orphanId) {
      NoticeLog('Error during initialization: ' + err.message);
      NoticeLog('Orphaned spreadsheet ID: ' + orphanId + ' — please delete it from Drive.');
    } else {
      NoticeLog('Error: ' + err.message);
    }
    GasLogger.log('copyAndInit.error', {
      error: err.message,
      spreadsheetName: newSpreadsheetName,
      orphanedSpreadsheetId: orphanId
    });
    throw err;
  }

  NoticeLog('New spreadsheet tracker sheet link: ' + createHtmlLink(result.newSpreadsheetName, result.trackerSheetShortUrl));
  NoticeLog('New HC Form: ' + createHtmlLink(result.formName, result.formShortUrl));
  NoticeLog("-");
  NoticeLog('<b>Next steps:</b>');
  NoticeLog('1. Open the new spreadsheet (link above) and verify it looks correct');
  NoticeLog('2. Open the HC form (link above) and verify it looks correct');
  NoticeLog("-");
  NoticeLog('<b>Slack channel message:</b>');
  NoticeLog('<textarea rows="5" style="width:100%;font-family:monospace;font-size:11px;resize:none;box-sizing:border-box;" readonly onclick="this.select()">' + escapeHtml_(result.slackMsg) + '</textarea>');
  NoticeLog("-");
  NoticeLog('You can now close this sidebar.');

  GasLogger.log('copyAndInit', {
    spreadsheetId: result.newSpreadsheetId,
    spreadsheetName: result.newSpreadsheetName,
    startDateIso: result.startDateIso,
    trackerUrl: result.trackerSheetShortUrl,
    formUrl: result.formShortUrl,
    signupShortUrl: result.signupShortUrl,
    templateSpreadsheetId: currentSpreadsheet.getId()
  });

  const emailMessage = buildOnboardingEmailTemplate_({
    trackerName: result.newSpreadsheetName,
    siteName: siteQConfig.primary || 'Site Q',
    trackerUrl: result.trackerSheetShortUrl,
    formUrl: result.formShortUrl,
    ownerAccount: siteQConfig.primary,
    initSteps: [
      'Open the new spreadsheet and verify it looks correct',
      'Open the HC form and verify it looks correct'
    ],
    postCopyChecklist: [
      'Open new spreadsheet and verify layout',
      'Open HC form and verify title + choices',
      'Verify Config rows (Signup HC Form, Sheet Template, Site Q, NameSpace)',
      'Confirm TrackerDB sheet entry for new tracker and form',
      'Verify form sharing, file name and folder placement',
      'Run test reuse flow (Test Reuse menu or submit sample)',
      'Copy Slack message from sidebar and post to channel',
      'Verify Help sheet Next Month signup link (optional)',
      'Verify Config sheet hidden and sensitive values protected'
    ],
    slackReadyMessage: result.slackMsg,
    operatorName: null,
    contactEmail: siteQEmail,
    appVersion: APP_VERSION
  });
  try {
    sendConfiguredEmail_({
      spreadsheet: currentSpreadsheet,
      configData: configData,
      recipientList: siteQEmail,
      subject: emailMessage.subject,
      body: emailMessage.body,
      htmlBody: emailMessage.htmlBody,
      allowPlainTextFallback: true,
      logLabel: 'copyAndInit'
    });
  } catch (mailErr) {
    GasLogger.log('copyAndInit.emailFailed', { error: mailErr.message });
    NoticeLog('Note: email notification failed — ' + mailErr.message);
  }

  noticeLogDone_();
}

/**
 * Reinitializes the sheets in the current spreadsheet for a new month.
 * Prompts the user to enter a start date in the format "YYYY-MM-DD".
 * Validates the input date and initializes the sheets accordingly.
 * Logs messages to notify the user of the operation's progress and outcome.
 *
 * @function
 * @throws {Error} If the entered date is invalid or the operation is canceled.
 */
function reinitializeSheets() {
  return GasLogger.run('reinitializeSheets', function() {
    NoticeLogInit("Reinitialize Sheets", "This script will reinitialize the sheets in the current spreadsheet. Please enter the start date for the new month.");

    const response = NoticePrompt("Enter start date YYYY-MM-DD");
    if (!response) {
      NoticeLog('Operation canceled.');
      return;
    }
    const startDate = new Date(response + 'T00:00:00'); // local time to avoid UTC offset shifting the date

    if (isNaN(startDate.getTime())) {
      NoticeLog('Invalid date format. Please use YYYY-MM-DD format.');
      NoticeLog('Operation canceled.');
      return;
    }
    const inputMonth = parseInt(response.split('-')[1], 10);
    if (startDate.getMonth() + 1 !== inputMonth) {
      NoticeLog('Invalid date: ' + response + ' does not exist. Please enter a valid calendar date.');
      NoticeLog('Operation canceled.');
      return;
    }

    NoticeLog('Reinitializing sheets. Please wait...');

    initSheets(SpreadsheetApp.getActiveSpreadsheet(), startDate);
    SpreadsheetApp.flush();

    NoticeLog('The sheets have been reinitialized successfully.');
    NoticeLog('You can now close this message.');
    noticeLogDone_();
  });
}

function initializeConfigSheet() {
  return GasLogger.run('initializeConfigSheet', function() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = spreadsheet.getSheetByName('Config');
    if (!configSheet) {
      GasLogger.log('initializeConfigSheet.notFound', {});
      return;
    }

    initializeConfigSheet_(configSheet);
    SpreadsheetApp.flush();
    GasLogger.log('initializeConfigSheet.standardized', {});
  });
}


/**
 * Initializes and resets the sheets in the given spreadsheet.
 * 
 * This function performs the following actions:
 * - Resets the "Tracker" sheet by deleting rows beyond the fourth row,
 *   clearing non-formula cells in a specific range, and populating it with data.
 * - Resets the "Bonus Tracker" sheet by clearing content from the second row onward.
 * - Resets the "Responses" sheet by deleting rows beyond the first row.
 * 
 * @param {Spreadsheet} newSpreadsheet - The Google Spreadsheet object containing the sheets to initialize.
 * @param {Date} startDate - The start date used to populate the "Tracker" sheet.
 */

function initSheets(newSpreadsheet, startDate) {

  const trackerSheet = newSpreadsheet.getSheetByName('Tracker');
  const bonusTrackerSheet = newSpreadsheet.getSheetByName('Bonus Tracker');
  const responsesSheet = newSpreadsheet.getSheetByName('Responses');
  const activitySheet = newSpreadsheet.getSheetByName('Activity');
  const configSheet = newSpreadsheet.getSheetByName('Config');
  if (!trackerSheet || !bonusTrackerSheet || !responsesSheet) {
    NoticeLog('Error: Required sheet(s) not found — Tracker, Bonus Tracker, and Responses must all exist.');
    return;
  }

  initializeConfigSheet_(configSheet);

  NoticeLog('Resetting Tracker sheet...');
    if (trackerSheet.getLastRow() > 4) {
      trackerSheet.deleteRows(5, trackerSheet.getLastRow() - 4);
    }
    clearNonFormulaCells(trackerSheet.getRange('A4:AS4'));
    populateTrackerSheet(trackerSheet, startDate)
    SpreadsheetApp.flush();

  NoticeLog('Resetting Bonus Tracker sheet...');
    if (bonusTrackerSheet.getLastRow() > 1) {
      bonusTrackerSheet.getRange(2, 1, bonusTrackerSheet.getLastRow() - 1, bonusTrackerSheet.getLastColumn()).clearContent();
      SpreadsheetApp.flush();
    }

  NoticeLog('Resetting Responses sheet...');
  if (responsesSheet.getLastRow() > 1) {
    responsesSheet.deleteRows(2, responsesSheet.getLastRow() - 1);
    SpreadsheetApp.flush();
  }

  NoticeLog('Resetting Activity sheet...');
  if (activitySheet && activitySheet.getLastRow() > 1) {
    activitySheet.getRange(2, 1, activitySheet.getLastRow() - 1, activitySheet.getLastColumn()).clearContent();
    SpreadsheetApp.flush();
  }

  hideInternalSheets_(newSpreadsheet);
}

function clearNonFormulaCells(range) {
  const formulas = range.getFormulas()[0];
  const a1Notations = [];
  for (let i = 0; i < formulas.length; i++) {
    if (!formulas[i]) {
      a1Notations.push(range.getCell(1, i + 1).getA1Notation());
    }
  }
  if (a1Notations.length > 0) {
    range.getSheet().getRangeList(a1Notations).clearContent();
  }
}

// setBonusColumn - populates a Saturday bonus column (header, formula, background).
// Returns the next bonusCount value.
function setBonusColumn(sheet, currentCell, bonusCount, bonusColumn) {
  currentCell.offset(0, 1).setValue('Bonus');
  currentCell.offset(-1, 1).setValue(bonusCount);
  sheet.getRange(4, bonusColumn).setFormula(
    'SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,'
    + getLockedRowA1Notation(sheet, 2, bonusColumn)
    + ',UBonus_Complete,TRUE)'
  );
  sheet.getRange(2, bonusColumn, 3, 1).setBackground('#00ff00');
  return bonusCount + 1;
}

function populateTrackerSheet(sheet, startDate) {

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0); // Last day of the start month

  // Clear necessary cells
  sheet.getRange('I2:AS4').clearContent();
  sheet.getRange('I2:AS4').setBackground(null); // Clear previous background colors

  // Populate the dates and identify bonus weeks
  let currentDate = new Date(startDate); // Copy startDate to avoid altering it
  let bonusCount = 1;
  const columnStart = 9; // Column 'I' is the 9th column
  let currentColumn = columnStart;

  while (currentDate <= endDate) {
    const currentCell = sheet.getRange(3, currentColumn);
    currentCell.setValue(currentDate);
    currentCell.setNumberFormat("MM/dd");

    // Set color for date columns
    sheet.getRange(3, currentColumn).setBackground('#ff9900');

    // Check if it's a Saturday
    if (currentDate.getDay() === 6) { // 6 represents Saturday
      bonusCount = setBonusColumn(sheet, currentCell, bonusCount, currentColumn + 1);
      currentColumn++; // Increment to skip the bonus label column
    }

    currentDate.setDate(currentDate.getDate() + 1); // Increment the date by one day
    currentColumn++; // Move to the next column
  }

  // Always add a trailing Bonus column after the last day (if last day wasn't Saturday, no bonus was added in the loop)
  if (endDate.getDay() !== 6) {
    setBonusColumn(sheet, sheet.getRange(3, currentColumn - 1), bonusCount, currentColumn);
    currentColumn++;
  }

  SpreadsheetApp.flush();

  // Adjust column visibility based on the month's end.
  // Hide only within the dynamic tracker window (I..AS); keep AT+ summary columns visible.
  const LAST_DYNAMIC_TRACKER_COLUMN = 45; // Column AS
  const hideCount = Math.max(0, LAST_DYNAMIC_TRACKER_COLUMN - currentColumn + 1);
  if (hideCount > 0) {
    sheet.hideColumns(currentColumn, hideCount);
  }
  if (columnStart < currentColumn) {
    sheet.showColumns(columnStart, currentColumn - columnStart);
  }

  NoticeLog('The Tracker sheet has been updated successfully.');
}

var MONTHLY_AUTO_GENERATE_HANDLER_ = 'autoGenerateNextMonthTracker';

/**
 * Installs a time-based trigger that fires on the 20th of each month at 2 AM to auto-generate
 * the next month's tracker and HC form. Intended for the template spreadsheet only.
 * Clears any existing monthly auto-generate trigger before registering.
 */
function initializeMonthlyTrigger() {
  return GasLogger.run('initializeMonthlyTrigger', function() {
    clearMonthlyAutoGenerateTrigger_();
    ScriptApp.newTrigger(MONTHLY_AUTO_GENERATE_HANDLER_)
      .timeBased()
      .onMonthDay(20)
      .inTimezone(Session.getScriptTimeZone())
      .atHour(2)
      .nearMinute(0)
      .create();
    GasLogger.log('initializeMonthlyTrigger', { triggerDay: 20, triggerHour: 2 });
    SpreadsheetApp.getUi().alert('Monthly auto-generate trigger set for the 20th of each month at 2 AM.');
  });
}

function clearMonthlyAutoGenerateTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === MONTHLY_AUTO_GENERATE_HANDLER_) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * True only on the Go30 Template's bound script project. Script Properties are never
 * copied when a spreadsheet is duplicated via .copy(), so this flag — set once, manually,
 * in the Template's Apps Script project settings — reliably distinguishes the Template
 * from any monthly tracker copy (which inherits the Template's Config sheet *values* but
 * gets its own, empty, Script Properties store).
 */
function isTemplateHost_() {
  return PropertiesService.getScriptProperties().getProperty('IS_TEMPLATE_HOST') === 'true';
}

/**
 * Headless auto-generate: creates next month's tracker spreadsheet and HC form without
 * any UI interaction. Intended to be run by a time-based trigger installed via
 * initializeMonthlyTrigger(). Emails the Site Q on success or failure.
 */
function autoGenerateNextMonthTracker() {
  return GasLogger.run('autoGenerateNextMonthTracker', autoGenerateNextMonthTracker_);
}

/**
 * Decides what to do with the persisted "Signup Short URL" Config row given a redirect
 * verification result. Pure decision logic, kept free of UrlFetchApp/shortenUrl so it is
 * unit-testable — callers perform the actual redirect check and shortening.
 *
 * Only the very first run (no existingShortUrl yet) is expected to create one; any mismatch
 * after that is unexpected (e.g. the web app deployment ID changed) and must be escalated.
 *
 * @param {string|null} existingShortUrl  Current 'Signup Short URL' Config value, if any.
 * @param {string|null} actualRedirectTarget Where existingShortUrl currently redirects, or null if unchecked/missing.
 * @param {string} expectedTarget The webapp cmd=signup URL the short URL should point to.
 * @returns {{action: 'reuse'|'create'|'repair', warn: boolean}}
 */
function decideSignupShortUrlAction_(existingShortUrl, actualRedirectTarget, expectedTarget) {
  if (!existingShortUrl) {
    return { action: 'create', warn: false };
  }
  if (actualRedirectTarget === expectedTarget) {
    return { action: 'reuse', warn: false };
  }
  return { action: 'repair', warn: true };
}

/**
 * Resolves the redirect target of a short URL without following it, via UrlFetchApp.
 * Returns null (rather than throwing) on any non-redirect response or fetch failure, so
 * callers treat "can't verify" the same as "needs repair".
 * @param {string} shortUrl
 * @returns {string|null} The Location header value, or null.
 */
function resolveShortUrlRedirectTarget_(shortUrl) {
  try {
    var response = UrlFetchApp.fetch(shortUrl, { followRedirects: false, muteHttpExceptions: true });
    var headers = response.getAllHeaders() || {};
    return headers.Location || headers.location || null;
  } catch (e) {
    GasLogger.log('resolveShortUrlRedirectTarget_.error', { shortUrl: shortUrl, error: e.message });
    return null;
  }
}

/**
 * Ensures the stable, NameSpace-derived signup short URL (Config row 'Signup Short URL')
 * points at the web app's cmd=signup URL, creating or repairing it as needed.
 * @param {Sheet} configSheet
 * @param {Array<Array>} configRows Mutable rows array kept in sync by upsertConfigSheetRow_.
 * @param {string} nameSpace
 * @returns {string} The verified/created signup short URL.
 */
function ensureSignupShortUrl_(configSheet, configRows, nameSpace) {
  // Use stored WEBAPP_URL if available (set by webapp's setWebappUrl action),
  // otherwise fall back to ScriptApp.getService().getUrl()
  var webappUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
  var serviceUrl = webappUrl || ScriptApp.getService().getUrl();
  var expectedTarget = serviceUrl + '?cmd=signup';

  var existing = getConfigValue_(null, 'Signup Short URL', configRows);
  var existingShortUrl = existing && existing.primary ? existing.primary : null;
  var actualTarget = existingShortUrl ? resolveShortUrlRedirectTarget_(existingShortUrl) : null;

  var decision = decideSignupShortUrlAction_(existingShortUrl, actualTarget, expectedTarget);

  if (decision.action === 'reuse') {
    return existingShortUrl;
  }

  if (decision.warn) {
    GasLogger.log('ensureSignupShortUrl_.mismatch', {
      existingShortUrl: existingShortUrl,
      actualTarget: actualTarget,
      expectedTarget: expectedTarget
    });
  }

  var alias = nameSpace + 'Signup';
  var newShortUrl = expectedTarget;
  try {
    newShortUrl = shortenUrl(expectedTarget, alias, 5, 'tinyurl');
  } catch (e) {
    GasLogger.log('ensureSignupShortUrl_.shortenUrlFailed', { error: e.message });
  }

  upsertConfigSheetRow_(configSheet, configRows, 'Signup Short URL', newShortUrl, '');

  GasLogger.log('ensureSignupShortUrl_.' + decision.action, { shortUrl: newShortUrl });
  return newShortUrl;
}

function autoGenerateNextMonthTracker_() {
  const today = new Date();
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const paddedMonth = String(nextMonthStart.getMonth() + 1).padStart(2, '0');

  const currentSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = currentSpreadsheet.getSheetByName('Config');
  const configData = configSheet ? configSheet.getDataRange().getValues() : null;

  const siteQConfig = getConfigValue_(null, 'Site Q', configData);
  if (!siteQConfig || !siteQConfig.secondary) {
    GasLogger.log('autoGenerateNextMonthTracker.siteQMissing', {});
    return;
  }
  const siteQEmail = siteQConfig.secondary;
  const siteQName = siteQConfig.primary || 'Site Q';

  if (!isTemplateHost_()) {
    GasLogger.log('autoGenerateNextMonthTracker.wrongHost', {});
    sendConfiguredEmail_({
      spreadsheet: currentSpreadsheet,
      configData: configData,
      recipientList: siteQEmail,
      subject: 'F3 Go30: Auto-generate failed — wrong host',
      body: 'autoGenerateNextMonthTracker fired on a spreadsheet that is not the Go30 Template host ' +
        '(the IS_TEMPLATE_HOST script property is not set on this spreadsheet\'s Apps Script project). ' +
        'This trigger must only run from the Template. Please delete this trigger from this spreadsheet ' +
        '(Apps Script editor > Triggers) and confirm "Initialize Monthly Trigger" is only ever run from the Template.'
    });
    return;
  }

  const nameSpaceConfig = getConfigValue_(null, 'NameSpace', configData);
  if (!nameSpaceConfig || !nameSpaceConfig.primary) {
    GasLogger.log('autoGenerateNextMonthTracker.nameSpaceMissing', {});
    sendConfiguredEmail_({
      spreadsheet: currentSpreadsheet,
      configData: configData,
      recipientList: siteQEmail,
      subject: 'F3 Go30: Auto-generate failed',
      body: 'autoGenerateNextMonthTracker failed: NameSpace not found in Config sheet.'
    });
    return;
  }
  const smokeMode = PropertiesService.getScriptProperties().getProperty('SMOKE_MODE') === 'true';
  const nameSpace = nameSpaceConfig.primary + (smokeMode ? ' (Smoke)' : '');
  const newSpreadsheetName = nextMonthStart.getFullYear() + '-' + paddedMonth + '-' + nameSpace;

  GasLogger.log('autoGenerateNextMonthTracker.creating', { spreadsheetName: newSpreadsheetName, smokeMode: smokeMode });

  let result;
  try {
    const currentFile = DriveApp.getFileById(currentSpreadsheet.getId());
    const parents = currentFile.getParents();
    if (!parents.hasNext()) {
      throw new Error('Spreadsheet must be in a Drive folder, not in My Drive root.');
    }
    const folder = parents.next();

    result = createTrackerSpreadsheet_({
      sourceSpreadsheet: currentSpreadsheet,
      startDate: nextMonthStart,
      newSpreadsheetName: newSpreadsheetName,
      folder: folder,
      smokeMode: smokeMode,
      nameSpace: nameSpace,
      siteQConfig: siteQConfig,
      configSheet: configSheet,
      configData: configData
    });

    const emailMessage = buildOnboardingEmailTemplate_({
      trackerName: newSpreadsheetName,
      siteName: siteQName,
      trackerUrl: result.trackerSheetShortUrl,
      formUrl: result.formShortUrl,
      ownerAccount: siteQConfig.primary,
      initSteps: [
        'Open the new spreadsheet and verify it looks correct',
        'Open the HC form and verify it looks correct'
      ],
      postCopyChecklist: [
        'Open new spreadsheet and verify layout',
        'Open HC form and verify title + choices',
        'Verify Config rows (Signup HC Form, Sheet Template, Site Q, NameSpace)',
        'Confirm TrackerDB sheet entry for new tracker and form',
        'Verify form sharing, file name and folder placement',
        'Run test reuse flow (Test Reuse menu or submit sample)',
        'Copy Slack message from sidebar and post to channel',
        'Verify Help sheet Next Month signup link (optional)',
        'Verify Config sheet hidden and sensitive values protected'
      ],
      slackReadyMessage: result.slackMsg,
      operatorName: null,
      contactEmail: siteQEmail,
      appVersion: APP_VERSION
    });

    sendConfiguredEmail_({
      spreadsheet: currentSpreadsheet,
      configData: configData,
      recipientList: siteQEmail,
      subject: emailMessage.subject,
      body: emailMessage.body,
      htmlBody: emailMessage.htmlBody,
      allowPlainTextFallback: true,
      logLabel: 'autoGenerateNextMonthTracker'
    });

    GasLogger.log('autoGenerateNextMonthTracker', {
      spreadsheetId: result.newSpreadsheetId,
      spreadsheetName: newSpreadsheetName,
      trackerUrl: result.trackerSheetShortUrl,
      formUrl: result.formShortUrl,
      signupShortUrl: result.signupShortUrl,
      emailSent: true
    });

  } catch (err) {
    const orphanId = err.orphanedSpreadsheetId || null;
    GasLogger.log('autoGenerateNextMonthTracker.error', {
      error: err.message,
      spreadsheetName: newSpreadsheetName || '(unknown)',
      spreadsheetId: orphanId
    });
    try {
      sendConfiguredEmail_({
        spreadsheet: currentSpreadsheet,
        configData: configData,
        recipientList: siteQEmail,
        subject: 'F3 Go30: Auto-generate failed for ' + newSpreadsheetName,
        body: 'autoGenerateNextMonthTracker failed.\n\n' +
          'Error: ' + err.message + '\n\n' +
          (err.stack ? 'Stack:\n' + err.stack + '\n\n' : '') +
          (orphanId ? 'Orphaned spreadsheet ID: ' + orphanId + ' — please delete it from Drive.' : ''),
        logLabel: 'autoGenerateNextMonthTracker.error'
      });
    } catch (mailErr) {
      GasLogger.log('autoGenerateNextMonthTracker.errorEmailFailed', { error: mailErr.message });
    }
    throw err;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decideSignupShortUrlAction_: decideSignupShortUrlAction_,
    ensureLinksSheetSchema_: ensureLinksSheetSchema_,
    getTemplateSpreadsheetForInit_: getTemplateSpreadsheetForInit_,
    hideInternalSheets_: hideInternalSheets_,
    upsertLinksRow_: upsertLinksRow_
  };
}

