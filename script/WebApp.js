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
function renderHomePage_(e) {
  var webAppUrl = ScriptApp.getService().getUrl();
  // The home page arrival redirect (F3Go30-ubwl.2) shares buildStaticCheckinRedirectUrl_ with
  // cmd=checkin: the static page's default view with no `cmd` param IS check-in, so home carries
  // an arrival to the exact same static URL a check-in arrival would get, identity params intact.
  var staticHomeUrl = (typeof buildStaticCheckinRedirectUrl_ === 'function')
    ? buildStaticCheckinRedirectUrl_(webAppUrl, (e && e.parameter) || {})
    : '';
  if (staticHomeUrl) {
    GasLogger.log('renderHomePage_.staticRedirect', { hasQuery: !!(e && e.queryString) });
    return renderStaticRedirect_(staticHomeUrl, { bodyLabel: 'Go30', title: 'Go30' });
  }

  var spreadsheet = resolveTemplateSpreadsheet_(e);
  var months = getCurrentAndNextMonths_(spreadsheet, undefined, e && e.parameter && e.parameter.contextDate);

  var template = HtmlService.createTemplateFromFile('HomeApp');
  // Same treatment as checkinUrl below (buildStaticSignupUrl_, Utilities.js) — the landing
  // page's "Sign Up / Update My Commit" link opens the static front end, falling back to the
  // GAS ?cmd=signup page when the static host isn't configured.
  template.signupUrl = (typeof buildStaticSignupUrl_ === 'function' && buildStaticSignupUrl_(webAppUrl))
    || (webAppUrl + '?cmd=signup');
  // Opens the static check-in front end wrapping this webapp as its API backend, rather than
  // the GAS ?cmd=checkin page directly (see buildStaticCheckinUrl_, Utilities.js) — falls back
  // to the GAS page if the static host isn't configured (e.g. Node tests).
  template.checkinUrl = (typeof buildStaticCheckinUrl_ === 'function' && buildStaticCheckinUrl_(webAppUrl))
    || (webAppUrl + '?cmd=checkin');
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
/**
 * The page a legacy GAS arrival (signup, check-in, or home) actually gets: a client-side hop to
 * the static front end, carrying the original query string (buildStaticSignupRedirectUrl_ /
 * buildStaticCheckinRedirectUrl_). Generalized from the signup-only renderStaticSignupRedirect_
 * (F3Go30-833s.11) so all three arrival routes share exactly one window.top redirect renderer
 * (F3Go30-ubwl.2) — the `label` param is the only per-route difference (what the "Taking you
 * to..." copy names).
 *
 * REDIRECT, NOT BANNER (F3Go30-833s.11 AC3). A banner would leave every old link landing on a
 * second, diverging implementation that ADR-018 intends to retire — two UIs to keep in step, and
 * PAX split across them by which link they happened to have saved. A redirect makes the old
 * links equivalent to the new ones, which is the whole point. What makes it safe is that it is
 * conditional, not destructive:
 *   - it only fires when a static URL can actually be built, so an unconfigured/unreachable
 *     static host renders the GAS page exactly as before;
 *   - `?static=0` opts out explicitly, keeping ADR-018's availability fallback one query
 *     parameter away rather than deleted;
 *   - the hop is a visible link as well as a script navigation, so a PAX whose browser blocks
 *     the scripted top-level navigation still gets there by tapping, never a dead end.
 * `window.top` is required rather than `window.location`: HtmlService serves this inside a
 * sandbox iframe, and navigating the iframe alone would leave the PAX on script.google.com
 * with the static page trapped inside it.
 * @param {string} staticUrl
 * @param {{bodyLabel: string=, title: string=}=} opts bodyLabel is the "Taking you to <bodyLabel>"
 *   copy (default 'Go30'); title is the page's setTitle (default 'Go30').
 */
function renderStaticRedirect_(staticUrl, opts) {
  opts = opts || {};
  var bodyLabel = opts.bodyLabel || 'Go30';
  var title = opts.title || 'Go30';
  var escaped = staticUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;' +
    'padding:32px 16px;color:#333}a{color:#0b5cad}</style></head><body>' +
    '<p>Taking you to ' + bodyLabel + '&hellip;</p>' +
    '<p><a id="go" href="' + escaped + '" target="_top">Tap here if nothing happens</a></p>' +
    '<script>window.top.location.replace(' + JSON.stringify(staticUrl) + ');<\/script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderSignupPage_(e) {
  // Old, already-distributed ?cmd=signup links (TinyURL short links, PAX bookmarks, Slack and
  // email history) can't be rewritten where they sit, so this page carries their arrivals
  // across to the static signup instead — see renderStaticRedirect_ for why a redirect
  // and not a banner, and for the conditions under which it declines to fire.
  var staticSignupUrl = (typeof buildStaticSignupRedirectUrl_ === 'function')
    ? buildStaticSignupRedirectUrl_(ScriptApp.getService().getUrl(), (e && e.parameter) || {})
    : '';
  if (staticSignupUrl) {
    GasLogger.log('renderSignupPage_.staticRedirect', { hasQuery: !!(e && e.queryString) });
    return renderStaticRedirect_(staticSignupUrl, { bodyLabel: 'Go30 signup', title: 'Go30 Hard Commit Signup' });
  }

  var spreadsheet = resolveTemplateSpreadsheet_(e);
  var lists = readTeamLists_(spreadsheet);
  var urlContextDate = (e && e.parameter && e.parameter.contextDate) || null;
  var months = getCurrentAndNextMonths_(spreadsheet, undefined, urlContextDate);

  var template = HtmlService.createTemplateFromFile('SignupApp');
  var signupWebAppUrl = ScriptApp.getService().getUrl();
  template.webAppUrl = JSON.stringify(signupWebAppUrl);
  // Static check-in front end base (no id yet — SignupApp.html appends its own &id= once one
  // is known, exactly like it already does for the GAS fallback URL). '' if unconfigured (e.g.
  // Node tests), in which case SignupApp.html falls back to the GAS ?cmd=checkin page itself.
  template.staticCheckinBaseUrlJson = JSON.stringify(
    (typeof buildStaticCheckinUrl_ === 'function' && buildStaticCheckinUrl_(signupWebAppUrl, {
      ns: (e && e.parameter && e.parameter.ns) || undefined,
      contextDate: urlContextDate || undefined,
    })) || ''
  );
  template.aoListJson = JSON.stringify(lists.aoList);
  template.goalListJson = JSON.stringify(lists.goalList);
  // Only current/next are ever meant for the client — getCurrentAndNextMonths_ also returns
  // `explicit` (an out-of-band-selected test month's sheetId, when a caller supplied one),
  // which must never be embedded in a page anonymous users can view source on.
  template.monthsJson = JSON.stringify({ current: months.current, next: months.next });
  template.appVersion = APP_VERSION;
  template.urlTargetMonthJson = JSON.stringify((e && e.parameter && e.parameter.targetMonth) || null);
  template.urlAutoStart = !!(e && e.parameter && e.parameter.autoStart === '1');
  // ?id=<session guid> deep link (from the confirmation email's "Update my registration" link):
  // resolve the guid to its bound {f3Name, email} server-side — the sandboxed page can't read the
  // query string itself (see the note above), and this is the same CheckinSessions store the
  // check-in app uses. Handing the identity in lets SignupApp.html skip the identify form and open
  // the goal step prefilled, exactly like ?autoStart=1 but without relying on localStorage.
  var incomingSessionId = (e && e.parameter && e.parameter.id) || '';
  var sessionIdentity = null;
  if (incomingSessionId && typeof resolveCheckinSession_ === 'function') {
    var session = resolveCheckinSession_(spreadsheet, incomingSessionId);
    if (session && session.f3Name && session.email) {
      sessionIdentity = { f3Name: session.f3Name, email: session.email };
    }
  }
  template.urlIdentityJson = JSON.stringify(sessionIdentity);
  // ns (ADR-014 D3): same "sandboxed iframe carries no query string" constraint as
  // targetMonth/id above — read here server-side and echoed by SignupApp.html's callApi()
  // POSTs (via IdentityCore.html's shared client) so a namespace-scoped request stays scoped
  // across the whole signup flow, not just the initial page load.
  template.urlNsJson = JSON.stringify((e && e.parameter && e.parameter.ns) || null);
  // contextDate (F3Go30-31w5.1): same round-trip constraint as ns above — read here
  // server-side and echoed by SignupApp.html's callApi() POSTs so a developer testing
  // month-boundary fallback stays pinned to the same test date for the rest of the session.
  template.urlContextDateJson = JSON.stringify(urlContextDate);
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

  var spreadsheet = resolveTemplateSpreadsheet_(e, payload);
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
          resolveTemplateSpreadsheet_(e, payload), newTrackerStartDate,
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
      // Removes only per-tracker installable triggers (form-submit + edit — every trigger type
      // that's registered per-Tracker-spreadsheet, F3Go30-440b.4) whose source spreadsheet is
      // trashed or gone — the leak cleanupTracker used to leave behind before it started
      // calling clearFormSubmitTrigger/clearTrackerEditTrigger_. Never touches other trigger
      // types (e.g. the monthly auto-generate trigger) regardless of source state.
      var formHandlers = [FORM_SUBMIT_HANDLER_, LEGACY_FORM_SUBMIT_HANDLER_, TRACKER_EDIT_HANDLER_];
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
    if (payload.action === 'syncTrackerTriggers') {
      // F3Go30-440b.5: on-demand combined backfill (register the edit trigger on any active
      // TrackerDB row missing one) + cleanup (clear both per-tracker trigger types for any row
      // whose spreadsheet is trashed or has aged out past the previous month) sweep — see
      // TrackerTriggerLifecycle.js's docstring and docs/staging/tracker-edit-cache-invalidation.md
      // "Trigger lifecycle". Deliberately admin-triggered only for now, not a nightly trigger.
      var syncSpreadsheet = resolveTemplateSpreadsheet_(e, payload);
      var syncContextDate = payload.contextDate ? new Date(payload.contextDate) : new Date();
      var syncResult = syncTrackerTriggers_(syncSpreadsheet, syncContextDate);
      return jsonOutput_(syncResult);
    }
    if (payload.action === 'invalidateAllCache') {
      // Runs inside this deployed webapp's own script project — the only PropertiesService
      // store PaxCache entries actually live in (see PaxCache.js's wipeAllPaxCache_ docstring
      // for why a monthly Tracker's own script copy can't do this locally). onOpen.js's
      // "Invalidate Cache" menu item calls this over HTTP for exactly that reason.
      var wipedCount = wipeAllPaxCache_();
      var layoutCleared = 0;
      try {
        // Stays bound (ADR-014 D2/D4): PaxCache/layout cache keys live in this executing
        // deployment's own PropertiesService/CacheService store, never in a namespace copy.
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
    if (payload.action === 'setContextDate') {
      // Persists a per-namespace contextDate override (F3Go30-31w5.1) into the ns-resolved
      // spreadsheet's Config sheet, read by resolveContextDate_ (go30tools.js) as the fallback
      // when a request doesn't carry its own payload.contextDate. Refused outright on PROD —
      // resolveContextDate_'s own PROD guard would ignore it anyway, but failing loudly here
      // avoids an operator believing a PROD Config write actually did something.
      if (typeof APP_DEPLOY_TARGET !== 'undefined' && APP_DEPLOY_TARGET === 'TEMPLATE') {
        return jsonOutput_({ ok: false, error: 'forbidden_in_prod' });
      }
      var contextDateSpreadsheet = resolveTemplateSpreadsheet_(e, payload);
      var contextDateConfigSheet = openConfigSheet(contextDateSpreadsheet);
      if (!contextDateConfigSheet) {
        return jsonOutput_({ ok: false, error: 'config_sheet_not_found' });
      }
      contextDateConfigSheet.upsertValue('Context Date', payload.contextDate || '');
      GasLogger.log('handleAdminPost_.setContextDate', { ns: payload.ns || null, contextDate: payload.contextDate || null });
      return jsonOutput_({ ok: true, contextDate: payload.contextDate || null });
    }
    if (payload.action === 'resetCheckinSession') {
      // Test-support only (F3Go30 identity-token-flow.spec.js): removes every CheckinSessions
      // row bound to {f3Name, email} so a Playwright spec asserting exact "first use"
      // (createdAt === lastUsedAt) semantics can start a fixture PAX from a clean slate on
      // every run instead of perpetually reusing a session an earlier run already touched.
      // See deleteCheckinSessionsByIdentity_ (CheckinSessions.js).
      if (!payload.f3Name || !payload.email) {
        return jsonOutput_({ ok: false, error: 'f3Name and email are required' });
      }
      var resetSpreadsheet = resolveTemplateSpreadsheet_(e, payload);
      var removedCount = deleteCheckinSessionsByIdentity_(resetSpreadsheet, payload.f3Name, payload.email);
      GasLogger.log('handleAdminPost_.resetCheckinSession', { f3Name: payload.f3Name, removed: removedCount });
      return jsonOutput_({ ok: true, removed: removedCount });
    }
    if (payload.action === 'listSheets') {
      // Stays bound (ADR-014 D2): diagnostic listing for this executing deployment's own
      // Template, not a tenant-data read — no sheetId/ns override needed, unlike getSheet.
      var allSheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
      return jsonOutput_({ ok: true, sheets: allSheets.map(function(s) {
        return { name: s.getName(), hidden: s.isSheetHidden(), index: s.getIndex() };
      })});
    }
    if (payload.action === 'getSheet') {
      if (!payload.sheetName) {
        return jsonOutput_({ ok: false, error: 'sheetName is required' });
      }
      // Stays bound absent sheetId (ADR-014 D2): admin's own explicit-sheetId override is
      // the targeting mechanism here, not ns — this is the precedent pattern the ADR cites.
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
      // Scans sibling tracker spreadsheets and refreshes TrackerDB/PaxDB.
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
      // Stays bound absent sheetId (ADR-014 D2) — same precedent as getSheet above.
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
    if (payload.action === 'runPaxCachePurge') {
      // Runs the nightly PaxCache purge (F3Go30-440b.2) on demand, for live SIT verification.
      // Pass contextDate as ISO string (e.g., '2026-06-25') in the payload to test against a
      // pinned "now" rather than the real clock.
      var purgeContextDate = payload.contextDate ? new Date(payload.contextDate) : new Date();
      var purgeResult = purgeStalePaxCache_(purgeContextDate);
      return jsonOutput_({ ok: true, result: purgeResult });
    }
    if (payload.action === 'benchmarkPropertiesService') {
      // One-off diagnostic (F3Go30 script-properties perf question, 2026-07) — times the
      // per-key getProperty() loop buildTrackerValuesFromPaxCache_ actually runs today against
      // a single whole-store getProperties() call and a single-blob write/read, for a real
      // cached roster. Requires payload.sheetId to already have a cached PaxCache roster index
      // (a tracker that's had at least one dashboard/identify load). Not part of any hot path.
      if (!payload.sheetId) {
        return jsonOutput_({ ok: false, error: 'sheetId is required' });
      }
      var benchResult = benchmarkPaxCacheReads_(payload.sheetId, payload.iterations);
      GasLogger.log('handleAdminPost_.benchmarkPropertiesService', { sheetId: payload.sheetId });
      return jsonOutput_({ ok: true, result: benchResult });
    }
    if (payload.action === 'copyTemplate') {
      // Stands up a new environment's files: copies a source Template (+ bound script,
      // typically PROD's) and the N most recent real trackers into a new sibling Drive
      // folder, rebuilds that copy's TrackerDB/PaxDB from only the copied trackers, and
      // registers it as a NamespaceDB row in the active (destination) deployment, typically
      // SIT — see CopyTemplate.js file header and ADR-014 D6. Deliberately does not touch
      // triggers/forms/short links or deploy anything.
      if (!payload.folderName) {
        return jsonOutput_({ ok: false, error: 'folderName is required' });
      }
      if (!payload.sourceTemplateId) {
        return jsonOutput_({ ok: false, error: 'sourceTemplateId is required' });
      }
      var copyTemplateLog = [];
      try {
        var copyResult = copyTemplateToNewEnvironment_(
          payload.folderName, payload.sourceTemplateId, payload.trackerCount || 3, payload.kind || 'smoke',
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
    if (payload.action === 'teardownEnvironment') {
      // Whole-environment counterpart to cleanupTracker (which only tears down one tracker):
      // removes the NamespaceDB row for `nameSpace` (the primary safety cut — makes it
      // unresolvable immediately) and, if trashFolder is set, trashes the environment's whole
      // Drive folder (Template copy + every tracker copied alongside it by copyTemplate) — see
      // teardownNamespaceEnvironment_ (CopyTemplate.js) and ADR-014 D6.
      if (!payload.nameSpace) {
        return jsonOutput_({ ok: false, error: 'nameSpace is required' });
      }
      try {
        var teardownResult = teardownNamespaceEnvironment_(payload.nameSpace, !!payload.trashFolder, function() {});
        GasLogger.log('handleAdminPost_.teardownEnvironment', Object.assign({ nameSpace: payload.nameSpace }, teardownResult));
        return jsonOutput_(Object.assign({ ok: true }, teardownResult));
      } catch (err) {
        GasLogger.log('handleAdminPost_.teardownEnvironment.error', { error: err.message });
        return jsonOutput_({ ok: false, error: 'server_error', detail: err.message });
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
    return renderHomePage_(e);
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
      // A real <form target="_top"> submit from the typed-identify button (marked by the
      // hidden formIdentify field) is form-urlencoded and must render the full page — the
      // JSON action dispatch below is only for the page's own script-driven callApi() calls.
      if (e && e.parameter && e.parameter.formIdentify === '1') {
        return renderCheckinPageForTypedIdentify_(e);
      }
      return handleCheckinPost_(e);
    }
    return jsonOutput_({ status: 'ok' });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderSignupPage_: renderSignupPage_,
    renderStaticRedirect_: renderStaticRedirect_,
    renderHomePage_: renderHomePage_,
    handleAdminPost_: handleAdminPost_,
  };
}
