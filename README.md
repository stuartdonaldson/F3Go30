# F3Go30
Automation, Scripts, and HTML for Go30.
To learn more about Go30, see the explainer video: https://www.youtube.com/watch?v=cjn2qCLiHZY

PAX track their progress in the Go30 Google sheet which is released monthly.

The "F3 Go30" menu appears only if the user is f3go30@gmail.com for the site Q.
 * Copy and Initialize: Copies the current spreadsheet to a new one and initializes all sheets and forms.
 * Initialize Triggers: Run on the new sheet to initialize all trigger automations.
 * Initialize Sheets (DEV): Initializes all sheets again as part of development.
 * Run test function (DEV): Run a test function, only for developers.

## Overview of the Google Apps Script Behavior

The Google Apps Script associated with the F3Go30 project automates various tasks related to managing and tracking progress in the Go30 Google Sheet. The script provides several features accessible through a custom menu, "F3 Go30," which appears only for the owner of the spreadsheet which is typically the site Q for Go30. The main functionalities include copying and initializing new tracker spreadsheets, setting up triggers, and managing forms.

### Important Notice

The spreadsheet should be a copy of or derived from the [Go 30 Template](https://docs.google.com/spreadsheets/d/1XLAYCSSeNBLvA2JTfhFWoZkKgsmizoUvsNk6CJtot7U/edit?usp=sharing) spreadsheet. This template contains the expected sheets and formulas used by Go30. Unfortunately, opening that sheet and copying it to My Drive, does not copy the template for the HC form.

You can copy the sheet and link up your own HC form.

When copying the go30 Template for a new region or changing the site Q, make sure and edit the HC Form to change the site Q name.

### Key Features

1. **Copy and Initialize**:
   - Prompts for a new tracker name and start date.
   - Copies the current spreadsheet and associated HC form to a new tracker spreadsheet.
   - Resets all worksheets in the new tracker.
   - Sets the title on the HC form.
   - Sets up sharing permissions on the spreadsheet for anyone with the link to edit.
   - Outputs links to the new Spreadsheet and new HC Form in the Notifications.

2. **Initialize Triggers**:
   - Sets up triggers for automated tasks, such as daily updates and populating the spreadsheet based on the HC form submissions.

3. **Initialize Sheets (DEV)**:
   - Reinitializes all sheets as part of development.

4. **Run Test Function (DEV)**:
   - Runs a test function for development purposes.

### Triggered Functions

The script sets up several triggers to automate tasks:

1. **Daily Minus One Trigger**:
   - **Function**: `setupDailyMinusOneTrigger()`
   - **Description**: Sets up a daily trigger that runs a specified function one day before the event.

2. **Form Submit Trigger**:
   - **Function**: `setupFormSubmitTrigger()`
   - **Description**: Sets up a trigger that runs a specified function whenever a form is submitted.

### How to Use the Spreadsheet

#### Initial Setup

1. **Access the F3 Go30 Menu**:
   - Start with the Go30 Template or the current sheet.
   - Ensure you are logged in as f3go30@gmail.com to see the "F3 Go30" menu.

2. **Copy and Initialize**:
   - Select "Copy and Initialize" from the "F3 Go30" menu.
   - Enter the new tracker name and start date when prompted.
   - The script will create a new tracker spreadsheet, copy the current HC form, and reset all worksheets.
   - The notification pane will be populated with updates during this process, including links to the new spreadsheet and HC form.

3. **Initialize Triggers**:
   - Open the new tracker sheet by clicking the link in the notification pane created during the spreadsheet setup.
   - Open the "F3 Go30" menu and select "Initialize Triggers".
   - This will set up the necessary triggers to populate the spreadsheet when a PAX fills out the HC form and flag missed check-ins with a -1 every night.

4. **Share Links to the HC Form and Tracker Sheet**:
   - Open the new tracker sheet and navigate to the Tracker sheet. Save the current URL and share it.
   - It is best practice to shorten the URL using a service like tinyurl.com or bitly.com.

### PAX Usage Instructions

1. **Start with the HC Form**:
   - PAX should go to the HC form and fill it out to identify their Go30 goal.

2. **Form Submission and Tracker Update**:
   - When a PAX submits their goal via the HC form, the form submit trigger runs and populates the Tracker sheet in the spreadsheet.

3. **Daily Tracking**:
   - As the month progresses, PAX will go to the Tracker sheet and place a `1` or a `0` on their row to indicate whether they achieved their goal for the day or not.
   - At the end of the day, an automation runs and will place a `-1` if the PAX did not fill out the form. There is a 24-hour grace period for filling out the form.

4. **Bonus Tracker**:
   - PAX can also fill out the Bonus Tracker sheet to get points for key activities such as EHing an FNG, Fellowship, Inspiration, and Qing.

### Next Steps (Not Automated)

1. **Open the New Spreadsheet**:
   - Manually open the new tracker spreadsheet.

2. **Initialize Triggers**:
   - Run the "Initialize Triggers" option from the "F3 Go30" menu to set up automation.

3. **Shorten and Share Form URL**:
   - Use a URL shortening service (e.g., Bitly or TinyURL) to shorten the form URL for easier sharing.  urlShortener.js has prototype code for this to be integrated.  It uses Bitly where the free version limits you to 5 per month.  TinyURL may be a better choice.

4. **Shorten and Share Spreadsheet URL**:
   - Similarly, shorten the new tracker spreadsheet URL for easier sharing.

5. **Close the Message**:
   - Once all steps are completed, you can close the notification message.

By following these steps, you can effectively use the F3Go30 Google Sheet and associated scripts to manage and track progress in the Go30 program.
