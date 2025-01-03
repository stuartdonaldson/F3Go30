function onOpen()
{ 
  var ui = SpreadsheetApp.getUi(); 
  var email = Session.getActiveUser().getEmail(); 
  if (email === 'f3go30@gmail.com') 
  { 
    ui.createMenu('f3g030 Menu')
     .addItem('Copy and Initialize', 'copyAndInit')
     .addItem('Initialize Triggers', 'initializeTriggers')
     .addItem('Initialize Sheets', 'initSheets')
     .addItem('Add Next HC Available Notice', 'addNextAvailableNotice')
     .addItem('Run test function', 'testFunction')
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
