/**
 * The onOpen function is triggered when the Google Sheets document is opened.
 * Builds the F3 Go30 custom menu. Management items (Copy and Initialize, triggers,
 * reinitialize) are shown only to the spreadsheet owner. About is shown to all users.
 */
function onOpen() {
  return GasLogger.run('onOpen', onOpen_);
}

function onOpen_()
{
  var ui = SpreadsheetApp.getUi();
  var email = Session.getActiveUser().getEmail();
  var owner = SpreadsheetApp.getActiveSpreadsheet().getOwner(); // null on Team Drives
  var owneremail = owner ? owner.getEmail() : null;

  var menu = ui.createMenu('F3 Go30');

  if (owneremail && email === owneremail) {
    menu.addItem('Copy and Initialize', 'copyAndInit')
        .addItem('Initialize Template Dispatch Triggers (Template only!)', 'initializeTemplateDispatchTriggers')
        .addItem('Initialize Monthly Trigger', 'initializeMonthlyTrigger')
        .addItem('Reinitialize this spreadsheet', 'reinitializeSheets')
        .addSeparator()
      .addItem('Run test function (DEV)', 'testFunction')
      .addItem('Test Reuse', 'testReuseMenu')
        .addSeparator();
  }

  menu.addItem('About', 'showAbout')
      .addToUi();

  try {
    logActivity('onOpen','');
  } catch (e) {
    GasLogger.log('onOpen.logActivityFailed', { error: e.message });
  }
}

/**
 * Displays an About dialog with version info and author contact.
 */
function showAbout() {
  const html = HtmlService.createHtmlOutput(
    '<style>' +
    '  body { font-family: Arial, sans-serif; padding: 16px; font-size: 13px; color: #333; }' +
    '  h2 { margin-top: 0; }' +
    '  p { margin: 6px 0; }' +
    '  .label { font-weight: bold; }' +
    '  hr { border: none; border-top: 1px solid #ddd; margin: 12px 0; }' +
    '</style>' +
    '<h2>F3 Go30 Tracker</h2>' +
    '<p>Automates the monthly lifecycle of Go30 fitness challenge trackers — ' +
    'copying the template, linking the HC sign-up form, initializing sheets, ' +
    'setting up triggers, and nightly miss-marking.</p>' +
    '<hr>' +
    '<p><span class="label">Version:</span> ' + APP_VERSION + ' (' + APP_VERSION_DATE + ')</p>' +
    '<p><span class="label">Author:</span> ' + APP_AUTHOR + '</p>' +
    '<p><span class="label">Contact:</span> <a href="mailto:' + APP_CONTACT + '">' + APP_CONTACT + '</a></p>'
  ).setWidth(420).setHeight(230);

  SpreadsheetApp.getUi().showModalDialog(html, 'About F3 Go30');
}

/**
 * Installs the two daily ADR-010 dispatch triggers — minus-one marking (markMinusOne.js)
 * and nag email (nag.js) — exactly once, on the Go30 Template only. Both triggers now
 * resolve their target tracker per run via TrackerDB (resolveTrackerForContextDate), so
 * they must not be installed per monthly copy; form-submit trigger setup happens
 * automatically per tracker in CreateNewTracker.js and is not part of this menu item.
 */
function initializeTemplateDispatchTriggers() {
  return GasLogger.run('initializeTemplateDispatchTriggers', function() {
    if (typeof isTemplateHost_ === 'function' && !isTemplateHost_()) {
      SpreadsheetApp.getUi().alert(
        'This installs the daily ADR-010 dispatch triggers (minus-one marking, nag email). ' +
        'Run this once, on the Go30 Template only — not on a monthly tracker copy.'
      );
    }
    setupDailyMinusOneTrigger();
    if (typeof setupDailyNagTrigger === 'function') {
      try { setupDailyNagTrigger(); } catch (e) { GasLogger.log('initializeTemplateDispatchTriggers.setupDailyNagTriggerFailed', { error: e.message }); }
    }
  });
}


// test function invoked by test menu item above.
function testFunction() 
{
  openNextMonthSignup();
  // testNotificationSidebar();
  //  shortenUrlWithBitly('https://docs.google.com/spreadsheets/d/1y2c5r-_R0UJRdjEcDPpQSG9WtepTV6JFuYwCB0xbCak/edit?usp=sharing', '77128118e9be8d7000c153a56edaf733b259e112');
}

