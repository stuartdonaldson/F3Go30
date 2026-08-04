/**
 * Web app entry points (doGet/doPost). Deployed as a web app — see the "webapp" block
 * in appsscript.json (executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS) and the
 * "TEST_APP" deployment under this script project (clasp deployments).
 *
 * Every call is logged via GasLogger before responding. No business logic lives here
 * yet — this exists so we have a working, logged HTTP entry point to build on.
 */

/**
 * F3Go30-833s.15: pulls just the clientVersion field out of a JSON POST body — never the
 * rest of postData.contents (see buildWebAppRequestLog_'s note on why). 'legacy' covers
 * GAS-served pages (CheckinApp.html/SignupApp.html) and old cached static clients, neither
 * of which send the field; anything else unparseable also falls back to 'legacy' rather
 * than throwing.
 */
function extractClientVersion_(e) {
  if (!e || !e.postData || !e.postData.contents) return 'legacy';
  try {
    var payload = JSON.parse(e.postData.contents);
    return (payload && payload.clientVersion) || 'legacy';
  } catch (err) {
    return 'legacy';
  }
}

/**
 * Never includes postData.contents — request bodies (cmd=signup, cmd=admin) carry PAX
 * names/emails or secrets, and GasLogger.log() data must never contain either. Only
 * type/length are safe to log. clientVersion is the one field deliberately lifted out of
 * that body (F3Go30-833s.15) — it identifies which static-page build a PWA client is
 * running, which the entry log had no way to answer before.
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
    } : null,
    clientVersion: extractClientVersion_(e)
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
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
    logStaticRedirect_(e, 'renderHomePage_', 'home');
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
 * The page a legacy GAS arrival (signup, check-in, or home) actually gets: a client-side hop to
 * the static front end, carrying the original query string (buildStaticSignupRedirectUrl_ /
 * buildStaticCheckinRedirectUrl_). Generalized from the signup-only renderStaticSignupRedirect_
 * (F3Go30-833s.11) so all three arrival routes share exactly one window.top redirect renderer
 * (F3Go30-ubwl.2) — the `label` param is the only per-route difference (what the "Taking you
 * to..." copy names).
 *
 * REDIRECT, NOT BANNER (F3Go30-833s.11 AC3). A banner would leave every old link landing on a
 * second, diverging implementation that ADR-018/DR-04 (design-review-2026-08-04.md) retired —
 * two UIs to keep in step, and PAX split across them by which link they happened to have saved.
 * A redirect makes the old links equivalent to the new ones, which is the whole point. DR-04
 * (2026-08-04) removed the GAS-rendered SignupApp.html/CheckinApp.html/IdentityCore.html
 * fallback templates outright — this route no longer has anything to fall back to, so the
 * redirect fires whenever a static URL can be built at all (renderStaticUnavailable_ is the only
 * other outcome, and only when the static host itself isn't configured):
 *   - it only fires when a static URL can actually be built — an unconfigured/unreachable
 *     static host gets renderStaticUnavailable_ instead of a page render, since there is no GAS
 *     page left to serve;
 *   - the hop is an explicit tap, so it is never a dead end.
 *
 * ONE DELIBERATE TAP, NOT AN AUTO-REDIRECT. This originally also ran
 * `window.top.location.replace(...)` on load and framed the link as a "Tap here if nothing
 * happens" fallback. That scripted navigation could never fire for anyone: HtmlService serves
 * this inside an iframe sandboxed `allow-top-navigation-by-user-activation`, and a script
 * running on load has no user activation, so Chrome refuses it ("Unsafe attempt to initiate
 * navigation ... has no user activation") and throws an uncaught SecurityError into the
 * console. The link was therefore not the fallback path but the only path, while the copy
 * promised an automatic hop that never came. It is now presented as what it actually is — a
 * single deliberate tap — and the dead replace() call is gone rather than left throwing.
 *
 * Navigating the sandbox iframe instead (meta refresh, window.location) is NOT an alternative:
 * it would leave the PAX on script.google.com with the static page trapped inside it, and the
 * address bar is exactly what has to change for the new link to be bookmarkable at all.
 * @param {string} staticUrl
 * @param {{bodyLabel: string=, title: string=}=} opts bodyLabel names what moved, e.g.
 *   'Go30 check-in' (default 'Go30'); title is the page's setTitle (default 'Go30').
 */
