# F3Go30
Automation, Scripts and HTML for Go30.
To learn more about Go30, see the explainer video: https://www.youtube.com/watch?v=cjn2qCLiHZY

PAX track their progress in the Go30 Google sheet which is released monthly.  

The "F3 Go30" menu appears only if the user is f3go30@gmail.com for the site Q.
 * - 'Copy and Initialize': Copies the current spreadsheet to a new one and initializes all sheets and forms.
 * - 'Initialize Triggers': Run on the new sheet to initialize all trigger automations
 * - 'Initialize Sheets (DEV)': Initializes all sheets again as part of development
 * - 'Run test function (DEV)': Run a test function, only for developers)

Run the Copy and Initialize feature under the F3 Go30 menu.  
- Prompts for a new tracker name and start date.
- Copies the current spreadsheet and associated HC form to the new tracker spreadsheet.
- Resets all worksheets in the new tracker.
- Sets the title on the HC form.
- Sets up sharing permissions on the spreadsheet for anyone with the link can edit.
- Outputs into the Notifications a link to the new Spreadsheet, and new HC Form

Next steps that are not automated:
- Open the new spreadsheet and go to F3 Go30 > Initialize Triggers.
- Shorten with tinyurl.com the spreadsheet and HC form URLs
- Share the shortened URLs on Slack

Additional automation when triggers have been initialized include:
* Auto fill in of the Tracker when the HC form is submitted
* Auto -1 for entries that have not been filled the previous day.
* Script to configure the triggers for the above.

A backlog of future work is on the f3Go30 google drive here: https://docs.google.com/spreadsheets/d/1ChZv1rW5t4cvz5drk93XGBjc9M7KLhboQdcjerMwV58/edit?usp=sharing

Stuart Donaldson
F3 Little John
