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
        .addItem('Invalidate Cache', 'invalidateCacheMenuAction')
        .addItem('Set Test Context Date...', 'setContextDateMenuAction')
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
 * Removes all project triggers from the entire Apps Script project.
 * Useful for cleanup after deleting spreadsheets/forms or transitioning deployments.
 */
function clearAllTriggers() {
  return GasLogger.run('clearAllTriggers', function() {
    var ui = SpreadsheetApp.getUi();
    var response = ui.alert(
      'Clear All Triggers',
      'This will delete ALL project triggers (dispatch, nag, minus-one, monthly). Proceed?',
      ui.ButtonSet.OK_CANCEL
    );
    if (response !== ui.Button.OK) return;

    var deletedCount = 0;
    var triggers = ScriptApp.getProjectTriggers();

    triggers.forEach(function(trigger) {
      try {
        ScriptApp.deleteTrigger(trigger);
        deletedCount++;
      } catch (e) {
        GasLogger.log('clearAllTriggers.deleteFailed', { error: e.message });
      }
    });

    ui.alert('Cleared ' + deletedCount + ' trigger(s) from the Apps Script project.');
  });
}

/**
 * Menu handler for "Invalidate Cache". PaxCache entries are written exclusively by the one
 * *deployed* web app (dashboardWebapp.js/signupWebapp.js), so they live in that one script
 * project's PropertiesService store — not whichever spreadsheet's script copy happens to be
 * running this menu. A monthly Tracker is a Drive copy of the Template (CreateNewTracker.js's
 * makeCopy), and Drive copies a bound script along with its file, so opening the menu from a
 * Tracker copy runs this code in a *separate* script project with its own, empty properties
 * store — wiping local PropertiesService here would silently do nothing useful. Instead this
 * calls the deployed web app's own admin action (invalidateAllCache, WebApp.js) over HTTP,
 * so the wipe always happens inside the actual running instance regardless of which
 * spreadsheet the menu was opened from. Script Properties are never copied by Drive's
 * makeCopy (see CreateNewTracker.js's isTemplateHost_ docstring) — only the Template's own
 * project ever had setWebappUrl/bootstrapSecret run against it, so WEBAPP_URL/
 * ADMIN_SHARED_SECRET are only ever present here when this menu is opened from the Template
 * itself; the guard below fails closed (with a clear message) on any Tracker copy instead of
 * silently doing nothing.
 */
function invalidateCacheMenuAction() {
  return GasLogger.run('invalidateCacheMenuAction', function() {
    var ui = SpreadsheetApp.getUi();
    var response = ui.alert(
      'Invalidate Cache',
      'This clears every cached PAX/Tracker/Responses entry for the running Go30 web app ' +
      '(every month, not just this spreadsheet). The next dashboard or check-in load for any ' +
      'PAX will be slightly slower (one live read instead of a cache hit). Proceed?',
      ui.ButtonSet.OK_CANCEL
    );
    if (response !== ui.Button.OK) return;

    var props = PropertiesService.getScriptProperties();
    var webAppUrl = props.getProperty('WEBAPP_URL');
    var adminSecret = props.getProperty('ADMIN_SHARED_SECRET');
    if (!webAppUrl || !adminSecret) {
      ui.alert('Could not invalidate cache: WEBAPP_URL / ADMIN_SHARED_SECRET is not set on this ' +
        "spreadsheet's script copy. Run this from the Template spreadsheet instead.");
      return;
    }

    try {
      var httpResponse = UrlFetchApp.fetch(webAppUrl + '?cmd=admin', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ action: 'invalidateAllCache', adminSecret: adminSecret }),
        muteHttpExceptions: true,
      });
      var result = JSON.parse(httpResponse.getContentText());
      if (!result.ok) {
        ui.alert('Cache invalidation failed: ' + (result.error || 'unknown error'));
        return;
      }
      ui.alert('Cache invalidated: ' + result.wiped + ' PAX entr' + (result.wiped === 1 ? 'y' : 'ies') +
        ' and ' + result.layoutCleared + ' tracker layout entr' + (result.layoutCleared === 1 ? 'y' : 'ies') + ' cleared.');
    } catch (e) {
      ui.alert('Cache invalidation failed: ' + e.message);
    }
  });
}

