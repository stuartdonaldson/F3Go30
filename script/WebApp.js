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

/**
 * Inlines an HtmlService-served file's raw content — used by templates rendered via
 * createTemplateFromFile (SignupApp/CheckinApp) to pull in a shared <script>-only fragment
 * with `<?!= include_('IdentityCore') ?>`, so identity/HTTP client plumbing shared by both
 * apps lives in one file (script/IdentityCore.html) instead of being copy-pasted per page.
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Renders the default (no-cmd) landing page: links to Sign Up, Dashboard/Check-in, and the
 * current month's tracker spreadsheet. Replaces the old bare {"status":"ok"} JSON response.
 */
function renderHomePage_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var webAppUrl = ScriptApp.getService().getUrl();
  var months = getCurrentAndNextMonths_(spreadsheet);

  var template = HtmlService.createTemplateFromFile('HomeApp');
  template.signupUrl = webAppUrl + '?cmd=signup';
  template.checkinUrl = webAppUrl + '?cmd=checkin';
  template.trackerUrl = (months.current && months.current.trackerUrl) || '';
  template.monthLabel = (months.current && months.current.label) || '';
  // See renderCheckinPage_'s comment (dashboardWebapp.js) — addMetaTag is required for the
  // viewport meta tag to survive HtmlService's IFRAME sandbox wrapper on mobile browsers.
  return template.evaluate().setTitle('Go30').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Renders the cmd=signup HTML page, injecting live ListDB/Links data server-side.
 * @param {Object=} e The doGet request event — needed for e.parameter.targetMonth/autoStart
 *   (the check-in app's "not registered yet" deep link). NOTE: the served page's own
 *   client-side JS cannot read the request's query string itself — Apps Script injects page
 *   content into a nested sandbox iframe whose own src carries no query string at all
 *   (confirmed live via Playwright frame inspection, 2026-07-04) — so these must be read here,
 *   server-side, and templated in explicitly, exactly like CheckinApp.html's saved-link token.
 */
function renderSignupPage_(e) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var lists = readTeamLists_(spreadsheet);
  var months = getCurrentAndNextMonths_(spreadsheet);

  var template = HtmlService.createTemplateFromFile('SignupApp');
  template.webAppUrl = JSON.stringify(ScriptApp.getService().getUrl());
  template.aoListJson = JSON.stringify(lists.aoList);
  template.goalListJson = JSON.stringify(lists.goalList);
  // Only current/next are ever meant for the client — getCurrentAndNextMonths_ also returns
  // `smoke` (the smoke tracker's sheetId) whenever SMOKE_MODE is active, which must never be
  // embedded in a page anonymous users can view source on.
  template.monthsJson = JSON.stringify({ current: months.current, next: months.next });
  template.appVersion = APP_VERSION;
  template.urlTargetMonthJson = JSON.stringify((e && e.parameter && e.parameter.targetMonth) || null);
  template.urlAutoStart = !!(e && e.parameter && e.parameter.autoStart === '1');
  return template.evaluate().setTitle('Go30 Hard Commit Signup').addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
    GasLogger.logError('handleSignupPost_.error', err, { action: payload.action });
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
    if (payload.action === 'createTrackerForMonth') {
      // Headless equivalent of the Template's "Create New Tracker" sidebar (copyAndInit_),
      // for an explicit target month — unlike runAutoGenerate (always real-today + 1 month),
      // this can backfill a month that auto-generate skipped because it ran late (see
      // createTrackerForMonth_'s docstring, CreateNewTracker.js).
      if (!payload.startDateIso) {
        return jsonOutput_({ ok: false, error: 'startDateIso is required (YYYY-MM-DD)' });
      }
      var newTrackerStartDate = new Date(payload.startDateIso + 'T00:00:00');
      if (isNaN(newTrackerStartDate.getTime())) {
        return jsonOutput_({ ok: false, error: 'invalid_date' });
      }
      // Catch JS date rollover (e.g. 2025-02-30 → March 2), same check copyAndInit_ does.
      var newTrackerInputMonth = parseInt(payload.startDateIso.split('-')[1], 10);
      if (newTrackerStartDate.getMonth() + 1 !== newTrackerInputMonth) {
        return jsonOutput_({ ok: false, error: 'date_does_not_exist' });
      }
      var createTrackerLog = [];
      try {
        var createTrackerResult = createTrackerForMonth_(
          SpreadsheetApp.getActiveSpreadsheet(), newTrackerStartDate,
          function(msg) { createTrackerLog.push(msg); }
        );
        return jsonOutput_({
          ok: true,
          sheetId: createTrackerResult.newSpreadsheetId,
          spreadsheetName: createTrackerResult.newSpreadsheetName,
          trackerUrl: createTrackerResult.trackerSheetShortUrl,
          formUrl: createTrackerResult.formShortUrl,
          log: createTrackerLog,
        });
      } catch (err) {
        GasLogger.log('handleAdminPost_.createTrackerForMonth.error', { error: err.message });
        return jsonOutput_({ ok: false, error: 'server_error', detail: err.message, log: createTrackerLog });
      }
    }
    if (payload.action === 'cleanupTracker') {
      // Removes a tracker from TrackerDB, its PaxDB rows, and optionally trashes the
      // spreadsheet and its linked HC form. Primary use case: smoke test teardown.
      // cleanupTrackerArtifact_ (go30tools.js) holds the actual implementation — it's shared
      // with scanTrackers()'s interactive "remove" choice (F3Go30-xj1q.2) so behavior can't
      // drift between the two entry points.
      if (!payload.sheetId) {
        return jsonOutput_({ ok: false, error: 'sheetId is required' });
      }
      var cleanupResult = cleanupTrackerArtifact_(payload.sheetId, !!payload.trashSpreadsheet);
      GasLogger.log('handleAdminPost_.cleanupTracker', Object.assign({ sheetId: payload.sheetId }, cleanupResult));
      return jsonOutput_(Object.assign({ ok: true }, cleanupResult));
    }
    if (payload.action === 'listTriggers') {
      // Diagnostic: every trigger on this script project plus whether its source file
      // (spreadsheet/form) still exists. A trashed/missing source with a lingering trigger
      // is exactly what accumulates toward the project's trigger-count cap (cleanupTracker
      // now clears these going forward, but pre-existing leaks need this to find).
      var allTriggers = ScriptApp.getProjectTriggers().map(function(trigger) {
        var sourceId = trigger.getTriggerSourceId();
        var sourceExists = null;
        if (sourceId) {
          try {
            sourceExists = !DriveApp.getFileById(sourceId).isTrashed();
          } catch (e) {
            sourceExists = false; // file gone entirely
          }
        }
        return {
          handlerFunction: trigger.getHandlerFunction(),
          eventType: String(trigger.getEventType()),
          sourceId: sourceId || null,
          sourceExists: sourceExists
        };
      });
      return jsonOutput_({ ok: true, count: allTriggers.length, triggers: allTriggers });
    }
    if (payload.action === 'deleteOrphanedTriggers') {
      // Removes only onFormSubmit triggers (FORM_SUBMIT_HANDLER_/LEGACY_FORM_SUBMIT_HANDLER_)
      // whose source spreadsheet is trashed or gone — the leak cleanupTracker used to leave
      // behind before it started calling clearFormSubmitTrigger. Never touches other trigger
      // types (e.g. the monthly auto-generate trigger) regardless of source state.
      var formHandlers = [FORM_SUBMIT_HANDLER_, LEGACY_FORM_SUBMIT_HANDLER_];
      var removed = [];
      ScriptApp.getProjectTriggers().forEach(function(trigger) {
        if (formHandlers.indexOf(trigger.getHandlerFunction()) === -1) return;
        var sourceId = trigger.getTriggerSourceId();
        var orphaned = false;
        if (!sourceId) {
          orphaned = true;
        } else {
          try {
            orphaned = DriveApp.getFileById(sourceId).isTrashed();
          } catch (e) {
            orphaned = true; // file gone entirely
          }
        }
        if (orphaned) {
          removed.push({ handlerFunction: trigger.getHandlerFunction(), sourceId: sourceId || null });
          ScriptApp.deleteTrigger(trigger);
        }
      });
      GasLogger.log('handleAdminPost_.deleteOrphanedTriggers', { removedCount: removed.length });
      return jsonOutput_({ ok: true, removedCount: removed.length, removed: removed });
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
    if (payload.action === 'invalidateAllCache') {
      // Runs inside this deployed webapp's own script project — the only PropertiesService
      // store PaxCache entries actually live in (see PaxCache.js's wipeAllPaxCache_ docstring
      // for why a monthly Tracker's own script copy can't do this locally). onOpen.js's
      // "Invalidate Cache" menu item calls this over HTTP for exactly that reason.
      var wipedCount = wipeAllPaxCache_();
      var layoutCleared = 0;
      try {
        var trackerState = _readTrackerDbRowsBySheetId_(SpreadsheetApp.getActiveSpreadsheet());
        var layoutKeys = Object.keys(trackerState.bySheetId).map(trackerLayoutCacheKey_);
        if (layoutKeys.length) {
          CacheService.getScriptCache().removeAll(layoutKeys);
          layoutCleared = layoutKeys.length;
        }
      } catch (err) {
        GasLogger.log('handleAdminPost_.invalidateAllCache.layoutClearFailed', { error: err.message });
      }
      GasLogger.log('handleAdminPost_.invalidateAllCache', { wiped: wipedCount, layoutCleared: layoutCleared });
      return jsonOutput_({ ok: true, wiped: wipedCount, layoutCleared: layoutCleared });
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
    if (payload.action === 'getSheetFormulas') {
      // Read-only formula inspection (row 1..N as authored) for reverse-engineering scoring
      // logic against the live sheet — same admin-secret gate as getSheet, formulas instead of
      // values. Ad hoc diagnostic; not part of any PAX-facing flow.
      if (!payload.sheetName) {
        return jsonOutput_({ ok: false, error: 'sheetName is required' });
      }
      var formulaSs = payload.sheetId
        ? SpreadsheetApp.openById(payload.sheetId)
        : SpreadsheetApp.getActiveSpreadsheet();
      var formulaSheet = formulaSs.getSheetByName(payload.sheetName);
      if (!formulaSheet) {
        return jsonOutput_({ ok: false, error: 'sheet_not_found' });
      }
      var formulaRows = payload.maxRows
        ? formulaSheet.getRange(1, 1, Math.min(payload.maxRows, formulaSheet.getMaxRows()), formulaSheet.getLastColumn()).getFormulas()
        : formulaSheet.getDataRange().getFormulas();
      return jsonOutput_({ ok: true, formulas: formulaRows });
    }
    if (payload.action === 'sortTracker') {
      // Re-sorts an arbitrary tracker's Tracker sheet by column B then column A — the same
      // sort handleFormSubmit_/handleSignupSave_ apply on every write (addResponseOnSubmit.js
      // sortTrackerSheet_). Exposed as a standalone admin action so a tracker written to by a
      // save path that predates that sort being wired up can be fixed without a full re-deploy.
      if (!payload.sheetId) {
        return jsonOutput_({ ok: false, error: 'sheetId is required' });
      }
      var sortTrackerSs = SpreadsheetApp.openById(payload.sheetId);
      var sortTrackerSheetObj = sortTrackerSs.getSheetByName('Tracker');
      if (!sortTrackerSheetObj) {
        return jsonOutput_({ ok: false, error: 'sheet_not_found' });
      }
      sortTrackerSheet_(sortTrackerSheetObj);
      return jsonOutput_({ ok: true });
    }
    if (payload.action === 'runMinusOneCheck') {
      // Runs the daily minus-one marking for a specific context date (default: today).
      // Pass contextDate as ISO string (e.g., '2026-06-25') in the payload.
      var contextDate = payload.contextDate ? new Date(payload.contextDate) : new Date();
      var result = markEmptyCellsAsMinusOne_(contextDate);
      return jsonOutput_({ ok: true, result: result });
    }
    if (payload.action === 'runNagCheck') {
      // Runs the daily nag email dispatch for a specific context date (default: today).
      // Pass contextDate as ISO string (e.g., '2026-06-25') in the payload.
      var contextDate = payload.contextDate ? new Date(payload.contextDate) : new Date();
      var result = sendNagEmail_(contextDate);
      return jsonOutput_({ ok: true, result: result });
    }
    if (payload.action === 'copyTemplate') {
      // Stands up a new environment's files: copies the Template (+ bound script) and the
      // N most recent real trackers into a new sibling Drive folder, then rebuilds that
      // copy's TrackerDB/PaxDB from only the copied trackers. See CopyTemplate.js file header
      // — deliberately does not touch triggers/forms/short links or deploy anything.
      if (!payload.folderName) {
        return jsonOutput_({ ok: false, error: 'folderName is required' });
      }
      var copyTemplateLog = [];
      try {
        var copyResult = copyTemplateToNewEnvironment_(
          payload.folderName, payload.trackerCount || 3,
          function(msg) { copyTemplateLog.push(msg); }
        );
        GasLogger.log('handleAdminPost_.copyTemplate', {
          newFolderId: copyResult.newFolderId,
          newTemplateId: copyResult.newTemplateId,
          copiedTrackers: copyResult.copiedTrackers.length
        });
        return jsonOutput_({ ok: true, log: copyTemplateLog, result: copyResult });
      } catch (err) {
        GasLogger.log('handleAdminPost_.copyTemplate.error', { error: err.message });
        return jsonOutput_({ ok: false, error: 'server_error', detail: err.message, log: copyTemplateLog });
      }
    }
    return jsonOutput_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    GasLogger.logError('handleAdminPost_.error', err, { action: payload.action });
    return jsonOutput_({ ok: false, error: 'server_error' });
  }
}

function doGet(e) {
  return GasLogger.run('doGet', function() {
    GasLogger.log('doGet', buildWebAppRequestLog_(e));
    if (e && e.parameter && e.parameter.cmd === 'signup') {
      return renderSignupPage_(e);
    }
    if (e && e.parameter && e.parameter.cmd === 'checkin') {
      return renderCheckinPage_(e);
    }
    return renderHomePage_();
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
    if (cmd === 'checkin') {
      return handleCheckinPost_(e);
    }
    return jsonOutput_({ status: 'ok' });
  });
}
