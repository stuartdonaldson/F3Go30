/**
 * 
 * VERIFY HOW TO GET THE FORM, NOT SURE IF THIS IS THE ACTIVE FORM OR NOT. PROBABLY JUST PASS THE FORM INTO THE FUNCTION WHEN WE HAVE UPDATED THE FORM
 * 
 * 
 * Updates the Google Form confirmation message with the Go30 details.
 * * @param {string} trackingUrl The URL for the Go30 tracking sheet.
 * @param {string} siteQName The name of the Site Q (e.g., "Little John").
 */
function setGo30ConfirmationMessage(trackingUrl, siteQName) {
  // 1. Get the active Google Form
  var form = FormApp.getActiveForm();

  // 2. Construct the plain-text message using \n for line breaks
  var message = 
    "Go30 Commitment Confirmed\n\n" +
    "Your dedication is recorded. You are one step closer to achieving your goals.\n\n" +
    "Action Items to Win:\n" +
    "1. Log Your Progress: Go to the official tracking sheet at " + trackingUrl + " to update your progress and view the accountability of the PAX.\n" +
    "2. Get on Slack: Make sure you are participating on the #Go30 Slack channel to share monthly progress and ask for help if you are struggling.\n" +
    "3. Launch the Text Chain: Don't assume someone else will do it. Take charge on setting up a group text message with your team on the first day. This is your vital daily accountability tool.\n\n" +
    "See You In The Gloom,\n" +
    siteQName + "\n" +
    "Go30 Site Q";

  // 3. Set the new confirmation message
  form.setConfirmationMessage(message);

  Logger.log("Confirmation message successfully updated for Go30.");
}

// -------------------------------------------------------------------
// EXAMPLE CALL TO RUN THE FUNCTION
// -------------------------------------------------------------------

/**
 * Executes the update function with specific arguments.
 * Run this function (or the one above) from the Apps Script editor.
 */
function runSetConfirmation() {
  var url = "https://tinyurl.com/2025-10-F3-Go30"; // The required URL
  var name = "Little John";                       // The Site Q's name
  
  setGo30ConfirmationMessage(url, name);
}