////////////////////////////////////////////////////////////////////////////////////////
//
//  Go30 script for .....
//
//
//
// Created 3/2019 by: Michael Raymond
// Latest update: 8/5/2019.
//
////////////////////////////////////////////////////////////////////////////////////////

var ss = SpreadsheetApp.getActiveSpreadsheet();
var sheet = ss.getSheetByName('Tracker'); 

function localTimeTrigger () {
  
 ScriptApp.newTrigger("lockRanges")
  .timeBased()
  .atHour(10)
  .nearMinute(15)
  .everyDays(1) // Frequency is required if you are using atHour() or nearMinute()
  .create(); 
}


function lockRanges() {

  //First cell to check
  var row = 4; //Data starts in the 3rd row.
  //Data starts in the 4th column, but we're looking back a day. So on 4/2/2019, 
  //we want to edit the column for 4/1/19 which is in column 4. 2 + 2 = 4.
  var col = new Date().getDate() + 2; 
  
  if (col < 4 || col > 34) {
    //only run on valid columns.
    return; 
  }
  
  //Check to see if the script has already run, using our hidden 
  //Row 120.
  var range = sheet.getRange(120, col);
  if (range.isBlank() ) {
    Logger.log('Hidden cell is empty, run scripts and populate');
    range.setValue(1);
  }
  else {
    //exit the script, there is nothing left to do.
    return;
  }
  
  Logger.log( Session.getEffectiveUser() + ' launched the dataUpdateScript.' );

  // last row with data in sheet, there are x data points.
  var lastRow = 57;

  //Loop and set any empty cells
  while(row <= lastRow){
    //set any empty data
    emptyCellCheck(row, col);
    row = row + 1;
  }
  
  lockColumn(col);
  
  Logger.log(' dataUpdateScript complete.');
}

function emptyCellCheck(row, col) {
  var range = sheet.getRange(row, col);

  if ((range.isBlank())){
    range.setValue(-1);
  }
}

function lockColumn(col){

  //Lock column, col, from row 4.
  var range = sheet.getRange(4, col, 57);
  var proDay = col - 1;

  // Create protection object. Set description, anything you like.
  var protection = range.protect().setDescription('Protected, column for ' + proDay + '-2019');

 // Ensure the current user is an editor before removing others. Otherwise, if the user's edit
 // permission comes from a group, the script will throw an exception upon removing the group.
 var me = Session.getEffectiveUser();
 protection.addEditor(me);
 protection.removeEditors(protection.getEditors());
 if (protection.canDomainEdit()) {
   protection.setDomainEdit(false);
 }
}