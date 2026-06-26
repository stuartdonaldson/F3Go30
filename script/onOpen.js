/**
 * The onOpen function is triggered when the Google Sheets document is opened.
 * Builds the F3 Go30 custom menu. Management items (Copy and Initialize, trigger setup,
 * and trigger cleanup) are shown only to the spreadsheet owner. About is shown to all users.
 */
function onOpen() {
  return GasLogger.run('onOpen', onOpen_);
}

function onOpen_()
{
  var ui = SpreadsheetApp.getUi();
  var email = Session.getActiveUser().getEmail();
  var owner = SpreadsheetApp.getActiveSpreadsheet().getOwner(); // null on Team Drives
  var owneremail = owner ? owner.getEmail() : null;

  var menu = ui.createMenu('F3 Go30');

  if (owneremail && email === owneremail) {
    menu.addItem('Copy and Initialize', 'copyAndInit')
        .addItem('Initialize Nightly Triggers (Template only)', 'initializeTemplateDispatchTriggers')
        .addItem('Initialize Monthly Trigger', 'initializeMonthlyTrigger')
        .addItem('Clear All Triggers', 'clearAllTriggers')
        .addSeparator();
  }

  menu.addItem('About', 'showAbout')
      .addToUi();

  try {
    logActivity('onOpen','');
  } catch (e) {
    GasLogger.log('onOpen.logActivityFailed', { error: e.message });
  }
}

/**
 * Removes all project triggers from the current spreadsheet.
 */
function clearAllTriggers() {
  return GasLogger.run('clearAllTriggers', function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ssId = ss.getId();
    var deletedCount = 0;

    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (trigger.getTriggerSourceId() === ssId) {
        ScriptApp.deleteTrigger(trigger);
        deletedCount++;
      }
    });

    SpreadsheetApp.getUi().alert('Cleared ' + deletedCount + ' trigger(s) from this spreadsheet.');
  });
}

/**
 * Displays an About dialog with version info and author contact.
 */
function showAbout() {
  const serviceUrl = ScriptApp.getService().getUrl();
  const deploymentId = serviceUrl ? serviceUrl.match(/\/d\/([^\/]+)/)?.[1] : 'unknown';

  const html = HtmlService.createHtmlOutput(
    '<style>' +
    '  body { font-family: Arial, sans-serif; padding: 16px; font-size: 13px; color: #333; }' +
    '  h2 { margin-top: 0; }' +
    '  p { margin: 6px 0; }' +
    '  .label { font-weight: bold; }' +
    '  .code { font-family: monospace; font-size: 11px; word-break: break-all; background: #f5f5f5; padding: 4px; border-radius: 3px; }' +
    '  hr { border: none; border-top: 1px solid #ddd; margin: 12px 0; }' +
    '</style>' +
    '<h2>F3 Go30 Tracker</h2>' +
    '<p>Automates the monthly lifecycle of Go30 fitness challenge trackers — ' +
    'copying the template, linking the HC sign-up form, initializing sheets, ' +
    'setting up triggers, and nightly miss-marking.</p>' +
    '<hr>' +
    '<p><span class="label">Version:</span> ' + APP_VERSION + ' (' + APP_VERSION_DATE + ')</p>' +
    '<p><span class="label">Author:</span> ' + APP_AUTHOR + '</p>' +
    '<p><span class="label">Contact:</span> <a href="mailto:' + APP_CONTACT + '">' + APP_CONTACT + '</a></p>' +
    '<hr>' +
    '<p><span class="label">Deployment ID:</span></p>' +
    '<p class="code">' + deploymentId + '</p>' +
    '<p><span class="label">Service URL:</span></p>' +
    '<p class="code">' + (serviceUrl || 'unknown') + '</p>'
  ).setWidth(480).setHeight(320);

  SpreadsheetApp.getUi().showModalDialog(html, 'About F3 Go30');
}

/**
 * Installs the two daily ADR-010 dispatch triggers — minus-one marking (markMinusOne.js)
 * and nag email (nag.js) — exactly once, on the Go30 Template only. Both triggers now
 * resolve their target tracker per run via TrackerDB (resolveTrackerForContextDate), so
 * they must not be installed per monthly copy; form-submit trigger setup happens
 * automatically per tracker in CreateNewTracker.js and is not part of this menu item.
 */
function initializeTemplateDispatchTriggers() {
  return GasLogger.run('initializeTemplateDispatchTriggers', function() {
    if (typeof isTemplateHost_ === 'function' && !isTemplateHost_()) {
      SpreadsheetApp.getUi().alert(
        'This installs the daily ADR-010 dispatch triggers (minus-one marking, nag email). ' +
        'Run this once, on the Go30 Template only — not on a monthly tracker copy.'
      );
    }
    setupDailyMinusOneTrigger();
    if (typeof setupDailyNagTrigger === 'function') {
      try { setupDailyNagTrigger(); } catch (e) { GasLogger.log('initializeTemplateDispatchTriggers.setupDailyNagTriggerFailed', { error: e.message }); }
    }
  });
}


