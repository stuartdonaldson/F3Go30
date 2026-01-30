/**
 * The onOpen function is triggered when the Google Sheets document is opened.
 * It creates a custom menu in the Google Sheets UI for a specific user.
 * 
 * Menu Options:
 * - 'Copy and Initialize': Calls the `copyAndInit` function to copy and initialize data.
 * - 'Initialize Triggers': Calls the `initializeTriggers` function to set up necessary triggers.
 * - 'Initialize Sheets': Calls the `initSheets` function to initialize sheets.
 * - 'Run test function': Calls the `testFunction` to run a test function.
 */
function onOpen()
{ 
  var ui = SpreadsheetApp.getUi(); 
  var email = Session.getActiveUser().getEmail(); 

  // Only add the F3Go30 menu for spreadsheet management if the owner of the spreadsheet has opened it.
  var owneremail = SpreadsheetApp.getActiveSpreadsheet().getOwner().getEmail();

  if (email === owneremail ) {
    ui.createMenu('F3 Go30')
     .addItem('Copy and Initialize', 'copyAndInit')
     .addItem('Initialize Triggers', 'initializeTriggers')
     .addItem('Reinitialize this spreadsheet', 'reinitializeSheets')
     .addItem('Run test function (DEV)', 'testFunction')
     .addToUi(); 
  }
  logActivity('onOpen','');
}

function initializeTriggers() {
  setupDailyMinusOneTrigger();  // markMinusOne.js
  setupFormSubmitTrigger(); // addResponseOnSubmit.js
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
  const data = sheet.getRange("A:B").getValues();  // Read columns A and B

  let targetUrl = null;
  
  // Find the URL where column A contains "Next Month HC Signup"
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === "Next Month HC Signup") {
      targetUrl = data[i][1];  // Value in column B
      break;
    }
  }

  if (targetUrl) {
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Inspiration");
  const trackerSheet = ss.getSheetByName("Tracker");
  
  const data = sheet.getDataRange().getValues();
  const randomIndex = Math.floor(Math.random() * (data.length - 1)) + 1; // Exclude header row
  const randomQuote = data[randomIndex][0];
  const randomAuthor = data[randomIndex][1];
  
  trackerSheet.getRange("H1").setValue(`"${randomQuote}" - ${randomAuthor}`);
}