/**
 * Validates a YYYY-MM-DD date string typed into the "Set Test Context Date" prompt. Pure — no
 * GAS services — so it's unit-testable without live Sheets/UI. Deliberately stricter than a
 * bare `new Date(text)`: that constructor also accepts shapes a human tester wouldn't expect
 * (e.g. "3/15/26") and silently rolls over an invalid day-of-month (e.g. 2026-02-30 -> March 2)
 * — same rollover check createTrackerForMonth_/handleAdminPost_'s createTrackerForMonth already
 * do, applied here for the same reason.
 * @param {string} text
 * @returns {{valid:true, iso:string}|{valid:false}}
 */
function parseContextDateMenuInput_(text) {
  var trimmed = String(text == null ? '' : text).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { valid: false };
  var parsed = new Date(trimmed + 'T00:00:00');
  if (isNaN(parsed.getTime())) return { valid: false };
  var inputMonth = parseInt(trimmed.split('-')[1], 10);
  if (parsed.getMonth() + 1 !== inputMonth) return { valid: false };
  return { valid: true, iso: trimmed };
}

/**
 * Menu handler for "Set Test Context Date...". Human-driver UX for F3Go30-31w5.1's contextDate
 * override (31w5's second floated idea, chosen over the bare-query-param-only option): lets a
 * non-technical tester pin the check-in/signup webapp to a specific "today" without hand-
 * building a query string. Same WEBAPP_URL/ADMIN_SHARED_SECRET pattern as
 * invalidateCacheMenuAction above (only ever populated on the Template's own script copy —
 * see that function's docstring for why a Tracker copy fails closed instead of silently
 * no-opping) — this calls the deployed webapp's setContextDate admin action over HTTP so the
 * Config sheet write always lands on the actual running instance.
 *
 * Blocks before any prompt on PROD (APP_DEPLOY_TARGET === 'TEMPLATE') — mirrors
 * resolveContextDate_'s own PROD guard (go30tools.js) so there's no UI path to override PROD's
 * date either, even though that guard would silently ignore the stored value anyway.
 */
