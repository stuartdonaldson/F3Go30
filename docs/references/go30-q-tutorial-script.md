Script for Go30 Q Introduction
Slide 1: Introduction to Go30 Tracker

Welcome to the Go30 Tracker tutorial! In this video, we'll walk you through how the Go30 spreadsheet works, how the automation helps manage the process, and how to get started with a new month.

Slide 2: Overview of the Go30 Tracker

The Go30 Tracker is a Google Sheet designed to help PAX track their progress in the Go30 program. Each month, a new tracker spreadsheet is created to monitor daily goals and key activities.

Slide 3: Key Features of the Go30 Tracker

The Go30 Tracker includes several key features:

Daily goal tracking
Automated updates and reminders
Bonus points for key activities
Easy sharing and collaboration
Slide 4: Accessing the F3 Go30 Menu

The "F3 Go30" menu is only visible to the spreadsheet owner. Open the template spreadsheet and you will see the "F3 Go30" menu in the menu bar.

Animation: Show opening the template spreadsheet and accessing the "F3 Go30" menu.

Slide 5: Copy and Initialize

The first step is to create a new tracker for the month. Select "Copy and Initialize" from the "F3 Go30" menu. A sidebar will open. Enter the start date (YYYY-MM-DD format) when prompted. The spreadsheet name is auto-generated as YYYY-MM-NameSpace using the NameSpace value from the Config sheet — no name entry is needed.

Animation: Demonstrate selecting "Copy and Initialize" and entering only the start date.

Slide 6: Notification Sidebar Updates

The script will copy the template spreadsheet, rename and move the bound HC form to the same Drive folder, reset all worksheets for the new month, and set the HC form's confirmation message to include the tracker link and Site Q contact. The sidebar will show progress updates and, when complete, display shortened links to the new tracker sheet and HC form, plus a ready-to-paste Slack message.

Animation: Show the sidebar being populated with progress updates, shortened links, and the Slack message.

Slide 7: Initialize Triggers

Open the new tracker sheet by clicking the link in the sidebar. Open the "F3 Go30" menu and select "Initialize Triggers". This sets up two triggers: a form-submit trigger that populates the Tracker sheet when a PAX fills out the HC form, and a nightly trigger that marks missed check-ins with a -1.

Animation: Demonstrate opening the new tracker sheet and selecting "Initialize Triggers".

Slide 8: Sharing Links

The shortened URLs for the HC form and Tracker sheet are shown in the sidebar at the end of Copy and Initialize. Copy the pre-formatted Slack message from the sidebar and post it to your region's channel. No manual URL shortening is needed.

Animation: Show copying the Slack message from the sidebar and posting it.

Slide 9: PAX Usage Instructions

PAX should start by filling out the HC form to identify their Go30 goal. When a PAX submits their goal via the HC form, the form submit trigger runs and populates the Tracker sheet in the spreadsheet.

Animation: Demonstrate a PAX filling out the HC form and the Tracker sheet being updated.

Slide 10: Daily Tracking

As the month progresses, PAX will go to the Tracker sheet and place a 1 or a 0 on their row to indicate whether they achieved their goal for the day or not. At the end of the day, an automation runs and will place a -1 if the PAX did not fill out the form. There is a 24-hour grace period for filling out the form.

Animation: Show PAX updating the Tracker sheet daily and the automation placing -1 for missed check-ins.

Slide 11: Bonus Tracker

PAX can also fill out the Bonus Tracker sheet to get points for key activities such as EHing an FNG, Fellowship, Inspiration, and Qing.

Animation: Demonstrate filling out the Bonus Tracker sheet.

Slide 12: Next Steps

To get started with a new month:

1. Open the template spreadsheet and access the F3 Go30 Menu.
2. Select "Copy and Initialize" and enter the start date.
3. Wait for the sidebar to complete; copy the Slack message and share the links.
4. Open the new tracker spreadsheet and select "Initialize Triggers".

Animation: Recap the steps with visual highlights.

Slide 13: Conclusion

Thank you for watching this tutorial. By following these steps, you can effectively use the Go30 Tracker to manage and track progress in the Go30 program. For more information, see the explainer video linked in the description.

Animation: Show the link to the explainer video.

Summary
Introduction: Overview of the Go30 Tracker and its key features.
Accessing the F3 Go30 Menu: Instructions on logging in and accessing the menu.
Copy and Initialize: Steps to create a new tracker for the month (start date only; name is auto-generated).
Notification Sidebar Updates: Explanation of the progress updates, shortened links, and Slack message.
Initialize Triggers: Setting up triggers for automation.
Sharing Links: How to copy shortened links and the Slack message from the sidebar.
PAX Usage Instructions: How PAX should use the HC form and Tracker sheet.
Daily Tracking: Instructions for daily goal tracking and automation.
Bonus Tracker: Explanation of the Bonus Tracker sheet.
Next Steps: Recap of steps to get started with a new month.
Conclusion: Closing remarks and link to the explainer video.
By following this script and using the accompanying slides or video animations, you can effectively explain to a new Go30 Q how the spreadsheet works, how the automation works, and how to get started with a new month.