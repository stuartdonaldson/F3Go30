

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

  NoticeLog('Creating ' + newSpreadsheetName + '. Please wait...');

    // Copy the entire current spreadsheet to a new spreadsheet with the specified name
    const currentSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    NoticeLog('Copying spreadsheet...');
    const newSpreadsheet = currentSpreadsheet.copy(newSpreadsheetName);

      // Move the new spreadsheet to the same folder as the current spreadsheet
      const currentSpreadsheetFile = DriveApp.getFileById(currentSpreadsheet.getId());
      const newSpreadsheetFile = DriveApp.getFileById(newSpreadsheet.getId());
      const folder = currentSpreadsheetFile.getParents().next();
      newSpreadsheetFile.moveTo(folder);

      // adjust permissions so anyone with the link can edit the new spreadsheet file
      newSpreadsheetFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

    NoticeLog('New spreadsheet Link: ' + blf(newSpreadsheetName, newSpreadsheet.getUrl()));


    // Update the form name and title, and  move to the new folder
    NoticeLog('Updating form...');

      const formUrl = newSpreadsheet.getFormUrl();
      const form = FormApp.openByUrl(formUrl);
      const formName = newSpreadsheetName + " HC";
      // set form title to the name "YYYY-MM-DD HC Form"
      const ftitle = startDate.getFullYear() + '-' 
                    + (startDate.getMonth() + 1) + '-' + startDate.getDate() 
                    + ' HC Form';
      form.setTitle(ftitle);
      
      // change the filename of the form to formName
      const formFile = DriveApp.getFileById(form.getId());
      formFile.setName(formName);
      formFile.moveTo(folder);

    NoticeLog('New HC Form: ' + blf(formName, formUrl));

    // Modify sheets in the new spreadsheet
    initSheets(newSpreadsheet, startDate);

  NoticeLog('Next steps:');
  NoticeLog('1. Open the new spreadsheet');
  NoticeLog('2. F3 Go30 Menu > Initialize Triggers');
  NoticeLog('3. Shorten and Share Form URL');
  NoticeLog('4. Shorten and share new Spreadsheet URL');
  
  NoticeLog('You can now close this message.');
}

function initializeTriggers() {
  setupDailyMinusOneTrigger();
  setupFormSubmitTrigger();
}
function initSheets(newSpreadsheet, startDate) {

  const trackerSheet = newSpreadsheet.getSheetByName('Tracker');
  const bonusTrackerSheet = newSpreadsheet.getSheetByName('Bonus Tracker');
  const responsesSheet = newSpreadsheet.getSheetByName('Responses');

  NoticeLog('Resetting Tracker sheet...');
    if (trackerSheet.getLastRow() > 4) {
      trackerSheet.deleteRows(5, trackerSheet.getLastRow() - 4);
    }
    clearNonFormulaCells(trackerSheet.getRange('A4:AR4'));

    populateTrackerSheet(trackerSheet, startDate)

  NoticeLog('Resetting Bonus Tracker sheet...');
    if (bonusTrackerSheet.getLastRow() > 1) {
      bonusTrackerSheet.getRange('A2:Z' + bonusTrackerSheet.getLastRow()).clearContent();  // Adjust 'Z' according to your last column
    }

  NoticeLog('Resetting Responses sheet...');
  if (responsesSheet.getLastRow() > 1) {
    responsesSheet.deleteRows(2, responsesSheet.getLastRow() - 1);
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

function populateTrackerSheet(sheet, startDate) {

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0); // Last day of the start month

  // Clear necessary cells
  sheet.getRange('I2:AR4').clearContent();
  sheet.getRange('I2:AR4').setBackground(null); // Clear previous background colors

  // Populate the dates and identify bonus weeks
  let currentDate = new Date(startDate); // Copy startDate to avoid altering it
  let bonusCount = 1;
  const columnStart = 9; // Column 'I' is the 9th column
  let currentColumn = columnStart;

  while (currentDate <= endDate) {
    SpreadsheetApp.flush();
    const currentCell = sheet.getRange(3, currentColumn);
    currentCell.setValue(currentDate);
    currentCell.setNumberFormat("MM/dd");

    // Set color for date columns
    sheet.getRange(3, currentColumn).setBackground('#ff9900');

    function setBonusColumn( bonusColumn ) {
      // Set Bonus value and week number
      currentCell.offset(0, 1).setValue('Bonus');
      currentCell.offset(-1, 1).setValue(bonusCount);

      // Set formula in row 4 for Bonus column
      const bonusCellRow4 = sheet.getRange(4, bonusColumn);
      bonusCellRow4.setFormula('SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,'
                                + getLockedRowA1Notation( sheet, 2, bonusColumn)
                                + ',UBonus_Complete,TRUE)');

      // Set background color to green for Bonus columns
      var c2 = sheet.getRange(2, bonusColumn, 3, 1);
      sheet.getRange(2, bonusColumn, 3, 1).setBackground('#00ff00');

      bonusCount++;
    }
    // Check if it's a Saturday
    if (currentDate.getDay() === 6) { // 6 represents Saturday
      setBonusColumn( currentColumn + 1 );
      currentColumn++; // Increment to skip the bonus label column
    }

    currentDate.setDate(currentDate.getDate() + 1); // Increment the date by one day
    currentColumn++; // Move to the next column
  }

  // Adjust column visibility based on the month's end
  if (currentColumn <= 44) { // Column 'AR' is the 44th column
    sheet.hideColumns(currentColumn, 44 - currentColumn + 1);
  }
  if (columnStart < currentColumn) {
    sheet.showColumns(columnStart, currentColumn - columnStart);
  }

  NoticeLog('The Tracker sheet has been updated successfully.');
}


function decodeDate( msg, date ) {
    var sY = date.getFullYear();
    var sM = date.getMonth();
    console.log(`${msg}: ${date} -- ${sY}, ${sM}`);
  }
