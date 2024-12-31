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
     .addItem('test', 'testFunc')
     .addToUi(); 
  }
  logActivity('onOpen','');
}
function testFunc() 
{ 
  userNoticeClear();
  userNotice("this is a test");
  userNotice("this is another test");
  showSidebarFromFile();
}

function userNotice(notice) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Status');
  
  // Create the Status sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Status');
    Logger.log('Status sheet created.');
  }

  var cell = sheet.getRange('B2');
  var currentValue = cell.getValue();

  if (currentValue) {
    cell.setValue(currentValue + '\n' + notice);
  } else {
    cell.setValue(notice);
  }
}

function userNoticeClear() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Status');
  
  // Create the Status sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Status');
    Logger.log('Status sheet created.');
  }

  var cell = sheet.getRange('B2');
  cell.clearContent();
}

// Function to get messages from the Status sheet
function getMessages() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Status');
  
  // Create the Status sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Status');
    Logger.log('Status sheet created.');
  }
  
  var cellValue = sheet.getRange('B2').getValue();
  var messages = cellValue.split('\n');
  return messages;
}

// Function to show the sidebar
function showSidebarFromFile() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar.html');
  SpreadsheetApp.getUi().showSidebar(html);
}