function renderStaticRedirect_(staticUrl, opts) {
  opts = opts || {};
  var bodyLabel = opts.bodyLabel || 'Go30';
  var title = opts.title || 'Go30';
  var escaped = staticUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;' +
    'padding:40px 20px;color:#333}' +
    'h1{font-size:20px;margin:0 0 10px}' +
    'p{font-size:15px;line-height:1.5;color:#555;margin:0 0 26px}' +
    'a#go{display:inline-block;background:#0b5cad;color:#fff;text-decoration:none;' +
    'padding:14px 30px;border-radius:8px;font-size:17px;font-weight:600}' +
    '</style></head><body>' +
    '<h1>' + bodyLabel + ' has moved</h1>' +
    '<p>Tap below to continue, then update your bookmark to the new address.</p>' +
    '<p><a id="go" href="' + escaped + '" target="_top">Continue</a></p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Records one GAS-to-static redirect interstitial, shared by all three arrival routes
 * (renderHomePage_, renderSignupPage_, renderCheckinPage_) so the logging shape can't drift
 * between them the way three hand-copied blocks did. Always logs to Axiom (via GasLogger,
 * including the raw session token so Axiom can be filtered/joined per visitor even when no
 * f3Name is resolvable) and, in the GAS runtime only (logActivity is undefined under Node
 * tests), best-effort resolves the token to a PAX name for the spreadsheet's own Activity tab
 * — every redirect is recorded there even when the token can't be tied to anyone.
 * @param {Object} e        The doGet request event (for e.parameter.id / spreadsheet resolution).
 * @param {string} routeTag GasLogger tag prefix, e.g. 'renderCheckinPage_'.
 * @param {string} label    Human label for the Activity sheet message, e.g. 'check-in'.
 */
function logStaticRedirect_(e, routeTag, label) {
  var redirectToken = (e && e.parameter && e.parameter.id) || null;
  GasLogger.log(routeTag + '.staticRedirect', { hasQuery: !!(e && e.queryString), token: redirectToken });

  if (typeof logActivity === 'undefined') return;

  var activityMsg = 'Redirect to static ' + label;
  if (redirectToken && typeof resolveCheckinSession_ === 'function') {
    try {
      var tokenSession = resolveCheckinSession_(resolveTemplateSpreadsheet_(e), redirectToken);
      if (tokenSession && tokenSession.f3Name) {
        activityMsg += ' (' + maskPiiForLog_(tokenSession.f3Name) + ')';
      }
    } catch (err) {
      GasLogger.log(routeTag + '.redirectLogError', { error: err.message });
    }
  }
  logActivity(activityMsg, 'GAS-to-static-redirect');
}

/**
 * Minimal page returned in place of a static-front-end redirect when no static URL could be
 * built — practically Node-test-only; every real deployment has STATIC_PAGES_BASE_URL_ set
 * (version.js), so this never renders in production. DR-04 (2026-08-04) removed the
 * GAS-rendered SignupApp.html/CheckinApp.html/IdentityCore.html fallback templates outright
 * (see design-review-2026-08-04.md and ADR-019/ADR-020) — this route has nothing left to fall
 * back to, only an explanation.
 * @param {string} label What's unavailable, e.g. 'Go30 Hard Commit Signup'.
 */
function renderStaticUnavailable_(label) {
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;' +
    'padding:40px 20px;color:#333}h1{font-size:20px;margin:0 0 10px}' +
    'p{font-size:15px;line-height:1.5;color:#555}</style></head><body>' +
    '<h1>' + label + ' is unavailable</h1>' +
    '<p>The static front end is not configured for this deployment.</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(label)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Serves the cmd=signup route. DR-04/F3Go30-wjpu (2026-08-04): the GAS-rendered signup page
 * (formerly SignupApp.html) is gone — every arrival, legacy or fresh, is handed to the static
 * signup front end via the same query-preserving redirect (buildStaticSignupRedirectUrl_,
 * Utilities.js; renderStaticRedirect_ above) that already carried old ?cmd=signup links across
 * before this removal (F3Go30-833s.11 AC5 — an old link is never a dead end). See
 * renderStaticUnavailable_ for the one case (static host unconfigured) this doesn't redirect.
 */
function renderSignupPage_(e) {
  var staticSignupUrl = (typeof buildStaticSignupRedirectUrl_ === 'function')
    ? buildStaticSignupRedirectUrl_(ScriptApp.getService().getUrl(), (e && e.parameter) || {})
    : '';
  if (staticSignupUrl) {
    logStaticRedirect_(e, 'renderSignupPage_', 'signup');
    return renderStaticRedirect_(staticSignupUrl, { bodyLabel: 'Go30 signup', title: 'Go30 Hard Commit Signup' });
  }
  return renderStaticUnavailable_('Go30 Hard Commit Signup');
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
        var sheetIds = Object.keys(trackerState.bySheetId);
        var layoutKeys = sheetIds.map(trackerLayoutCacheKey_).concat(sheetIds.map(responsesLayoutCacheKey_));
        if (layoutKeys.length) {
          CacheService.getScriptCache().removeAll(layoutKeys);
          layoutCleared = layoutKeys.length;
        }
      } catch (err) {
        GasLogger.log('handleAdminPost_.invalidateAllCache.layoutClearFailed', { error: err.message });
      }
      // Reload immediately rather than leaving every PAX cold (F3Go30-uz9e.3). This action's
      // callers are all operator/deploy-time — the onOpen "Invalidate Cache" menu item and
      // tools/manage-deployments.js's post-deploy step — so the rebuild is paid here instead of
      // by whichever PAX happens to load the dashboard first. Lock-guarded and best-effort: a
      // skipped reload just means the old cold-start behavior, so it never fails the wipe.
      var reloaded = { skipped: true };
      try {
        reloaded = reloadPaxCacheForCurrentAndPriorMonth_(SpreadsheetApp.getActiveSpreadsheet());
      } catch (reloadErr) {
        GasLogger.log('handleAdminPost_.invalidateAllCache.reloadFailed', { error: reloadErr.message });
      }
      GasLogger.log('handleAdminPost_.invalidateAllCache', { wiped: wipedCount, layoutCleared: layoutCleared, reloaded: reloaded });
      return jsonOutput_({ ok: true, wiped: wipedCount, layoutCleared: layoutCleared, reloaded: reloaded });
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
      return handleCheckinPost_(e);
    }
    return jsonOutput_({ status: 'ok' });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderSignupPage_: renderSignupPage_,
    renderStaticRedirect_: renderStaticRedirect_,
    renderStaticUnavailable_: renderStaticUnavailable_,
    logStaticRedirect_: logStaticRedirect_,
    renderHomePage_: renderHomePage_,
    handleAdminPost_: handleAdminPost_,
    buildWebAppRequestLog_: buildWebAppRequestLog_,
  };
}
