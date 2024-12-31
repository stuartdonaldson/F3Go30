function Sort_PAX() {
  var spreadsheet = SpreadsheetApp.getActive();
  spreadsheet.getRange('A1').activate();
  var currentCell = spreadsheet.getCurrentCell();
  spreadsheet.getSelection().getNextDataRange(SpreadsheetApp.Direction.NEXT).activate();
  currentCell.activateAsCurrentCell();
  currentCell = spreadsheet.getCurrentCell();
  spreadsheet.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
  currentCell.activateAsCurrentCell();
  spreadsheet.getActiveRange().offset(1, 0, spreadsheet.getActiveRange().getNumRows() - 1).sort([{column: 3, ascending: true}, {column: 10, ascending: true}]);
};

function Sort_PAX1() {
  var spreadsheet = SpreadsheetApp.getActive();
  spreadsheet.getRange('A1').activate();
  var currentCell = spreadsheet.getCurrentCell();
  spreadsheet.getSelection().getNextDataRange(SpreadsheetApp.Direction.NEXT).activate();
  currentCell.activateAsCurrentCell();
  currentCell = spreadsheet.getCurrentCell();
  spreadsheet.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
  currentCell.activateAsCurrentCell();
  spreadsheet.getActiveRange().offset(1, 0, spreadsheet.getActiveRange().getNumRows() - 1).sort([{column: 10, ascending: true}, {column: 3, ascending: true}]);
};

function AutoFill() {
  var spreadsheet = SpreadsheetApp.getActive();
  spreadsheet.getRange('W9').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W11').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W12').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W14').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W17').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W20').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W21').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W25').activate();
  spreadsheet.getCurrentCell().setValue('-1');
  spreadsheet.getRange('W26').activate();
};