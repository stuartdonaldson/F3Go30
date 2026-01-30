# F3Go30 Google Apps Script

## Description

The F3Go30 Google Apps Script automates various tasks related to managing and tracking progress in the Go30 Google Sheet. It provides features for copying and initializing new tracker spreadsheets, setting up triggers, and managing forms.

## Overview of the Google Apps Script Behavior

The Google Apps Script associated with the F3Go30 project automates various tasks related to managing and tracking progress in the Go30 Google Sheet. The script provides several features accessible through a custom menu, "F3 Go30," which appears only for the owner of the spreadsheet, typically the site Q for Go30. The main functionalities include copying and initializing new tracker spreadsheets, setting up triggers, and managing forms.

The "F3 Go30" menu appears only if the person opening the Google spreadsheet is the owner of the spreadsheet.
 * Copy and Initialize: Copies the current spreadsheet to a new one and initializes all sheets and forms.
 * Initialize Triggers: Run on the new sheet to initialize all trigger automations.
 * Reinitialize this spreadsheet: Initializes all sheets in this spreadsheet again.  Useful in development, or to start a sheet over again.
 * Run test function (DEV): Run a test function, only for developers.

### Template and Form Copying Instructions

The practice we are following in the Puget Sound region is to do development and updates in the [Go 30 Template](https://docs.google.com/spreadsheets/d/1XLAYCSSeNBLvA2JTfhFWoZkKgsmizoUvsNk6CJtot7U/edit?usp=sharing) spreadsheet. , and we copy and initialize new sheets from there. However, any of the derived monthly sheets, such as the current month, could also be used. The owner of the current sheet, f3go30@gmail.com in the Puget Sound region, will have the menu option to initialize and run the automation.  The copy process will include creating a new signup form.

### Creating Your Own Go30 for Another Region

Unfortunately, if you are not the owner of the spreadsheet and signup HC form, the copy process does not copy the signup form. You will need to manually copy the signup form and then link it to your copy of the spreadsheet. To create your own Go30 for another region:

1. Go to a recent or current Go30 sheet in the Puget Sound region. The link is available in the Go30 channel of the Puget Sound Slack. Alternatively, you can contact f3go30@gmail.com or me to get a link.
2. Select the `File` menu, then choose `Make a Copy`, and select a destination folder for your Go30 initiative.
3. To copy the form, go to the `Tools` menu and select `Manage Form`. Then, using the three dots in the upper right corner, select `Make a Copy` and copy the form to your Go30 folder.
4. Use the menu options in your Google Sheet and your copy of the form to manage and link your form to your Google Sheet and save the responses in the Responses sheet.
5. Update your signup form to add information specific to your region, including your Go30 Q info for more information.

From that point on, when you use the "Copy and Initialize" menu item to create a new month, the form should get copied and permissions set properly. It is just this initial setup that requires the manual and somewhat cumbersome method.

### Experimental: Form Copy/Generation (Work in Progress)

There is experimental, untested code in [script/FORMCONFIRMATIONMESSAGE.js](script/FORMCONFIRMATIONMESSAGE.js) and [script/formManager.js](script/formManager.js) that explores ways to update or recreate Google Forms programmatically. This work is intended to simplify bootstrapping a new Go30 region from a read-only copy of the spreadsheet (ideally letting "Copy and Initialize" build everything). Google Forms permissions and ownership restrictions currently require manual steps, so these functions are not used in production and should be considered dead code for now.

### Key Features

1. **Copy and Initialize**:
   - Prompts for a new tracker name and start date.
   - Copies the current spreadsheet and associated HC form to a new tracker spreadsheet.
   - Resets all worksheets in the new tracker.
   - Sets the title on the HC form.
   - Sets up sharing permissions on the spreadsheet for anyone with the link to edit.
   - Shortens the tracker sheet URL and HC form URL using the built-in URL shortener (TinyURL by default).

2. **Initialize Triggers**:
   - Sets up daily and form submit triggers for the new tracker.

3. **Reinitialize Spreadsheet**:
   - Reinitializes all sheets in the current spreadsheet, useful for development.
   
4. **Run test function (DEV)**:
   - Runs a test function for developers.

## Installation

1. Open the Google Sheets document where you want to use the script.
2. Go to `Extensions` > `Apps Script`.
3. Copy and paste the script files into the Apps Script editor.
4. Save the project.

## URL Shortener Setup

The project includes a URL shortener utility that is used during "Copy and Initialize" to shorten the tracker sheet and HC form links. By default it uses TinyURL. To enable it:

1. In Apps Script, open **Project Settings**.
2. Add script properties:
   - `TINYURL_ACCESS_TOKEN` (required for TinyURL)
   - `BITLY_ACCESS_TOKEN` (optional, only if you switch to Bitly)

## Usage

1. Open the Google Sheets document.
2. Ensure you are logged in as the owner.
3. Access the "F3 Go30" menu from the menu bar.
4. Select the desired option (e.g., "Copy and Initialize").

## Contact

For support or contributions, please contact `stuart.donaldson@gmail.com`