/*
THIS IS NOT UTILIZED YET - NEED TO DEFINE THE RIGHT STRATEGY TO TAKE HERE

The process around nextMonthSignup needs to be tested.
When creating the URL for the signup, place it in the Help sheet.  At least they can get there from here.
Consider adding a link to the signup on the Tracker page in the header area?
A good user experience is to add a drawing "click here for next month" and link to this function
Unfortunately, adding the drawing and linking is not automated.

Consider in the Template, creating a list of previous month sheets and HC forms.
Could use that from the template to go update previous month Help sheet with link to the form.
But right now we should just manually do that part.
*/

function openNextMonthSignup() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Help");
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Help sheet not found.');
    return;
  }
  const data = sheet.getRange("A:B").getValues();

  let targetUrl = null;
  
  // Find the URL where column A contains "Next Month HC Signup"
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === "Next Month HC Signup") {
      targetUrl = data[i][1];  // Value in column B
      break;
    }
  }

  if (targetUrl) {
    if (!targetUrl.startsWith('https://')) {
      SpreadsheetApp.getUi().alert("Invalid URL for 'Next Month HC Signup'. Must start with https://.");
      return;
    }
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 20px;">
        <h2>Next Month's HC Signup</h2>
        <p>Click the link below to open the signup page:</p>
        <p><a href="${targetUrl}" target="_blank" style="font-size: 16px; color: blue;">Go to Signup</a></p>
        <p>This window will close automatically after 15 seconds.</p>
        <script>
          setTimeout(function() {
            google.script.host.close();
          }, 15000);
        </script>
      </div>
    `;
    
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(htmlContent),
      'Opening URL...'
    );
  } else {
    SpreadsheetApp.getUi().alert("No URL found for 'Next Month HC Signup'.");
  }
}

// The Inspiration sheet contains a Quote and Author for famous inspirational quotes for F3.
// InspireNow() will randomly select an inspiration from the inspiration sheet, and populate the cell Tracker!H1 with the value.
function InspireNow() {
  return GasLogger.run('InspireNow', function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Inspiration");
    const trackerSheet = ss.getSheetByName("Tracker");

    if (!sheet || !trackerSheet) {
      GasLogger.log('InspireNow.missingSheet', { inspirationFound: !!sheet, trackerFound: !!trackerSheet });
      return;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      GasLogger.log('InspireNow.noRowsFound', {});
      return;
    }
    const randomIndex = Math.floor(Math.random() * (data.length - 1)) + 1; // Exclude header row
    const randomQuote = data[randomIndex][0];
    const randomAuthor = data[randomIndex][1];

    trackerSheet.getRange("H1").setValue(`"${randomQuote}" - ${randomAuthor}`);
  });
}

/**
 * testReuseMenu
 * Owner-only menu action to append a dummy Responses row and invoke the
 * on-form-submit handler to exercise the reuse-last-months-goals path.
 */
function testReuseMenu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var responsesSheet = ss.getSheetByName('Responses');
  if (!responsesSheet) { ui.alert('Responses sheet not found.'); return; }

  var numCols = responsesSheet.getLastColumn() || 11;
  var cols = null;
  try { cols = resolveResponseColumns(responsesSheet); } catch (e) { cols = null; }

  var row = new Array(numCols).fill('');
  // timestamp in first column if present
  row[0] = new Date();
  if (cols && typeof cols.EMAIL === 'number') row[cols.EMAIL] = 'stu@asyn.com';
  else row[1] = 'stu@asyn.com';
  if (cols && typeof cols.F3_NAME === 'number') row[cols.F3_NAME] = 'F3 New Guy';
  else row[3] = 'F3 New Guy';
  var reuseAnswer = "Yes, and use last month's goals.";
  if (cols && typeof cols.PARTICIPATION === 'number') row[cols.PARTICIPATION] = reuseAnswer;
  else row[2] = reuseAnswer;

  // Append the row and invoke the submit handler with a fake event range.
  responsesSheet.appendRow(row);
  var newRow = responsesSheet.getLastRow();
  var rng = responsesSheet.getRange(newRow, 1, 1, numCols);
  var e = { range: rng };
  try {
    handleFormSubmit_(e);
    ui.alert('Test reuse submitted for stu@asyn.com');
  } catch (err) {
    ui.alert('Test reuse failed: ' + (err && err.message));
  }
}