function setContextDateMenuAction() {
  return GasLogger.run('setContextDateMenuAction', function() {
    var ui = SpreadsheetApp.getUi();

    if (typeof APP_DEPLOY_TARGET !== 'undefined' && APP_DEPLOY_TARGET === 'TEMPLATE') {
      ui.alert('Set Test Context Date',
        'This is the PROD deployment (APP_DEPLOY_TARGET=TEMPLATE) — contextDate overrides are ' +
        'never honored here, by design (the webapp is deployed to real anonymous traffic). Run ' +
        'this from a SIT/test deployment instead.',
        ui.ButtonSet.OK);
      return;
    }

    var response = ui.prompt(
      'Set Test Context Date',
      'Enter the date (YYYY-MM-DD) the check-in/signup webapp should treat as "today" for this ' +
      'namespace. Leave blank and press OK to clear the override.',
      ui.ButtonSet.OK_CANCEL
    );
    if (response.getSelectedButton() !== ui.Button.OK) return;

    var rawInput = response.getResponseText();
    var contextDateIso = '';
    if (String(rawInput || '').trim()) {
      var parsedInput = parseContextDateMenuInput_(rawInput);
      if (!parsedInput.valid) {
        ui.alert('Invalid date: "' + rawInput + '" — expected YYYY-MM-DD.');
        return;
      }
      contextDateIso = parsedInput.iso;
    }

    var props = PropertiesService.getScriptProperties();
    var webAppUrl = props.getProperty('WEBAPP_URL');
    var adminSecret = props.getProperty('ADMIN_SHARED_SECRET');
    if (!webAppUrl || !adminSecret) {
      ui.alert('Could not set context date: WEBAPP_URL / ADMIN_SHARED_SECRET is not set on this ' +
        "spreadsheet's script copy. Run this from the Template spreadsheet instead.");
      return;
    }

    try {
      var httpResponse = UrlFetchApp.fetch(webAppUrl + '?cmd=admin', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ action: 'setContextDate', adminSecret: adminSecret, contextDate: contextDateIso }),
        muteHttpExceptions: true,
      });
      var result = JSON.parse(httpResponse.getContentText());
      if (!result.ok) {
        ui.alert('Setting context date failed: ' + (result.error || 'unknown error'));
        return;
      }
    } catch (e) {
      ui.alert('Setting context date failed: ' + e.message);
      return;
    }

    if (!contextDateIso) {
      ui.alert('Context date override cleared. Every request now uses the real date again.');
      return;
    }

    var checkinUrl = webAppUrl + '?cmd=checkin&contextDate=' + contextDateIso;
    var signupUrl = webAppUrl + '?cmd=signup&contextDate=' + contextDateIso;
    ui.alert('Set Test Context Date',
      'Context date set to ' + contextDateIso + '.\n\n' +
      'Ready-to-open URLs (copy one into your browser):\n\n' +
      'Check-in: ' + checkinUrl + '\n\n' +
      'Signup: ' + signupUrl,
      ui.ButtonSet.OK);
  });
}

/**
 * Script Properties are capped at 500KB total and 9KB per value (Apps Script quota) — PaxCache
 * (script/PaxCache.js) is the biggest consumer of that budget, so surfacing count/size here
 * gives an early warning before a roster grows large enough to hit the ceiling.
 * @returns {{count: number, totalBytes: number}}
 */
function scriptPropertiesMetrics_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var keys = Object.keys(props);
  var totalBytes = keys.reduce(function(sum, key) {
    return sum + key.length + (props[key] || '').length;
  }, 0);
  return { count: keys.length, totalBytes: totalBytes };
}

/**
 * Displays an About dialog with version info and author contact.
 */
