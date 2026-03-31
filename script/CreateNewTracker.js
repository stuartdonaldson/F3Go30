
/**
 * Creates a new spreadsheet with the same structure as the current spreadsheet, 
 * initializes it with a specified start date, and updates associated form details.
 * 
 * The function performs the following steps:
 * 1. Prompts the user for the name of the new spreadsheet and a start date.
 * 2. Copies the current spreadsheet to a new one with the specified name.
 * 3. Moves the new spreadsheet to the same folder as the current spreadsheet.
 * 4. Updates sharing permissions for the new spreadsheet to allow anyone with the link to edit.
 * 5. Updates the associated Google Form's title and filename based on the start date.
 * 6. Initializes the sheets in the new spreadsheet with the provided start date.
 * 7. Logs instructions for the user to complete additional setup steps.
 * 
 * @throws {Error} If the user cancels any of the prompts or provides invalid input.
 */
function copyAndInit() {
  NoticeLogInit("Create New Tracker", "This script will create a new spreadsheet with the same structure as the current spreadsheet. Please enter the name for the new spreadsheet.");

  const newSpreadsheetName = NoticePrompt("Enter the name of the new spreadsheet");
  if (!newSpreadsheetName) {
    NoticeLog('Operation canceled.');
    return;
  }
  var response = NoticePrompt("Enter start date YYYY-MM-DD");
  if (!response) {
      NoticeLog('Operation canceled.');
      return;
  }
  const startDate = new Date(response + 'T00:00:00'); // Ensures the date is treated as local time
  
  if (isNaN(startDate.getTime())) {
    NoticeLog('Invalid date format. Please use YYYY-MM-DD format.');
    NoticeLog('Operation canceled.');
    return;
  }

  const currentSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const siteQConfig = getConfigValue_(currentSpreadsheet, 'Site Q');
  if (!siteQConfig || !siteQConfig.secondary) {
    NoticeLog('Error: Site Q email not found in Config sheet — add a "Site Q" row with the email address in the secondary column.');
    return;
  }
  const siteQEmail = siteQConfig.secondary;

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

      // Adjust permissions so anyone with the link can edit the new spreadsheet file
      newSpreadsheetFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

    // Get the URL to the "Tracker" sheet
    const trackerSheet = newSpreadsheet.getSheetByName('Tracker');
    if (!trackerSheet) {
      NoticeLog('Error: Tracker sheet not found in new spreadsheet.');
      NoticeLog('Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.');
      return;
    }
    const trackerSheetUrl = newSpreadsheet.getUrl() + '#gid=' + trackerSheet.getSheetId();
    const trackerAlias = newSpreadsheetName.replace(/\s+/g, "");
    let trackerSheetShortUrl = trackerSheetUrl;
    try {
      trackerSheetShortUrl = shortenUrl(trackerSheetUrl, trackerAlias, 5, "tinyurl");
    } catch (error) {
      NoticeLog('Shorten URL failed for tracker sheet: ' + error.message);
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
      // set form title to the name "YYYY-MM-DD HC Form"
      const paddedMonth = String(startDate.getMonth() + 1).padStart(2, '0');
      const paddedDay = String(startDate.getDate()).padStart(2, '0');
      const ftitle = startDate.getFullYear() + '-' + paddedMonth + '-' + paddedDay + ' HC Form';
      form.setTitle(ftitle);

      // change the filename of the form to formName
      const formFile = DriveApp.getFileById(form.getId());
      formFile.setName(formName);
      formFile.moveTo(folder);

    const formAlias = formName.replace(/\s+/g, "");
    let formShortUrl = formUrl;
    try {
      formShortUrl = shortenUrl(formUrl, formAlias, 5, "tinyurl");
    } catch (error) {
      NoticeLog('Shorten URL failed for form: ' + error.message);
    }

    NoticeLog('New HC Form: ' + createHtmlLink(formName, formShortUrl));

    // Modify sheets in the new spreadsheet
    initSheets(newSpreadsheet, startDate);

  NoticeLog("-");
  NoticeLog('<b>Next steps:</b>');
  NoticeLog('1. Open the new spreadsheet');
  NoticeLog('2. F3 Go30 Menu > Initialize Triggers');
  NoticeLog('3. Shorten and Share Form URL');
  NoticeLog('4. Shorten and share new Spreadsheet URL');
  NoticeLog("-");

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const slackYear = startDate.getFullYear();
  const slackMonth = MONTH_NAMES[startDate.getMonth()];
  const slackMsg = slackYear + ' ' + slackMonth + ' Hard Commit form is up:\n' + formShortUrl + '\n\n' + slackYear + ' ' + slackMonth + ' Tracker:\n' + trackerSheetShortUrl;
  NoticeLog('<b>Slack channel message:</b>');
  NoticeLog('<textarea rows="5" style="width:100%;font-family:monospace;font-size:11px;resize:none;box-sizing:border-box;" readonly onclick="this.select()">' + slackMsg + '</textarea>');
  NoticeLog("-");

  NoticeLog('You can now close this sidebar.');

  } catch (err) {
    if (newSpreadsheetId) {
      Logger.log('copyAndInit: error — spreadsheet ID: ' + newSpreadsheetId + ' — ' + err.message);
      NoticeLog('Error during initialization: ' + err.message);
      NoticeLog('Orphaned spreadsheet ID: ' + newSpreadsheetId + ' — please delete it from Drive.');
    } else {
      Logger.log('copyAndInit: copy() failed — ' + err.message);
      NoticeLog('Error: failed to copy spreadsheet — ' + err.message);
    }
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

  var response = NoticePrompt("Enter start date YYYY-MM-DD");
  if (!response) {
    NoticeLog('Operation canceled.');
    return;
  }
  const startDate = new Date(response + 'T00:00:00'); // Ensures the date is treated as local time
  
  if (isNaN(startDate.getTime())) {
    NoticeLog('Invalid date format. Please use YYYY-MM-DD format.');
    NoticeLog('Operation canceled.');
    return;
  }

  NoticeLog('Reinitializing sheets. Please wait...');

  initSheets(SpreadsheetApp.getActiveSpreadsheet(), startDate);
  SpreadsheetApp.flush();

  NoticeLog('The sheets have been reinitialized successfully.');
  NoticeLog('You can now close this message.');
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
      bonusTrackerSheet.getRange('A2:Z' + bonusTrackerSheet.getLastRow()).clearContent();  // Adjust 'Z' according to your last column
      SpreadsheetApp.flush();
    }

  NoticeLog('Resetting Responses sheet...');
  if (responsesSheet.getLastRow() > 1) {
    responsesSheet.deleteRows(2, responsesSheet.getLastRow() - 1);
    SpreadsheetApp.flush();
  }
}

function clearNonFormulaCells(range) {
  const values = range.getValues()[0];
  const formulas = range.getFormulas()[0];

  // Clear content of cells that do not contain formulas
  for (let i = 0; i < values.length; i++) {
    if (!formulas[i]) {  // If the cell does not contain a formula
      range.getCell(1, i + 1).clearContent();  // Clear content of the cell
    }
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
  SpreadsheetApp.flush();

  // Adjust column visibility based on the month's end
  if (currentColumn <= 44) { // Column 'AR' is the 44th column
    sheet.hideColumns(currentColumn, 44 - currentColumn + 1);
  }
  if (columnStart < currentColumn) {
    sheet.showColumns(columnStart, currentColumn - columnStart);
  }

  NoticeLog('The Tracker sheet has been updated successfully.');
}

