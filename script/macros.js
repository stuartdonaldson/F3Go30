function startNewMonth() {
  initNewMonth();
  clearTriggers();
  initTriggers();
}
function initNewMonth() {
  initSheets();
}
function clearTriggers() {
  clearDailyMinusOne();
  clearFormSubmitTrigger();
}
function initTriggers() {
  setupFormSubmitTrigger();
  createDailyMinusOne();
}
// sep 2024 https://forms.gle/5uVcCKFfWBA1CKy19
// full https://docs.google.com/forms/d/e/1FAIpQLSfD5pN2j55YfmSlquDOAKXTbiXduNzQHyNIzLLyAPh0oMkORQ/viewform?usp=sf_link
// https://forms.gle/krNx6STfTHBNmFKq5


function nextHC() {
  var spreadsheet = SpreadsheetApp.getActive();
  spreadsheet.getRange('A1').activate();
};