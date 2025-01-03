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
  if (email === 'f3go30@gmail.com') 
  { 
    ui.createMenu('F3 Go30')
     .addItem('Copy and Initialize', 'copyAndInit')
     .addItem('Initialize Triggers', 'initializeTriggers')
     .addItem('Initialize Sheets (DEV)', 'initSheets')
     .addItem('Run test function (DEV)', 'testFunction')
     .addToUi(); 
  }
  logActivity('onOpen','');
}

// test function invoked by test menu item above.
function testFunction() 
{
  testNotificationSidebar();
  //  shortenUrlWithBitly('https://docs.google.com/spreadsheets/d/1y2c5r-_R0UJRdjEcDPpQSG9WtepTV6JFuYwCB0xbCak/edit?usp=sharing', '77128118e9be8d7000c153a56edaf733b259e112');
}
