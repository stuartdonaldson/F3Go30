/**
 * Web app entry points (doGet/doPost). Deployed as a web app — see the "webapp" block
 * in appsscript.json (executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS) and the
 * "TEST_APP" deployment under this script project (clasp deployments).
 *
 * Every call is logged via GasLogger before responding. No business logic lives here
 * yet — this exists so we have a working, logged HTTP entry point to build on.
 */

/**
 * Never includes postData.contents — request bodies (cmd=signup, cmd=admin) carry PAX
 * names/emails or secrets, and GasLogger.log() data must never contain either. Only
 * type/length are safe to log.
 */
function buildWebAppRequestLog_(e) {
  return {
    url: ScriptApp.getService().getUrl() + (e && e.pathInfo ? '/' + e.pathInfo : ''),
    queryString: (e && e.queryString) || null,
    parameter: (e && e.parameter) || {},
    parameters: (e && e.parameters) || {},
    postData: e && e.postData ? {
      type: e.postData.type,
      length: e.postData.length
    } : null
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Renders the cmd=signup HTML page, injecting live ListDB/Links data server-side. */
function renderSignupPage_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var lists = readTeamLists_(spreadsheet);
  var months = getCurrentAndNextMonths_(spreadsheet);

  var template = HtmlService.createTemplateFromFile('SignupApp');
  template.webAppUrl = JSON.stringify(ScriptApp.getService().getUrl());
  template.aoListJson = JSON.stringify(lists.aoList);
  template.goalListJson = JSON.stringify(lists.goalList);
  template.monthsJson = JSON.stringify(months);
  return template.evaluate().setTitle('Go30 Hard Commit Signup');
}

/** Dispatches a cmd=signup doPost JSON body ({action, ...}) to the matching handler. */
function handleSignupPost_(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'invalid_json' });
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  try {
    if (payload.action === 'identify') return jsonOutput_(handleSignupIdentify_(spreadsheet, payload));
    if (payload.action === 'save')     return jsonOutput_(handleSignupSave_(spreadsheet, payload));
    if (payload.action === 'feedback') return jsonOutput_(handleSignupFeedback_(spreadsheet, payload));
    return jsonOutput_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    GasLogger.log('handleSignupPost_.error', { error: err && err.message, action: payload.action });
    return jsonOutput_({ ok: false, error: 'server_error' });
  }
}

/**
 * Sets ADMIN_SHARED_SECRET the first time only — whoever calls this first owns the
 * secret going forward. Never settable again via the web app; clearing it requires
 * the Apps Script editor's Script Properties UI by hand (F3Go30-w6y3).
 */
function bootstrapAdminSecret_(secret) {
  if (!secret || String(secret).length < 16) {
    return { ok: false, error: 'secret must be at least 16 characters' };
  }
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_SHARED_SECRET')) {
    return { ok: false, error: 'already_bootstrapped' };
  }
  props.setProperty('ADMIN_SHARED_SECRET', String(secret));
  GasLogger.log('bootstrapAdminSecret_.bootstrapped', {});
  return { ok: true };
}

/**
 * Dispatches a cmd=admin doPost JSON body to administrative actions, gated by
 * ADMIN_SHARED_SECRET (set once via bootstrapSecret — never typed in by hand). Every
 * other action must echo the secret back in the POST body (never the query string,
 * so it never lands in access logs / curl history).
 */
