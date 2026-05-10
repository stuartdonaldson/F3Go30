
var MONTH_NAMES_ = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var LINKS_SHEET_HEADERS_ = ['Date', 'StartDate', 'ShortTracker', 'TrackerURL', 'ShortHC', 'HC URL'];
var LINKS_SHEET_COLUMN_MAP_ = {
  date: 'Date',
  startDate: 'StartDate',
  shortTracker: 'ShortTracker',
  trackerUrl: 'TrackerURL',
  shortHc: 'ShortHC',
  hcUrl: 'HC URL'
};

/**
 * Creates a new monthly tracker spreadsheet from the current template.
 * Spreadsheet name is auto-generated as YYYY-MM-NameSpace using the NameSpace
 * value from the Config sheet and the operator-supplied start date.
 */
function copyAndInit() {
  GasLogger.init('copyAndInit');
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
  const nameSpace = nameSpaceConfig.primary;

  const paddedMonth = String(startDate.getMonth() + 1).padStart(2, '0');
  const newSpreadsheetName = startDate.getFullYear() + '-' + paddedMonth + '-' + nameSpace;

  NoticeLog('Creating ' + newSpreadsheetName + '. Please wait...');
  let newSpreadsheet;
  let newSpreadsheetId = null;
  try {
      NoticeLog('Copying spreadsheet...');
      newSpreadsheet = currentSpreadsheet.copy(newSpreadsheetName);
      newSpreadsheetId = newSpreadsheet.getId();

      // Move the new spreadsheet to the same folder as the current spreadsheet
      const currentSpreadsheetFile = DriveApp.getFileById(currentSpreadsheet.getId());
      const newSpreadsheetFile = DriveApp.getFileById(newSpreadsheetId);
      const parents = currentSpreadsheetFile.getParents();
      if (!parents.hasNext()) {
        NoticeLog('Error: cannot determine folder — spreadsheet must be in a Drive folder, not in My Drive root.');
        NoticeLog('Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.');
        return;
      }
      const folder = parents.next();
      newSpreadsheetFile.moveTo(folder);

      // PAX interact via the Form only — VIEW permission is sufficient and prevents data corruption
      newSpreadsheetFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Get the URL to the "Tracker" sheet
    const trackerSheet = newSpreadsheet.getSheetByName('Tracker');
    if (!trackerSheet) {
      NoticeLog('Error: Tracker sheet not found in new spreadsheet.');
      NoticeLog('Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.');
      return;
    }
    const trackerSheetUrl = newSpreadsheet.getUrl() + '#gid=' + trackerSheet.getSheetId();
    const trackerAlias = newSpreadsheetName;
    let trackerSheetShortUrl = trackerSheetUrl;
    try {
      trackerSheetShortUrl = shortenUrl(trackerSheetUrl, trackerAlias, 5, "tinyurl");
    } catch (error) {
      NoticeLog('Shorten URL failed for tracker sheet: ' + error.message);
    }
    if (!trackerSheetShortUrl.startsWith('https://tinyurl.com')) {
      GasLogger.log('copyAndInit.warning', { warning: 'urlShortener failed for tracker sheet', alias: trackerAlias });
    }

    NoticeLog('New spreadsheet tracker sheet link: ' + createHtmlLink(newSpreadsheetName, trackerSheetShortUrl));

    // Update the form name and title, and move to the new folder
    NoticeLog('Updating form...');

      const formUrl = newSpreadsheet.getFormUrl();
      if (!formUrl) {
        NoticeLog('Error: no form linked to the new spreadsheet — ensure the template has an associated form.');
        NoticeLog('Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.');
        return;
      }
      const form = FormApp.openByUrl(formUrl);
      const formName = newSpreadsheetName + " HC";
      const paddedDay = String(startDate.getDate()).padStart(2, '0');
      const ftitle = startDate.getFullYear() + '-' + paddedMonth + '-' + paddedDay + ' HC Form';
      form.setTitle(ftitle);
      ensureReuseOptionOnLinkedForm_(form);
      const confirmationMessage =
        'Thank you for your Hard Commit!\n\n' +
        'View the Go30 tracker here: ' + trackerSheetShortUrl + '\n\n' +
        'Questions? Contact ' + siteQConfig.primary + ' (' + siteQEmail + ').';
      form.setConfirmationMessage(confirmationMessage);

      // change the filename of the form to formName
      const formFile = DriveApp.getFileById(form.getId());
      formFile.setName(formName);
      formFile.moveTo(folder);

    const formAlias = newSpreadsheetName + 'HC';
    let formShortUrl = formUrl;
    try {
      formShortUrl = shortenUrl(formUrl, formAlias, 5, "tinyurl");
    } catch (error) {
      NoticeLog('Shorten URL failed for form: ' + error.message);
    }

    if (!formShortUrl.startsWith('https://tinyurl.com')) {
      GasLogger.log('copyAndInit.warning', { warning: 'urlShortener failed for HC form', alias: formAlias });
    }

    NoticeLog('New HC Form: ' + createHtmlLink(formName, formShortUrl));

    // Persist canonical URLs into the created spreadsheet's Config sheet
    const newConfigSheet = newSpreadsheet.getSheetByName('Config');
    if (newConfigSheet) {
      const cfgRange = newConfigSheet.getDataRange();
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

      // Write full (non-shortened) URLs so the created spreadsheet has canonical links
      upsertConfigRow(newConfigSheet, cfgValues, 'Signup HC Form', formName, formUrl);
      upsertConfigRow(newConfigSheet, cfgValues, 'Last Month Tracker', newSpreadsheetName, trackerSheetUrl);
    }

    // Modify sheets in the new spreadsheet
    initSheets(newSpreadsheet, startDate);

    // Hide Config sheet — contains sensitive data (Site Q email)
    if (newConfigSheet) newConfigSheet.hideSheet();

    // Track all trackers created from this template — create Links sheet on first use
    const startDateIso = startDate.getFullYear() + '-' + paddedMonth + '-' + paddedDay;
    let linksSheet = openOrCreateSheet('Links', LINKS_SHEET_COLUMN_MAP_, LINKS_SHEET_HEADERS_);
    // Append short and full URLs (canonical full URLs stored in Tracker/Config of created spreadsheet)
    linksSheet.appendRow({
      date: new Date(),
      startDate: startDateIso,
      shortTracker: trackerSheetShortUrl,
      trackerUrl: trackerSheetUrl,
      shortHc: formShortUrl,
      hcUrl: formUrl
    });

  NoticeLog("-");
  NoticeLog('<b>Next steps:</b>');
  NoticeLog('1. Open the new spreadsheet (link above) and verify it looks correct');
  NoticeLog('2. F3 Go30 Menu > Initialize Triggers');
  NoticeLog('3. Open the HC form (link above) and verify it looks correct');
  NoticeLog("-");

  const slackMsg = buildSlackMessage_(startDate.getFullYear(), MONTH_NAMES_[startDate.getMonth()], formShortUrl, trackerSheetShortUrl);
  NoticeLog('<b>Slack channel message:</b>');
  NoticeLog('<textarea rows="5" style="width:100%;font-family:monospace;font-size:11px;resize:none;box-sizing:border-box;" readonly onclick="this.select()">' + escapeHtml_(slackMsg) + '</textarea>');
  NoticeLog("-");

  NoticeLog('You can now close this sidebar.');

  GasLogger.log('copyAndInit', {
    spreadsheetName: newSpreadsheetName,
    startDateIso: startDateIso,
    trackerUrl: trackerSheetShortUrl,
    formUrl: formShortUrl,
    templateSpreadsheetId: currentSpreadsheet.getId()
  }, true);

  noticeLogDone_();

  } catch (err) {
    if (newSpreadsheetId) {
      Logger.log('copyAndInit: error — spreadsheet ID: ' + newSpreadsheetId + ' — ' + err.message);
      NoticeLog('Error during initialization: ' + err.message);
      NoticeLog('Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.');
    } else {
      Logger.log('copyAndInit: copy() failed — ' + err.message);
      NoticeLog('Error: failed to copy spreadsheet — ' + err.message);
    }
    GasLogger.log('copyAndInit.error', {
      error: err.message,
      spreadsheetName: newSpreadsheetName,
      orphanedSpreadsheetId: newSpreadsheetId || null
    }, true);
    throw err;
  }
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
  if (!trackerSheet || !bonusTrackerSheet || !responsesSheet) {
    NoticeLog('Error: Required sheet(s) not found — Tracker, Bonus Tracker, and Responses must all exist.');
    return;
  }

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
  GasLogger.init('initializeMonthlyTrigger');
  clearMonthlyAutoGenerateTrigger_();
  ScriptApp.newTrigger(MONTHLY_AUTO_GENERATE_HANDLER_)
    .timeBased()
    .onMonthDay(20)
    .inTimezone(Session.getScriptTimeZone())
    .atHour(2)
    .nearMinute(0)
    .create();
  GasLogger.log('initializeMonthlyTrigger', { triggerDay: 20, triggerHour: 2 }, true);
  SpreadsheetApp.getUi().alert('Monthly auto-generate trigger set for the 20th of each month at 2 AM.');
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
 * Headless auto-generate: creates next month's tracker spreadsheet and HC form without
 * any UI interaction. Intended to be run by a time-based trigger installed via
 * initializeMonthlyTrigger(). Emails the Site Q on success or failure.
 */
function autoGenerateNextMonthTracker() {
  GasLogger.init('autoGenerateNextMonthTracker');
  const today = new Date();
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const paddedMonth = String(nextMonthStart.getMonth() + 1).padStart(2, '0');

  const currentSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = currentSpreadsheet.getSheetByName('Config');
  const configData = configSheet ? configSheet.getDataRange().getValues() : null;

  const siteQConfig = getConfigValue_(null, 'Site Q', configData);
  if (!siteQConfig || !siteQConfig.secondary) {
    Logger.log('autoGenerateNextMonthTracker: Site Q email not found in Config sheet — aborting');
    return;
  }
  const siteQEmail = siteQConfig.secondary;
  const siteQName = siteQConfig.primary || 'Site Q';

  const nameSpaceConfig = getConfigValue_(null, 'NameSpace', configData);
  if (!nameSpaceConfig || !nameSpaceConfig.primary) {
    Logger.log('autoGenerateNextMonthTracker: NameSpace not found in Config sheet — aborting');
    MailApp.sendEmail(siteQEmail, 'F3 Go30: Auto-generate failed',
      'autoGenerateNextMonthTracker failed: NameSpace not found in Config sheet.');
    return;
  }
  const nameSpace = nameSpaceConfig.primary;
  const newSpreadsheetName = nextMonthStart.getFullYear() + '-' + paddedMonth + '-' + nameSpace;

  Logger.log('autoGenerateNextMonthTracker: creating ' + newSpreadsheetName);

  let newSpreadsheetId = null;
  try {
    const newSpreadsheet = currentSpreadsheet.copy(newSpreadsheetName);
    newSpreadsheetId = newSpreadsheet.getId();

    const currentFile = DriveApp.getFileById(currentSpreadsheet.getId());
    const newFile = DriveApp.getFileById(newSpreadsheetId);
    const parents = currentFile.getParents();
    if (!parents.hasNext()) {
      throw new Error('Spreadsheet must be in a Drive folder, not in My Drive root.');
    }
    const folder = parents.next();
    newFile.moveTo(folder);
    newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const trackerSheet = newSpreadsheet.getSheetByName('Tracker');
    if (!trackerSheet) {
      throw new Error('Tracker sheet not found in new spreadsheet.');
    }
    const trackerSheetUrl = newSpreadsheet.getUrl() + '#gid=' + trackerSheet.getSheetId();

    let trackerSheetShortUrl = trackerSheetUrl;
    try {
      trackerSheetShortUrl = shortenUrl(trackerSheetUrl, newSpreadsheetName, 5, 'tinyurl');
    } catch (e) {
      Logger.log('autoGenerateNextMonthTracker: shorten URL failed for tracker: ' + e.message);
    }
    if (!trackerSheetShortUrl.startsWith('https://tinyurl.com')) {
      GasLogger.log('autoGenerateNextMonthTracker.warning', { warning: 'urlShortener failed for tracker sheet', alias: newSpreadsheetName });
    }

    const formUrl = newSpreadsheet.getFormUrl();
    if (!formUrl) {
      throw new Error('No form linked to new spreadsheet — ensure template has an associated form.');
    }
    const form = FormApp.openByUrl(formUrl);
    const formName = newSpreadsheetName + ' HC';
    const ftitle = nextMonthStart.getFullYear() + '-' + paddedMonth + '-01 HC Form';
    form.setTitle(ftitle);
    ensureReuseOptionOnLinkedForm_(form);
    form.setConfirmationMessage(
      'Thank you for your Hard Commit!\n\n' +
      'View the Go30 tracker here: ' + trackerSheetShortUrl + '\n\n' +
      'Questions? Contact ' + siteQName + ' (' + siteQEmail + ').'
    );

    const formFile = DriveApp.getFileById(form.getId());
    formFile.setName(formName);
    formFile.moveTo(folder);

    let formShortUrl = formUrl;
    try {
      formShortUrl = shortenUrl(formUrl, newSpreadsheetName + 'HC', 5, 'tinyurl');
    } catch (e) {
      Logger.log('autoGenerateNextMonthTracker: shorten URL failed for form: ' + e.message);
    }
    if (!formShortUrl.startsWith('https://tinyurl.com')) {
      GasLogger.log('autoGenerateNextMonthTracker.warning', { warning: 'urlShortener failed for HC form', alias: newSpreadsheetName + 'HC' });
    }

    initSheets(newSpreadsheet, nextMonthStart);

    const slackMsg = buildSlackMessage_(nextMonthStart.getFullYear(), MONTH_NAMES_[nextMonthStart.getMonth()], formShortUrl, trackerSheetShortUrl);

    var message = buildOnboardingEmailTemplate_({
      trackerName: newSpreadsheetName,
      siteName: siteQName,
      trackerUrl: trackerSheetShortUrl,
      formUrl: formShortUrl,
      ownerAccount: siteQConfig.primary,
      initSteps: [
        'Open the new spreadsheet and verify it looks correct',
        'F3 Go30 Menu > Initialize Triggers',
        'Open the HC form and verify it looks correct'
      ],
      slackReadyMessage: slackMsg,
      operatorName: null,
      contactEmail: siteQEmail
    });

    MailApp.sendEmail({
      to: siteQEmail,
      subject: message.subject,
      body: message.body,
      htmlBody: message.htmlBody
    });

    Logger.log('autoGenerateNextMonthTracker: done — ' + newSpreadsheetName);
    GasLogger.log('autoGenerateNextMonthTracker', {
      spreadsheetName: newSpreadsheetName,
      trackerUrl: trackerSheetShortUrl,
      formUrl: formShortUrl,
      emailSent: true
    }, true);

  } catch (err) {
    Logger.log('autoGenerateNextMonthTracker: error' +
      (newSpreadsheetId ? ' — spreadsheet ID: ' + newSpreadsheetId : '') +
      ' — ' + err.message);
    GasLogger.log('autoGenerateNextMonthTracker.error', {
      error: err.message,
      spreadsheetName: newSpreadsheetName || '(unknown)',
      spreadsheetId: newSpreadsheetId || null
    }, true);
    try {
      MailApp.sendEmail(
        siteQEmail,
        'F3 Go30: Auto-generate failed for ' + newSpreadsheetName,
        'autoGenerateNextMonthTracker failed.\n\n' +
        'Error: ' + err.message + '\n\n' +
        (err.stack ? 'Stack:\n' + err.stack + '\n\n' : '') +
        (newSpreadsheetId ? 'Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.' : '')
      );
    } catch (mailErr) {
      Logger.log('autoGenerateNextMonthTracker: also failed to send error email — ' + mailErr.message);
    }
    throw err;
  }
}