function showAbout() {
  // ScriptApp.getService().getUrl() is unreliable when called from a spreadsheet-menu
  // execution (as opposed to an actual doGet/doPost web app request) — it can return the
  // editor URL or an empty string depending on context. WEBAPP_URL is set authoritatively
  // by the webapp itself (WebApp.js's setWebappUrl admin action), so prefer that.
  const serviceUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
  const deploymentId = serviceUrl ? serviceUrl.match(/\/d\/([^\/]+)/)?.[1] : 'unknown';

  // Reflects *this* script project's own Script Properties store. Meaningful when opened from
  // the Template (the deployed webapp's PaxCache entries live here); a monthly Tracker copy
  // has its own separate, mostly-empty store (see PaxCache.js's wipeAllPaxCache_ docstring) —
  // same caveat as WEBAPP_URL above.
  const propsMetrics = scriptPropertiesMetrics_();
  const propsKB = (propsMetrics.totalBytes / 1024).toFixed(1);
  const propsPct = ((propsMetrics.totalBytes / (500 * 1024)) * 100).toFixed(1);

  // Static check-in front end (F3Go30-5nfj.2) — a separate GitHub Pages deployment, one
  // subpath per environment (tools/build-static-pages.js), independent of this webapp's own
  // clasp deploy. Best-effort: a slow/unreachable Pages host must never block opening About.
  const staticEnvPath = (typeof APP_DEPLOY_TARGET !== 'undefined' && APP_DEPLOY_TARGET === 'TEMPLATE') ? 'prod' : 'sit';
  const staticBaseUrl = STATIC_PAGES_BASE_URL_ + staticEnvPath + '/';
  let staticVersion = 'unavailable';
  try {
    const versionRes = UrlFetchApp.fetch(staticBaseUrl + 'version.json', { muteHttpExceptions: true });
    if (versionRes.getResponseCode() === 200) {
      staticVersion = JSON.parse(versionRes.getContentText()).version || 'unavailable';
    }
  } catch (e) {
    // unreachable / not yet published — leave as 'unavailable'
  }

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
    '<p><span class="label">Version (GAS):</span> ' + APP_VERSION + ' (' + APP_VERSION_DATE + ')</p>' +
    '<p><span class="label">Version (static page):</span> ' + staticVersion + '</p>' +
    '<p><span class="label">Author:</span> ' + APP_AUTHOR + '</p>' +
    '<p><span class="label">Contact:</span> <a href="mailto:' + APP_CONTACT + '">' + APP_CONTACT + '</a></p>' +
    '<hr>' +
    '<p><span class="label">Deployment ID:</span></p>' +
    '<p class="code">' + deploymentId + '</p>' +
    '<p><span class="label">Service URL:</span></p>' +
    '<p class="code">' + (serviceUrl || 'unknown') + '</p>' +
    '<hr>' +
    '<p><span class="label">Script Properties (this spreadsheet\'s script):</span></p>' +
    '<p>' + propsMetrics.count + ' propert' + (propsMetrics.count === 1 ? 'y' : 'ies') +
      ', ' + propsKB + ' KB (' + propsPct + '% of the 500 KB quota)</p>' +
    (serviceUrl ? (
      '<hr>' +
      '<p><span class="label">Signup:</span> <a href="' + serviceUrl + '?cmd=signup" target="_blank">' + serviceUrl + '?cmd=signup</a></p>' +
      '<p><span class="label">Checkin:</span> <a href="' + serviceUrl + '?cmd=checkin" target="_blank">' + serviceUrl + '?cmd=checkin</a></p>' +
      '<p><span class="label">Checkin (static page):</span> <a href="' + staticBaseUrl + '?webapp=' + encodeURIComponent(serviceUrl) +
        '" target="_blank">' + staticBaseUrl + '</a></p>'
    ) : '')
  ).setWidth(480).setHeight(420);

  SpreadsheetApp.getUi().showModalDialog(html, 'About F3 Go30');
}

/**
 * Installs the daily ADR-010 dispatch triggers — minus-one marking (markMinusOne.js), nag
 * email (nag.js), and check-in session cleanup (CheckinSessions.js) — exactly once, on the
 * Go30 Template only. All three now resolve their own target per run rather than needing
 * per-monthly-copy setup; form-submit trigger setup happens automatically per tracker in
 * CreateNewTracker.js and is not part of this menu item.
 */
function initializeTemplateDispatchTriggers() {
  return GasLogger.run('initializeTemplateDispatchTriggers', function() {
    if (typeof isTemplateHost_ === 'function' && !isTemplateHost_()) {
      SpreadsheetApp.getUi().alert(
        'This installs the daily ADR-010 dispatch triggers (minus-one marking, nag email, ' +
        'check-in session cleanup). Run this once, on the Go30 Template only — not on a ' +
        'monthly tracker copy.'
      );
    }
    setupDailyMinusOneTrigger();
    if (typeof setupDailyNagTrigger === 'function') {
      try { setupDailyNagTrigger(); } catch (e) { GasLogger.log('initializeTemplateDispatchTriggers.setupDailyNagTriggerFailed', { error: e.message }); }
    }
    if (typeof setupCheckinSessionCleanupTrigger_ === 'function') {
      try { setupCheckinSessionCleanupTrigger_(); } catch (e) { GasLogger.log('initializeTemplateDispatchTriggers.setupCheckinSessionCleanupTriggerFailed', { error: e.message }); }
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseContextDateMenuInput_: parseContextDateMenuInput_,
    setContextDateMenuAction: setContextDateMenuAction
  };
}