function handleAdminPost_(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'invalid_json' });
  }

  if (payload.action === 'bootstrapSecret') {
    return jsonOutput_(bootstrapAdminSecret_(payload.secret));
  }

  var storedSecret = PropertiesService.getScriptProperties().getProperty('ADMIN_SHARED_SECRET');
  if (!storedSecret || payload.adminSecret !== storedSecret) {
    GasLogger.log('handleAdminPost_.forbidden', { action: payload.action });
    return jsonOutput_({ ok: false, error: 'forbidden' });
  }

  try {
    if (payload.action === 'setScriptProperties') {
      var keys = Object.keys(payload.properties || {});
      PropertiesService.getScriptProperties().setProperties(payload.properties || {});
      GasLogger.log('handleAdminPost_.setScriptProperties', { keys: keys });
      return jsonOutput_({ ok: true, keysSet: keys });
    }
    if (payload.action === 'runAutoGenerate') {
      autoGenerateNextMonthTracker();
      return jsonOutput_({ ok: true });
    }
    if (payload.action === 'cleanupTracker') {
      // Removes a tracker from TrackerDB, its PaxDB rows, and optionally trashes the
      // spreadsheet and its linked HC form. Primary use case: smoke test teardown.
      // Order: unlink form → trash form → trash spreadsheet (GAS blocks trashing a
      // spreadsheet while a live form destination points at it).
      if (!payload.sheetId) {
        return jsonOutput_({ ok: false, error: 'sheetId is required' });
      }
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var trackerRemoved = removeTrackerDbRow_(payload.sheetId);
      var paxRowsRemoved = deletePaxDbRowsBySheetId_(ss, payload.sheetId);
      var formTrashed = false;
      var trashed = false;
      if (payload.trashSpreadsheet) {
        try {
          var trackerSs = SpreadsheetApp.openById(payload.sheetId);
          var linkedFormUrl = trackerSs.getFormUrl();
          if (linkedFormUrl) {
            try {
              var linkedForm = FormApp.openByUrl(linkedFormUrl);
              var formId = linkedForm.getId();
              linkedForm.removeDestination();
              DriveApp.getFileById(formId).setTrashed(true);
              GasLogger.log('handleAdminPost_.trashForm', { formId: formId });
              formTrashed = true;
            } catch (formErr) {
              GasLogger.log('handleAdminPost_.trashFormFailed', { error: formErr.message });
            }
          }
          DriveApp.getFileById(payload.sheetId).setTrashed(true);
          GasLogger.log('handleAdminPost_.trashSpreadsheet', { sheetId: payload.sheetId });
          trashed = true;
        } catch (trashErr) {
          GasLogger.log('handleAdminPost_.trashSpreadsheetFailed', { error: trashErr.message });
        }
      }
      GasLogger.log('handleAdminPost_.cleanupTracker', { sheetId: payload.sheetId, trackerRemoved: trackerRemoved, paxRowsRemoved: paxRowsRemoved, formTrashed: formTrashed, trashed: trashed });
      return jsonOutput_({ ok: true, trackerRemoved: trackerRemoved, paxRowsRemoved: paxRowsRemoved, formTrashed: formTrashed, trashed: trashed });
    }
    if (payload.action === 'getSmokeStatus') {
      // Returns the current environment and smoke mode state — use to confirm which
      // environment you're talking to and whether a smoke test is in progress.
      var props = PropertiesService.getScriptProperties();
      return jsonOutput_({
        ok: true,
        deployTarget: (typeof APP_DEPLOY_TARGET !== 'undefined' ? APP_DEPLOY_TARGET : 'unknown'),
        smokeMode: props.getProperty('SMOKE_MODE') === 'true',
        smokeTrackerId: props.getProperty('SMOKE_TRACKER_ID') || null
      });
    }
    if (payload.action === 'setWebappUrl') {
      // Sets WEBAPP_URL script property with the current webapp deployment URL.
      // Called from the webapp itself, so it captures the actual running deployment.
      var url = ScriptApp.getService().getUrl();
      PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
      GasLogger.log('handleAdminPost_.setWebappUrl', { webappUrl: url });
      return jsonOutput_({ ok: true, webappUrl: url });
    }
    if (payload.action === 'listSheets') {
      var allSheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
      return jsonOutput_({ ok: true, sheets: allSheets.map(function(s) {
        return { name: s.getName(), hidden: s.isSheetHidden(), index: s.getIndex() };
      })});
    }
    if (payload.action === 'getSheet') {
      if (!payload.sheetName) {
        return jsonOutput_({ ok: false, error: 'sheetName is required' });
      }
      var getSheetSs = payload.sheetId
        ? SpreadsheetApp.openById(payload.sheetId)
        : SpreadsheetApp.getActiveSpreadsheet();
      var targetSheet = getSheetSs.getSheetByName(payload.sheetName);
      if (!targetSheet) {
        return jsonOutput_({ ok: false, error: 'sheet_not_found' });
      }
      var rows = targetSheet.getDataRange().getValues();
      var csv = rows.map(function(row) {
        return row.map(function(cell) {
          var s = String(cell == null ? '' : cell);
          return s.indexOf('\t') !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join('\t');
      }).join('\n');
      return jsonOutput_({ ok: true, csv: csv });
    }
    if (payload.action === 'runScanTrackers') {
      // Scans sibling tracker spreadsheets and refreshes TrackerDB/PaxDB. Blocked during
      // Smoke mode — scanning while smoke signups exist would write test data into PaxDB,
      // contaminating goal-reuse lookups for real PAX.
      var smokeActive = PropertiesService.getScriptProperties().getProperty('SMOKE_MODE') === 'true';
      if (smokeActive) {
        return jsonOutput_({ ok: false, error: 'smoke_mode_active', message: 'runScanTrackers is blocked while SMOKE_MODE is active — clean up the smoke test first.' });
      }
      var scanResult = scanTrackers();
      return jsonOutput_({ ok: true, result: scanResult });
    }
    if (payload.action === 'getSheetHeaders') {
      if (!payload.sheetId || !payload.sheetName) {
        return jsonOutput_({ ok: false, error: 'sheetId and sheetName are required' });
      }
      // Column names only — never row data — so this stays safe even though it's read-only
      // structural inspection of an arbitrary spreadsheet by ID (F3Go30-w6y3 diagnostics).
      var sheet = SpreadsheetApp.openById(payload.sheetId).getSheetByName(payload.sheetName);
      if (!sheet) {
        return jsonOutput_({ ok: false, error: 'sheet_not_found' });
      }
      var sheetHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      return jsonOutput_({ ok: true, headers: sheetHeaders });
    }
    return jsonOutput_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    GasLogger.log('handleAdminPost_.error', { error: err && err.message, action: payload.action });
    return jsonOutput_({ ok: false, error: 'server_error' });
  }
}

function doGet(e) {
  return GasLogger.run('doGet', function() {
    GasLogger.log('doGet', buildWebAppRequestLog_(e));
    if (e && e.parameter && e.parameter.cmd === 'signup') {
      return renderSignupPage_();
    }
    return jsonOutput_({ status: 'ok' });
  });
}

function doPost(e) {
  return GasLogger.run('doPost', function() {
    var cmd = e && e.parameter && e.parameter.cmd;
    GasLogger.log('doPost', buildWebAppRequestLog_(e));

    if (cmd === 'admin') {
      return handleAdminPost_(e);
    }
    if (cmd === 'signup') {
      return handleSignupPost_(e);
    }
    return jsonOutput_({ status: 'ok' });
  });
}
