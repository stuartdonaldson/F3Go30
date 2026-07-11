/*
 * dashboardWebapp.js
 *
 * Backend for the PAX-facing dashboard + daily check-in web app (doGet/doPost ?cmd=checkin).
 * Identity is F3 Name alone (the spreadsheet has always been link-open, so name+email was never
 * a real access-control boundary — see F3Go30-rvde for the actual anti-bot follow-up). Matched
 * via signupWebapp.js's findSignupMatchByF3NameOnly_ against the current month's Responses
 * sheet; a submitted email that doesn't match the record on file produces a non-blocking
 * emailMismatch flag in the response rather than a hard "not found" — see
 * handleCheckinIdentify_.
 *
 * "Team" here is whatever string lives in the Tracker's column B (Goal/Team, itself a VLOOKUP
 * into Goals by HIM) — there is no fixed team roster in the data model, so grouping is always
 * driven by that value, not an invented list.
 */

var dashboardWebappSignupModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./signupWebapp.js')
  : null;
var getCurrentAndNextMonths_dw_ = (dashboardWebappSignupModule_ && dashboardWebappSignupModule_.getCurrentAndNextMonths_)
  || (typeof globalThis !== 'undefined' && globalThis.getCurrentAndNextMonths_);
var selectTargetMonth_dw_ = (dashboardWebappSignupModule_ && dashboardWebappSignupModule_.selectTargetMonth_)
  || (typeof globalThis !== 'undefined' && globalThis.selectTargetMonth_);
var findSignupMatchByF3NameOnly_dw_ = (dashboardWebappSignupModule_ && dashboardWebappSignupModule_.findSignupMatchByF3NameOnly_)
  || (typeof globalThis !== 'undefined' && globalThis.findSignupMatchByF3NameOnly_);
var findPaxDbMatch_dw_ = (dashboardWebappSignupModule_ && dashboardWebappSignupModule_.findPaxDbMatch_)
  || (typeof globalThis !== 'undefined' && globalThis.findPaxDbMatch_);

var dashboardWebappResponseUtilsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./response_utils.js')
  : null;
var resolveResponseColumns_dw_ = (dashboardWebappResponseUtilsModule_ && dashboardWebappResponseUtilsModule_.resolveResponseColumns)
  || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns);
var getResponseEmailValue_dw_ = (dashboardWebappResponseUtilsModule_ && dashboardWebappResponseUtilsModule_.getResponseEmailValue_)
  || (typeof globalThis !== 'undefined' && globalThis.getResponseEmailValue_);

var dashboardWebappPaxCacheModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./PaxCache.js')
  : null;
var getPaxCacheRow_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.getPaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxCacheRow_);
var setPaxCacheRow_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.setPaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxCacheRow_);
var setPaxCacheRowsBulk_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.setPaxCacheRowsBulk_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxCacheRowsBulk_);
var deletePaxCacheRow_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.deletePaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.deletePaxCacheRow_);
var resolvePaxRowIndex_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.resolvePaxRowIndex_)
  || (typeof globalThis !== 'undefined' && globalThis.resolvePaxRowIndex_);
var paxCacheNormalizeName_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.paxCacheNormalizeName_)
  || (typeof globalThis !== 'undefined' && globalThis.paxCacheNormalizeName_);
var ensurePaxCacheFresh_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.ensurePaxCacheFresh_)
  || (typeof globalThis !== 'undefined' && globalThis.ensurePaxCacheFresh_);

var dashboardWebappBonusModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./bonusWebapp.js')
  : null;
var listBonusEntriesForPax_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.listBonusEntriesForPax_)
  || (typeof globalThis !== 'undefined' && globalThis.listBonusEntriesForPax_);
var addBonusEntry_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.addBonusEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.addBonusEntry_);
var editBonusEntry_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.editBonusEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.editBonusEntry_);
var clearBonusEntry_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.clearBonusEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.clearBonusEntry_);
var findBonusRowByIdentity_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.findBonusRowByIdentity_)
  || (typeof globalThis !== 'undefined' && globalThis.findBonusRowByIdentity_);
var getAllBonusEntriesCached_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.getAllBonusEntriesCached_)
  || (typeof globalThis !== 'undefined' && globalThis.getAllBonusEntriesCached_);

var dashboardWebappIdentityTokenModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./IdentityToken.js')
  : null;
// mintIdentityToken_dw_ is gone — checkin bookmark links are GUID sessions now (CheckinSessions.js);
// verifyIdentityToken_dw_ stays only as resolveCheckinToken_dw_'s fallback for tokens minted
// before that rollout (see its docstring for the retirement plan).
var verifyIdentityToken_dw_ = (dashboardWebappIdentityTokenModule_ && dashboardWebappIdentityTokenModule_.verifyIdentityToken_)
  || (typeof globalThis !== 'undefined' && globalThis.verifyIdentityToken_);

var dashboardWebappCheckinSessionsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./CheckinSessions.js')
  : null;
var resolveCheckinSession_dw_ = (dashboardWebappCheckinSessionsModule_ && dashboardWebappCheckinSessionsModule_.resolveCheckinSession_)
  || (typeof globalThis !== 'undefined' && globalThis.resolveCheckinSession_);
var createOrTouchCheckinSession_dw_ = (dashboardWebappCheckinSessionsModule_ && dashboardWebappCheckinSessionsModule_.createOrTouchCheckinSession_)
  || (typeof globalThis !== 'undefined' && globalThis.createOrTouchCheckinSession_);

var dashboardWebappBonusTypesModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./BonusTypes.js')
  : null;
var bonusTypeClientRules_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.bonusTypeClientRules_)
  || (typeof globalThis !== 'undefined' && globalThis.bonusTypeClientRules_);
var bonusTypeDisplayList_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.bonusTypeDisplayList_)
  || (typeof globalThis !== 'undefined' && globalThis.bonusTypeDisplayList_);
var emptyBonusPills_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.emptyBonusPills_)
  || (typeof globalThis !== 'undefined' && globalThis.emptyBonusPills_);
var weekOfMonth_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.weekOfMonth_)
  || (typeof globalThis !== 'undefined' && globalThis.weekOfMonth_);
var computeBonusPillsAsOf_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.computeBonusPillsAsOf_)
  || (typeof globalThis !== 'undefined' && globalThis.computeBonusPillsAsOf_);
var computeBonusSeriesForPax_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.computeBonusSeriesForPax_)
  || (typeof globalThis !== 'undefined' && globalThis.computeBonusSeriesForPax_);
var annotateBonusEntryCountStatus_dw_ = (dashboardWebappBonusTypesModule_ && dashboardWebappBonusTypesModule_.annotateBonusEntryCountStatus_)
  || (typeof globalThis !== 'undefined' && globalThis.annotateBonusEntryCountStatus_);

// ─────────────────────────────────────────────────────────────────────────
// Pure functions (unit-tested — test/test_dashboard_webapp.js)
// ─────────────────────────────────────────────────────────────────────────

/** First fixed (non-day, non-bonus) Tracker column: A F3 Name .. H Score. Day/Bonus columns start at index 8 (column I). */
var TRACKER_FIXED_COLUMN_COUNT_ = 8;
var TRACKER_NAME_COL_ = 0;
var TRACKER_TEAM_COL_ = 1;
// Columns C-F hold per-type month-to-date bonus totals (docs/sheet-reference.md "Tracker"
// §Column layout), but the dashboard no longer reads them — they're neither date-scoped nor
// capped at 1/period the way the fe/q/ins/eh pills need to be (see computeBonusPillsAsOf_).
var TRACKER_RAW_SCORE_COL_ = 6;
var TRACKER_SCORE_COL_ = 7;

/**
 * Classifies Tracker row3 (header: date or 'Bonus') / row2 (bonus period number) columns,
 * starting at TRACKER_FIXED_COLUMN_COUNT_, into day columns and bonus columns — mirrors
 * CreateNewTracker.js's populateTrackerSheet/setBonusColumn layout exactly.
 * @param {Array} row2Values Row 2 values (period numbers live above Bonus columns).
 * @param {Array} row3Values Row 3 values (dates, or the literal string 'Bonus').
 * @returns {{dayCols: Array<{col:number,date:Date}>, bonusCols: Array<{col:number,period:*,precedingDate:(Date|null)}>}}
 */
function classifyTrackerColumns_(row2Values, row3Values) {
  var dayCols = [];
  var bonusCols = [];
  for (var c = TRACKER_FIXED_COLUMN_COUNT_; c < (row3Values || []).length; c++) {
    var value = row3Values[c];
    if (value instanceof Date && !isNaN(value.getTime())) {
      dayCols.push({ col: c, date: value });
    } else if (String(value || '').trim() === 'Bonus') {
      bonusCols.push({ col: c, period: row2Values ? row2Values[c] : undefined, precedingDate: null });
    }
  }
  // Each Bonus column immediately follows the date column it closes out (the Saturday, or the
  // last day of the month for a trailing bonus column).
  bonusCols.forEach(function(bonusCol) {
    var preceding = dayCols.filter(function(d) { return d.col === bonusCol.col - 1; })[0];
    bonusCol.precedingDate = preceding ? preceding.date : null;
  });
  return { dayCols: dayCols, bonusCols: bonusCols };
}

function sameCalendarDate_(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Finds the dayCols entry matching targetDate's calendar date (time-of-day ignored). */
function findDateColumnIndex_(dayCols, targetDate) {
  for (var i = 0; i < (dayCols || []).length; i++) {
    if (sameCalendarDate_(dayCols[i].date, targetDate)) return dayCols[i].col;
  }
  return -1;
}

/** Case-insensitive/trimmed F3 Name match against Tracker column A values (row 4+). Returns 0-based row offset or -1. */
function findTrackerRowIndexByName_(nameColumnValues, f3Name) {
  var norm = String(f3Name || '').trim().toLowerCase();
  if (!norm) return -1;
  for (var i = 0; i < (nameColumnValues || []).length; i++) {
    if (String(nameColumnValues[i] || '').trim().toLowerCase() === norm) return i;
  }
  return -1;
}

/**
 * Current streak: trims trailing not-yet-reported days (blank), then counts backward from the
 * last reported day while its value is 1, stopping at the first 0/-1.
 */
function computeStreak_(dayValues) {
  var values = (dayValues || []).slice();
  while (values.length && values[values.length - 1] === '') values.pop();
  var streak = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    if (values[i] === 1) streak++;
    else break;
  }
  return streak;
}

function countOutcomes_(dayValues) {
  var done = 0, missed = 0, absent = 0;
  (dayValues || []).forEach(function(v) {
    if (v === 1) done++;
    else if (v === 0) missed++;
    else if (v === -1) absent++;
  });
  return { done: done, missed: missed, absent: absent };
}

/**
 * Longest run of consecutive 1's, trimming trailing not-yet-reported (blank) days first —
 * same trimming rule as computeStreak_. When windowDays is given, only the trailing
 * windowDays reported values are considered (e.g. "max streak in the last 30 days").
 */
function computeMaxStreak_(dayValues, windowDays) {
  var values = (dayValues || []).slice();
  while (values.length && values[values.length - 1] === '') values.pop();
  if (windowDays) values = values.slice(-windowDays);
  var max = 0, run = 0;
  for (var i = 0; i < values.length; i++) {
    if (values[i] === 1) { run++; if (run > max) max = run; } else { run = 0; }
  }
  return max;
}

/** True when a Tracker day cell is blank (never reported), i.e. yesterday's check-in prompt should show. */
function needsYesterdayCheckin_(cellValue) {
  return cellValue === '' || cellValue === undefined || cellValue === null;
}

/**
 * Groups PAX rows (each {name, team, score, ...}) by their Team value (case-insensitive/
 * trimmed; blank -> 'Unassigned'), sorts members within a group by score descending, and
 * sorts groups by average score descending.
 */
function groupByTeam_(paxRows) {
  var byKey = {};
  (paxRows || []).forEach(function(row) {
    var trimmed = String(row.team || '').trim();
    var key = trimmed ? trimmed.toLowerCase() : '__unassigned__';
    if (!byKey[key]) byKey[key] = { name: trimmed || 'Unassigned', members: [] };
    byKey[key].members.push(row);
  });

  var groups = Object.keys(byKey).map(function(key) { return byKey[key]; });
  groups.forEach(function(group) {
    group.members.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
    var sum = group.members.reduce(function(acc, m) { return acc + (m.score || 0); }, 0);
    group.avgScore = group.members.length ? sum / group.members.length : 0;
  });
  groups.sort(function(a, b) { return b.avgScore - a.avgScore; });
  return groups;
}

/**
 * Classifies a single Tracker day cell: 'done' (1), 'missed' (0), 'absent' (-1, Q-marked via
 * markMinusOne — a PAX never sets this themselves), or 'pending' (blank — not yet reported,
 * never treated as a negative outcome or an error).
 */
function dayValueStatus_(cellValue) {
  if (cellValue === 1) return 'done';
  if (cellValue === 0) return 'missed';
  if (cellValue === -1) return 'absent';
  return 'pending';
}

/**
 * Classifies every day 1..totalDays for ring/day-grid rendering — dayValueStatus_ for a
 * reported value, 'upcoming' for a day beyond what's been read yet (future days, or totalDays
 * longer than dayValues).
 */
function buildDaySegments_(dayValues, totalDays) {
  var values = dayValues || [];
  var segments = [];
  for (var i = 0; i < totalDays; i++) {
    if (i >= values.length) { segments.push('upcoming'); continue; }
    segments.push(dayValueStatus_(values[i]));
  }
  return segments;
}

/**
 * Trailing windowSize-day mean at each reported-day index, for the 7-day moving-average chart
 * and team-tile sparklines. Blank cells within the window are excluded from the average rather
 * than treated as 0 — a not-yet-reported day shouldn't drag the average down.
 */
function buildRollingAverage_(dayValues, windowSize) {
  var values = dayValues || [];
  var series = [];
  for (var i = 0; i < values.length; i++) {
    var start = Math.max(0, i - windowSize + 1);
    var windowVals = values.slice(start, i + 1).filter(function(v) { return v === 1 || v === 0 || v === -1; });
    var avg = windowVals.length ? windowVals.reduce(function(a, b) { return a + b; }, 0) / windowVals.length : 0;
    series.push(avg);
  }
  return series;
}

/**
 * Same trailing-mean series as buildRollingAverage_, but the window for the first
 * (windowSize-1) days of dayValues can reach back into priorMonthTailValues (the trailing days
 * of the previous month's tracker) instead of being artificially shortened at the month
 * boundary — e.g. day 2 of a new month sees a 2-day window today, but should see a 14-day
 * window spanning back into last month, same as any other day.
 * @param {Array<number>} dayValues This month's values (own tracker, own PAX).
 * @param {number} windowSize
 * @param {Array<number>} priorMonthTailValues Trailing values from the previous month (any
 *   length — only the last windowSize-1 are used); [] or omitted when there's no prior tracker.
 * @returns {Array<number>} Same length as dayValues, aligned 1:1 (the lookback prefix is
 *   computed against but never included in the returned series).
 */
function buildRollingAverageWithLookback_(dayValues, windowSize, priorMonthTailValues) {
  var tail = (priorMonthTailValues || []).slice(-(windowSize - 1));
  var combined = tail.concat(dayValues || []);
  return buildRollingAverage_(combined, windowSize).slice(tail.length);
}

/** Bonus pill/score computation (weekOfMonth_, computeBonusPillsAsOf_, computeBonusSeriesForPax_,
 *  annotateBonusEntryCountStatus_) lives in BonusTypes.js — see the require block above for the
 *  *_dw_ bindings used below. */

// ─────────────────────────────────────────────────────────────────────────
// GAS orchestration (not unit-tested — composes the pure functions above,
// verified against the live TEST_APP deployment, same boundary as signupWebapp.js).
// ─────────────────────────────────────────────────────────────────────────

// Hosted from the public GitHub repo (raw.githubusercontent.com) rather than Apps Script itself
// — HtmlService has no static asset hosting for binary files, clasp push only syncs .gs/.html/
// manifest sources, and HtmlOutput.setFaviconUrl() explicitly requires an external URL (favicon
// <link> tags written directly in an Apps Script HTML file are documented as ignored). Keep this
// in sync with docs/references/Go30-Logo.png's committed path.
var CHECKIN_PAGE_FAVICON_URL_ = 'https://raw.githubusercontent.com/stuartdonaldson/F3Go30/main/docs/references/Go30-Logo.png';

/**
 * Renders the cmd=checkin HTML page.
 * @param {Object=} e The doGet request event — needed for e.parameter.id (a saved-link
 *   check-in session guid, see CheckinSessions.js). NOTE: the served page's own client-side JS cannot
 *   read the request's query string itself — Apps Script injects the page content into a
 *   nested sandbox iframe whose own src carries no query string at all (confirmed live via
 *   Playwright frame inspection, 2026-07-04), so a deep-link param only reaches the client if
 *   it's read here, server-side, and templated in explicitly (savedIdentityTokenJson below).
 *   The page <title> has the same constraint — client-side document.title changes inside that
 *   sandboxed iframe don't reach the top-level (bookmarkable) document, so a personal-link
 *   token's f3Name is decoded here, server-side (cheap signature check only, no spreadsheet
 *   open), purely to make the title/bookmark name recognizable per-PAX.
 */
/**
 * Shared CheckinApp.html template builder for both entry points that can serve this page:
 * a plain doGet (optionally carrying a saved-link token) and a real top-level form POST from
 * the typed-identify button (renderCheckinPageForTypedIdentify_ below). Baking a pre-resolved
 * typedIdentifyResult into the page — instead of returning JSON for client-side script to act
 * on — is what lets the typed-identify button be a genuine <form target="_top"> submission: a
 * real user-gesture navigation the browser always honors, rather than a script-triggered
 * redirect after an async round trip (see attemptTopRedirect_'s history, F3Go30 hardening
 * work 2026-07).
 * @param {?string} savedToken A saved-link token to auto-apply client-side (doGet path), or
 *   null. Ignored when typedIdentifyResult is given (that result already carries its own
 *   session guid).
 * @param {?Object} typedIdentifyResult The exact object handleCheckinIdentify_ returns, or
 *   null for the plain doGet path.
 * @param {string} formGuid The session guid to embed in the identify form's own `action` URL
 *   (raw, not JSON — see CheckinApp.html) — always present, even when nothing has resolved yet,
 *   since it's what makes a subsequent typed-identify POST land on a fixed, already-correct
 *   address bar in one interaction (see CheckinSessions.js's file header).
 * @param {Object} spreadsheet The already-resolved target Template spreadsheet (see
 *   resolveTemplateSpreadsheet_, ADR-014 D1) — callers resolve this once from the request's ns
 *   parameter and pass it through, rather than this function re-deriving it.
 * @param {?string} ns The request's raw ns value (ADR-014 D3), templated into the page so
 *   CheckinApp.html's client-side callApi() can echo it back on every subsequent POST — the
 *   sandboxed iframe carries no query string, so this is the only way it reaches the client.
 */
function buildCheckinPageOutput_(savedToken, typedIdentifyResult, formGuid, spreadsheet, ns) {
  var template = HtmlService.createTemplateFromFile('CheckinApp');
  var webAppUrl = ScriptApp.getService().getUrl();
  template.webAppUrl = JSON.stringify(webAppUrl);
  template.webAppUrlRaw = webAppUrl;
  template.formGuid = formGuid;
  template.appVersion = APP_VERSION;
  template.savedIdentityTokenJson = JSON.stringify(savedToken || null);
  template.typedIdentifyResultJson = JSON.stringify(typedIdentifyResult || null);
  template.urlNsJson = JSON.stringify(ns || null);
  template.bonusTypesJson = JSON.stringify(bonusTypeClientRules_dw_());
  template.bonusTypeCodesJson = JSON.stringify(bonusTypeDisplayList_dw_());
  // Site Q contact info for the client's "something went wrong" error banner — same Config
  // sheet row (bound/template spreadsheet, not any month's own tracker) that CreateNewTracker.js
  // and Utilities.js's policy loader already read for admin/nag emails.
  var siteQConfig = getConfigValue_(spreadsheet, 'Site Q', null) || {};
  template.siteQName = siteQConfig.primary || 'Site Q';
  template.siteQEmail = siteQConfig.secondary || '';
  var nameSpaceConfig = getConfigValue_(spreadsheet, 'NameSpace', null) || {};
  var nameSpace = nameSpaceConfig.primary || 'F3 Go30';
  template.nameSpace = nameSpace;
  var titleF3Name = (typedIdentifyResult && typedIdentifyResult.f3Name) ||
    (savedToken && (resolveCheckinToken_dw_(spreadsheet, savedToken) || {}).f3Name);
  var pageTitle = titleF3Name ? (nameSpace + ': ' + titleF3Name) : nameSpace;
  // HtmlService serves this inside an IFRAME-sandboxed wrapper that does not honor a
  // <meta name="viewport"> tag written in the template's own <head> — it must be set via
  // addMetaTag, or mobile browsers render the desktop layout zoomed out instead of fitting
  // the device width.
  return template.evaluate()
    .setTitle(pageTitle)
    .setFaviconUrl(CHECKIN_PAGE_FAVICON_URL_)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderCheckinPage_(e) {
  var savedToken = (e && e.parameter && e.parameter.id) || null;
  // A fresh visit (no incoming id) still needs a guid to bake into the identify form's action
  // URL — see CheckinSessions.js's file header. Reusing an incoming-but-unresolvable id here
  // (rather than always minting a new one) is harmless: it just gets bound on the next typed
  // identify instead of being wasted.
  var formGuid = savedToken || Utilities.getUuid();
  var ns = (e && e.parameter && e.parameter.ns) || null;
  return buildCheckinPageOutput_(savedToken, null, formGuid, resolveTemplateSpreadsheet_(e), ns);
}

/**
 * Serves the cmd=checkin page for a real <form target="_top"> POST from the typed-identify
 * button (as opposed to handleCheckinPost_'s JSON action dispatch, used by the token-auto-apply
 * and in-page calls). Resolving identity synchronously and baking the result into the page
 * render means the button click IS the navigation — no script-triggered redirect afterward that
 * could silently fail to fire (see F3Go30 hardening work 2026-07, Crazy Ivan's repeated-identify
 * reports). Reuses handleCheckinIdentify_ wholesale so PaxDB fallthrough / session-binding-on-
 * match behavior never drifts between the JSON and form-POST entry points.
 */
function renderCheckinPageForTypedIdentify_(e) {
  var spreadsheet = resolveTemplateSpreadsheet_(e);
  var f3Name = (e.parameter && e.parameter.f3Name) || '';
  var email = (e.parameter && e.parameter.email) || '';
  // The form's own action URL already carries this exact guid (see CheckinApp.html /
  // renderCheckinPage_'s formGuid) — that's what makes the resulting address bar correct in
  // one interaction, with nothing left to redirect to afterward.
  var guid = (e.parameter && e.parameter.id) || Utilities.getUuid();
  var result = handleCheckinIdentify_(spreadsheet, { f3Name: f3Name, email: email, guid: guid });
  // Echoed back only for the not-matched case, so the identify form can be re-populated with
  // what was just typed — a fresh page render doesn't otherwise know what the PAX entered.
  result.submittedF3Name = f3Name;
  result.submittedEmail = email;
  // savedToken (first arg) is deliberately null here, even on a match — passing it would also
  // make the client's SAVED_IDENTITY_TOKEN branch fire, re-running an async identify(token) call
  // in parallel with TYPED_IDENTIFY_RESULT's own handling and clobbering its saveLinkNote UI
  // once that second call resolves (confirmed live during the 2026-07 SIT verification of this
  // change). The guid still reaches the client via typedIdentifyResult.identityToken, which is
  // all saveLinkNote/saveLinkAnchor need — and the form's action already used it for the URL.
  var ns = (e.parameter && e.parameter.ns) || null;
  return buildCheckinPageOutput_(null, result, guid, spreadsheet, ns);
}

/** Dispatches a cmd=checkin doPost JSON body ({action, ...}) to the matching handler. */
function handleCheckinPost_(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'invalid_json' });
  }

  var spreadsheet = resolveTemplateSpreadsheet_(e, payload);
  try {
    if (payload.action === 'identify') return jsonOutput_(handleCheckinIdentify_(spreadsheet, payload));
    if (payload.action === 'checkin') return jsonOutput_(handleCheckinSubmit_(spreadsheet, payload));
    if (payload.action === 'dashboard') return jsonOutput_(handleCheckinDashboard_(spreadsheet, payload));
    if (payload.action === 'bonusList') return jsonOutput_(handleBonusList_(spreadsheet, payload));
    if (payload.action === 'bonusAdd') return jsonOutput_(handleBonusAdd_(spreadsheet, payload));
    if (payload.action === 'bonusEdit') return jsonOutput_(handleBonusEdit_(spreadsheet, payload));
    return jsonOutput_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    GasLogger.logError('handleCheckinPost_.error', err, { action: payload.action });
    return jsonOutput_({ ok: false, error: 'server_error' });
  }
}

var TRACKER_LAYOUT_CACHE_TTL_SECONDS_ = 21600; // CacheService's max — day/bonus column layout
                                                // only changes when the tracker's structure does.

function trackerLayoutCacheKey_(sheetId) {
  return 'go30dash:trackerLayout:' + sheetId;
}

/** Dates aren't JSON-safe for CacheService — round-trip row3's date cells through a plain marker object. */
function serializeRow3ForCache_(row3) {
  return (row3 || []).map(function(v) { return v instanceof Date ? { __d: v.toISOString() } : v; });
}

function deserializeRow3FromCache_(row3) {
  return (row3 || []).map(function(v) { return (v && typeof v === 'object' && v.__d) ? new Date(v.__d) : v; });
}

/**
 * Sheet-level cache of Tracker row2/row3 (the day/bonus column headers) — a cheap 2-row read,
 * cached separately from per-PAX data because it's shared by every PAX and rarely changes, so
 * a long CacheService TTL is safe without any write-through: normal check-ins never touch these
 * rows, only tracker-creation/restructuring does (rare, admin-only).
 */
/**
 * Cache-only half of getTrackerLayout_ — checks CacheService without touching a Sheet at all,
 * so a caller that also needs a PaxCache row hit (getPriorMonthTailValues_) can find out
 * whether it can skip opening the spreadsheet entirely before paying for that open.
 * @returns {{row2:Array, row3:Array}|null} null on a miss or corrupt entry.
 */
function getCachedTrackerLayoutOnly_(sheetId) {
  var cache = CacheService.getScriptCache();
  var cached;
  try { cached = cache.get(trackerLayoutCacheKey_(sheetId)); } catch (e) { cached = null; }
  if (!cached) return null;
  try {
    var parsed = JSON.parse(cached);
    return { row2: parsed.row2, row3: deserializeRow3FromCache_(parsed.row3) };
  } catch (e) {
    return null; // corrupt cache entry — caller falls through to a fresh read
  }
}

function getTrackerLayout_(trackerSheet, sheetId) {
  var fromCache = getCachedTrackerLayoutOnly_(sheetId);
  if (fromCache) return fromCache;

  var cache = CacheService.getScriptCache();
  var cacheKey = trackerLayoutCacheKey_(sheetId);
  var lastCol = trackerSheet.getLastColumn();
  var row2 = trackerSheet.getRange(2, 1, 1, lastCol).getValues()[0];
  var row3 = trackerSheet.getRange(3, 1, 1, lastCol).getValues()[0];

  try {
    cache.put(cacheKey, JSON.stringify({ row2: row2, row3: serializeRow3ForCache_(row3) }), TRACKER_LAYOUT_CACHE_TTL_SECONDS_);
  } catch (e) { /* payload too large or cache unavailable — the read above still succeeded */ }

  return { row2: row2, row3: row3 };
}

var FULL_ROSTER_CACHE_TTL_SECONDS_ = 21600; // CacheService's max.

function trackerValuesCacheKey_(sheetId) {
  return 'go30dash:trackerValues:' + sheetId;
}

function responsesValuesCacheKey_(sheetId) {
  return 'go30dash:responsesValues:' + sheetId;
}

/** Dates aren't JSON-safe for CacheService — same marker-object convention as
 *  serializeRow3ForCache_/deserializeRow3FromCache_ above, generalized to a full 2D range
 *  (Responses' Timestamp column and any date-typed Tracker cell both need this). */
function serializeSheetValuesForCache_(values) {
  return (values || []).map(function(row) {
    return row.map(function(v) { return v instanceof Date ? { __d: v.toISOString() } : v; });
  });
}

function deserializeSheetValuesFromCache_(values) {
  return (values || []).map(function(row) {
    return row.map(function(v) { return (v && typeof v === 'object' && v.__d) ? new Date(v.__d) : v; });
  });
}

/**
 * Cache-only half of getCachedOrFreshSheetValues_ — same split as getCachedTrackerLayoutOnly_/
 * getTrackerLayout_ above.
 * @returns {Array<Array>|null} null on a miss or corrupt entry.
 */
function getCachedSheetValuesOnly_(cacheKey) {
  var cache = CacheService.getScriptCache();
  var cached;
  try { cached = cache.get(cacheKey); } catch (e) { cached = null; }
  if (!cached) return null;
  try { return deserializeSheetValuesFromCache_(JSON.parse(cached)); } catch (e) { return null; }
}

function setCachedSheetValues_(cacheKey, values) {
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(serializeSheetValuesForCache_(values)), FULL_ROSTER_CACHE_TTL_SECONDS_);
  } catch (e) { /* payload too large or cache unavailable — the caller's fresh read still succeeded */ }
}

/**
 * Explicit write-through invalidation for the whole-sheet caches above — call at the point of
 * any write to a month's Tracker (day check-ins, -1 marking) or Responses (signups) sheet. This
 * is the primary invalidation path; ensurePaxCacheFresh_'s Drive-modtime gate (PaxCache.js) is
 * the backstop for writes that don't go through this webapp's own code (a human editing the
 * sheet directly, or a future code path that forgets to call this).
 */
function invalidateFullRosterCache_(sheetId) {
  try { CacheService.getScriptCache().remove(trackerValuesCacheKey_(sheetId)); } catch (e) { /* best-effort */ }
  try { CacheService.getScriptCache().remove(responsesValuesCacheKey_(sheetId)); } catch (e) { /* best-effort */ }
}

/**
 * Lean identity resolution for identify/checkin-submit — the two actions that only ever need
 * one PAX's own data, not the whole roster (contrast resolveCheckinIdentityFull_, used by the
 * dashboard's team/board view). Matches Responses by F3 Name alone (findSignupMatchByF3NameOnly_
 * — see file header on why email isn't a hard gate) via PaxCache's roster index, so a repeat
 * lookup for the same PAX resolves via a single-row read (or a cache hit) instead of scanning
 * every PAX's row. Never caches a name that isn't found (see PaxCache.js).
 * @returns {{matched:boolean, emailMismatch?:boolean, months:Object, monthInfo:Object,
 *   targetSs:Spreadsheet, trackerSheet:Sheet, row2:Array, row3:Array, trackerRow:Array,
 *   trackerRowIndex:number}}
 */
function resolveCheckinIdentityLean_(monthInfo, f3Name, email, months) {
  var t0 = Date.now();
  var targetSs = SpreadsheetApp.openById(monthInfo.sheetId);
  var openMs = Date.now() - t0;

  var responsesSheet = targetSs.getSheetByName('Responses');
  if (!responsesSheet) return { matched: false, months: months };

  var t1 = Date.now();
  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns_dw_(headers);

  var responsesRowIndex = resolvePaxRowIndex_dw_('responses', monthInfo.sheetId, f3Name, function() {
    var lastRow = responsesSheet.getLastRow();
    if (lastRow < 2) return [];
    var rows = responsesSheet.getRange(2, 1, lastRow - 1, responsesSheet.getLastColumn()).getValues();
    // DELETED rows (ADR-008 email-change convention) must never win a name match — blank out
    // their name here so PaxCache's roster-index builder skips them, same as
    // findSignupMatchByF3NameOnly_'s live scan does.
    return rows.map(function(row) {
      return String(row[columns.PARTICIPATION] || '').trim().toLowerCase() === 'deleted' ? '' : row[columns.F3_NAME];
    });
  });
  if (responsesRowIndex === -1) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', { matched: false, lean: true, openMs: openMs, totalMs: Date.now() - t0 });
    return { matched: false, months: months };
  }

  var responsesRow = getPaxCacheRow_dw_('responses', monthInfo.sheetId, f3Name);
  if (!responsesRow) {
    responsesRow = responsesSheet.getRange(responsesRowIndex + 2, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
    setPaxCacheRow_dw_('responses', monthInfo.sheetId, f3Name, responsesRow);
  }
  var responsesMs = Date.now() - t1;

  var registeredEmail = String(
    headers && typeof getResponseEmailValue_dw_ === 'function'
      ? getResponseEmailValue_dw_(responsesRow, columns, headers)
      : responsesRow[columns.EMAIL]
  ).trim().toLowerCase();
  var emailMismatch = registeredEmail !== String(email || '').trim().toLowerCase();

  var trackerSheet = targetSs.getSheetByName('Tracker');
  if (!trackerSheet || trackerSheet.getLastRow() < 4) return { matched: false, months: months };

  var t2 = Date.now();
  var layout = getTrackerLayout_(trackerSheet, monthInfo.sheetId);
  var trackerRowIndex = resolvePaxRowIndex_dw_('tracker', monthInfo.sheetId, f3Name, function() {
    var lastRow = trackerSheet.getLastRow();
    return trackerSheet.getRange(4, 1, lastRow - 3, 1).getValues().map(function(r) { return r[0]; });
  });
  if (trackerRowIndex === -1) return { matched: false, months: months };

  var trackerRow = getPaxCacheRow_dw_('tracker', monthInfo.sheetId, f3Name);
  if (!trackerRow) {
    trackerRow = trackerSheet.getRange(trackerRowIndex + 4, 1, 1, trackerSheet.getLastColumn()).getValues()[0];
    setPaxCacheRow_dw_('tracker', monthInfo.sheetId, f3Name, trackerRow);
  }
  var trackerMs = Date.now() - t2;

  GasLogger.log('checkinWebapp.resolveIdentity.timing', {
    matched: true, lean: true, emailMismatch: emailMismatch,
    openMs: openMs, responsesMs: responsesMs, trackerMs: trackerMs, totalMs: Date.now() - t0,
  });

  return {
    matched: true,
    emailMismatch: emailMismatch,
    months: months,
    monthInfo: monthInfo,
    targetSs: targetSs,
    trackerSheet: trackerSheet,
    row2: layout.row2,
    row3: layout.row3,
    trackerRow: trackerRow,
    trackerRowIndex: trackerRowIndex,
    goals: {
      who: responsesRow[columns.WHO] || '',
      what: responsesRow[columns.WHAT] || '',
      how: responsesRow[columns.HOW] || '',
    },
  };
}

/**
 * @param {string=} targetMonth 'current' (default) | 'next' | 'explicit' — same
 *   selectTargetMonth_ enum signup's targetMonth already uses (signupWebapp.js), so a
 *   namespace-test caller can, via 'explicit' + targetSheetId, explicitly address an arbitrary
 *   namespace-registered month (F3Go30-i5md.6/4j4o.2) here too rather than relying on it
 *   happening to be "current" by date (see resolveSignupMonths_'s docstring for why that can't
 *   be trusted). Legacy 'smoke' was retired with SMOKE_MODE (F3Go30-i5md.7).
 * @param {string=} targetSheetId Required when targetMonth === 'explicit'; see resolveSignupMonths_.
 */
function resolveCheckinIdentity_(templateSpreadsheet, f3Name, email, targetMonth, targetSheetId) {
  var t0 = Date.now();
  var months = getCurrentAndNextMonths_dw_(templateSpreadsheet, targetSheetId);
  GasLogger.log('checkinWebapp.resolveMonths.timing', { durationMs: Date.now() - t0 });
  var monthInfo = selectTargetMonth_dw_(months, targetMonth);
  if (!monthInfo) return { matched: false, months: months };
  return resolveCheckinIdentityLean_(monthInfo, f3Name, email, months);
}

/**
 * Resolves the TrackerDB row active for an arbitrary target date (past, current, or the
 * still-open latest row) via resolveTrackerForContextDate (go30tools.js) — unlike
 * getCurrentAndNextMonths_dw_ (current/next relative to real "today" only), this is what
 * lets the dashboard's date-navigation arrows step back into any earlier month that has a
 * TrackerDB entry.
 */
function resolveDashboardMonth_(targetDate, spreadsheet) {
  try {
    var row = resolveTrackerForContextDate(targetDate, spreadsheet);
    return {
      sheetId: row.sheetId,
      trackerUrl: row.trackerUrl,
      label: formatRegistrationMonth_(row.startDate),
      startDate: row.startDate instanceof Date ? row.startDate : new Date(row.startDate),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Trailing day values (up to windowSize-1) from the PAX's *previous* month's tracker, for
 * buildRollingAverageWithLookback_ — a rolling average shouldn't reset to a truncated window
 * just because a new month started. Best-effort: returns [] (never throws) whenever there's no
 * prior tracker, the PAX has no row there, or anything else goes wrong — a missing lookback
 * degrades to the old month-truncated behavior rather than breaking the dashboard.
 * Uses the same per-PAX PaxCache (kind 'tracker', keyed by the prior month's sheetId) as the
 * current month, so repeat lookups within the cache's lifetime are a single-row read, not a
 * full scan.
 */
function getPriorMonthTailValues_(monthInfo, f3Name, windowSize, templateSpreadsheet) {
  var t0 = Date.now();
  try {
    var dayBeforeMonth = new Date(monthInfo.startDate);
    dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);
    var priorMonth = resolveDashboardMonth_(dayBeforeMonth, templateSpreadsheet);
    if (!priorMonth || priorMonth.sheetId === monthInfo.sheetId) return [];

    // Fast path: if the layout and this PAX's row are both already cached (the common case
    // once the prior month has been viewed once), skip SpreadsheetApp.openById entirely —
    // it's the expensive part, and both caches are write-through invalidated on the one write
    // that can still touch a prior month (handleCheckinSubmit_'s "yesterday" path), so a hit
    // here is never stale.
    var cachedLayout = getCachedTrackerLayoutOnly_(priorMonth.sheetId);
    var cachedRow = getPaxCacheRow_dw_('tracker', priorMonth.sheetId, f3Name);
    if (cachedLayout && cachedRow) {
      var cachedClassified = classifyTrackerColumns_(cachedLayout.row2, cachedLayout.row3);
      var cachedDayValues = cachedClassified.dayCols.map(function(d) { return cachedRow[d.col]; });
      GasLogger.log('checkinWebapp.priorMonthTail.timing', { skippedOpen: true, durationMs: Date.now() - t0 });
      return cachedDayValues.slice(-(windowSize - 1));
    }

    var priorSs = SpreadsheetApp.openById(priorMonth.sheetId);
    var priorTrackerSheet = priorSs.getSheetByName('Tracker');
    if (!priorTrackerSheet || priorTrackerSheet.getLastRow() < 4) return [];

    var priorLayout = getTrackerLayout_(priorTrackerSheet, priorMonth.sheetId);
    var priorClassified = classifyTrackerColumns_(priorLayout.row2, priorLayout.row3);

    var priorRowIndex = resolvePaxRowIndex_dw_('tracker', priorMonth.sheetId, f3Name, function() {
      var lastRow = priorTrackerSheet.getLastRow();
      return priorTrackerSheet.getRange(4, 1, lastRow - 3, 1).getValues().map(function(r) { return r[0]; });
    });
    if (priorRowIndex === -1) return [];

    var priorRow = getPaxCacheRow_dw_('tracker', priorMonth.sheetId, f3Name);
    if (!priorRow) {
      priorRow = priorTrackerSheet.getRange(priorRowIndex + 4, 1, 1, priorTrackerSheet.getLastColumn()).getValues()[0];
      setPaxCacheRow_dw_('tracker', priorMonth.sheetId, f3Name, priorRow);
    }

    // The prior month is already fully over, so every one of its day columns is "reported."
    var priorDayValues = priorClassified.dayCols.map(function(d) { return priorRow[d.col]; });
    GasLogger.log('checkinWebapp.priorMonthTail.timing', { skippedOpen: false, durationMs: Date.now() - t0 });
    return priorDayValues.slice(-(windowSize - 1));
  } catch (e) {
    return [];
  }
}

/**
 * Full-roster identity resolution for the dashboard's team/board view, which needs every PAX's
 * Tracker row (contrast resolveCheckinIdentityLean_, used by identify/checkin-submit, which
 * only ever need one PAX's own row). Both full-range reads (Responses, Tracker) go through
 * getCachedSheetValuesOnly_/setCachedSheetValues_ — CacheService-backed, invalidated explicitly
 * by handleCheckinSubmit_ (the primary write path) and by ensurePaxCacheFresh_'s Drive-modtime
 * gate as a backstop (PaxCache.js) — so a month with no new writes since its last dashboard load
 * doesn't pay for a full-sheet read on every single request, only the first one. Since every row
 * is already in memory either way, this also opportunistically writes each one into PaxCache's
 * per-PAX row cache and rebuilds the roster index as a side effect, so the very next
 * identify/checkin for any of these PAX (same day) hits the lean per-PAX path instead of
 * another scan.
 */
function resolveCheckinIdentityFull_(monthInfo, f3Name, email, months) {
  var t0 = Date.now();
  var targetSs = SpreadsheetApp.openById(monthInfo.sheetId);
  var openMs = Date.now() - t0;
  var tFresh = Date.now();
  if (ensurePaxCacheFresh_dw_) ensurePaxCacheFresh_dw_(monthInfo.sheetId);
  var freshCheckMs = Date.now() - tFresh;

  var responsesSheet = targetSs.getSheetByName('Responses');
  if (!responsesSheet) return { matched: false, months: months };

  var t1 = Date.now();
  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns_dw_(headers);
  var responsesCacheKey = responsesValuesCacheKey_(monthInfo.sheetId);
  var dataRows = getCachedSheetValuesOnly_(responsesCacheKey);
  if (!dataRows) {
    dataRows = responsesSheet.getLastRow() > 1
      ? responsesSheet.getRange(2, 1, responsesSheet.getLastRow() - 1, responsesSheet.getLastColumn()).getValues()
      : [];
    setCachedSheetValues_(responsesCacheKey, dataRows);
  }
  var match = findSignupMatchByF3NameOnly_dw_(dataRows, f3Name, columns);
  var responsesMs = Date.now() - t1;
  if (!match) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', { matched: false, lean: false, openMs: openMs, freshCheckMs: freshCheckMs, responsesMs: responsesMs, totalMs: Date.now() - t0 });
    return { matched: false, months: months };
  }

  var registeredEmail = String(
    headers && typeof getResponseEmailValue_dw_ === 'function'
      ? getResponseEmailValue_dw_(match.row, columns, headers)
      : match.row[columns.EMAIL]
  ).trim().toLowerCase();
  var emailMismatch = registeredEmail !== String(email || '').trim().toLowerCase();

  var trackerSheet = targetSs.getSheetByName('Tracker');
  if (!trackerSheet || trackerSheet.getLastRow() < 4) return { matched: false, months: months };

  var t2 = Date.now();
  var layout = getTrackerLayout_(trackerSheet, monthInfo.sheetId);
  var trackerCacheKey = trackerValuesCacheKey_(monthInfo.sheetId);
  var trackerValues = getCachedSheetValuesOnly_(trackerCacheKey);
  if (!trackerValues) {
    var lastRow = trackerSheet.getLastRow();
    var lastCol = trackerSheet.getLastColumn();
    trackerValues = trackerSheet.getRange(4, 1, lastRow - 3, lastCol).getValues();
    setCachedSheetValues_(trackerCacheKey, trackerValues);
  }
  var trackerMs = Date.now() - t2;

  var t3 = Date.now();
  var rosterIndex = {};
  var rowsByName = {};
  trackerValues.forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    var norm = paxCacheNormalizeName_dw_(name);
    if (!norm) return;
    if (!Object.prototype.hasOwnProperty.call(rosterIndex, norm)) rosterIndex[norm] = idx;
    rowsByName[name] = row;
  });
  // One PropertiesService.setProperties() call for the whole roster instead of one
  // setProperty() per PAX — every row is already in memory from the full-range read above.
  setPaxCacheRowsBulk_dw_('tracker', monthInfo.sheetId, rowsByName, rosterIndex);
  var cacheWriteMs = Date.now() - t3;

  var rowIndex = rosterIndex[paxCacheNormalizeName_dw_(f3Name)];
  if (rowIndex === undefined) return { matched: false, months: months };

  GasLogger.log('checkinWebapp.resolveIdentity.timing', {
    matched: true, lean: false, emailMismatch: emailMismatch,
    openMs: openMs, freshCheckMs: freshCheckMs, responsesMs: responsesMs, trackerMs: trackerMs,
    cacheWriteMs: cacheWriteMs, totalMs: Date.now() - t0,
  });

  return {
    matched: true,
    emailMismatch: emailMismatch,
    months: months,
    monthInfo: monthInfo,
    targetSs: targetSs,
    trackerSheet: trackerSheet,
    row2: layout.row2,
    row3: layout.row3,
    trackerValues: trackerValues,
    rowIndex: rowIndex,
  };
}

// How close to next month's start the nudge is allowed to appear — a PAX who hasn't signed up
// yet three weeks out isn't neglecting anything, they just haven't gotten there; nagging them
// that early reads as noise, not a reminder. Someone who wants to sign up further ahead always
// can, unprompted, via the plain signup URL — this only gates the automatic nudge shown on the
// check-in page.
var NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_ = 3;

/**
 * Checks whether f3Name has a live (non-DELETED) Responses row for months.next — surfaced to a
 * PAX who's actively checking in for the current month as a nudge that they haven't signed up
 * for the month coming next, with a link into the signup flow. Returns null when there's no
 * next-month tracker yet at all (nothing to register for), or when next month's start is still
 * more than NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_ away — either way, the caller skips the nudge.
 * Deliberately called from handleCheckinIdentify_, not the dashboard: identify() already pays
 * for months.next via getCurrentAndNextMonths_dw_ (resolveCheckinIdentityLean_), so this adds
 * one Responses lookup rather than a second TrackerDB read on every dashboard load.
 */
function checkNextMonthRegistration_(months, f3Name) {
  if (!months || !months.next) return null;
  var nextMonth = months.next;
  var daysUntilNextMonth = (new Date(nextMonth.startDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysUntilNextMonth > NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_) return null;
  var targetSs = SpreadsheetApp.openById(nextMonth.sheetId);
  var responsesSheet = targetSs.getSheetByName('Responses');
  if (!responsesSheet) return null;

  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns_dw_(headers);
  var rowIndex = resolvePaxRowIndex_dw_('responses', nextMonth.sheetId, f3Name, function() {
    var lastRow = responsesSheet.getLastRow();
    if (lastRow < 2) return [];
    var rows = responsesSheet.getRange(2, 1, lastRow - 1, responsesSheet.getLastColumn()).getValues();
    return rows.map(function(row) {
      return String(row[columns.PARTICIPATION] || '').trim().toLowerCase() === 'deleted' ? '' : row[columns.F3_NAME];
    });
  });

  return { registered: rowIndex !== -1, monthLabel: nextMonth.label };
}

/**
 * Resolves the Tracker cell for a specific check-in date, given the PAX's already-resolved
 * identity for their *current* month — expands into that date's own tracker when it falls
 * outside the current month (e.g. looking up/editing yesterday's check-in on the 1st of a new
 * month, when the current month's tracker has no column for it at all). Mirrors the cross-month
 * lookback pattern in getPriorMonthTailValues_. Returns null when no tracker has a day column
 * for targetDate (never throws).
 * @returns {?{trackerSheet:Sheet, sheetId:string, rowIndex:number, col:number, value:*}}
 */
function resolveCheckinDayTarget_(identity, f3Name, targetDate, templateSpreadsheet) {
  var classified = classifyTrackerColumns_(identity.row2, identity.row3);
  var col = findDateColumnIndex_(classified.dayCols, targetDate);
  if (col !== -1) {
    return {
      trackerSheet: identity.trackerSheet,
      sheetId: identity.monthInfo.sheetId,
      rowIndex: identity.trackerRowIndex,
      col: col,
      value: identity.trackerRow[col],
    };
  }

  try {
    var otherMonth = resolveDashboardMonth_(targetDate, templateSpreadsheet);
    if (!otherMonth || otherMonth.sheetId === identity.monthInfo.sheetId) return null;

    var otherSs = SpreadsheetApp.openById(otherMonth.sheetId);
    var otherTrackerSheet = otherSs.getSheetByName('Tracker');
    if (!otherTrackerSheet || otherTrackerSheet.getLastRow() < 4) return null;

    var otherLayout = getTrackerLayout_(otherTrackerSheet, otherMonth.sheetId);
    var otherClassified = classifyTrackerColumns_(otherLayout.row2, otherLayout.row3);
    var otherCol = findDateColumnIndex_(otherClassified.dayCols, targetDate);
    if (otherCol === -1) return null;

    var otherRowIndex = resolvePaxRowIndex_dw_('tracker', otherMonth.sheetId, f3Name, function() {
      var lastRow = otherTrackerSheet.getLastRow();
      return otherTrackerSheet.getRange(4, 1, lastRow - 3, 1).getValues().map(function(r) { return r[0]; });
    });
    if (otherRowIndex === -1) return null;

    var otherRow = getPaxCacheRow_dw_('tracker', otherMonth.sheetId, f3Name);
    if (!otherRow) {
      otherRow = otherTrackerSheet.getRange(otherRowIndex + 4, 1, 1, otherTrackerSheet.getLastColumn()).getValues()[0];
      setPaxCacheRow_dw_('tracker', otherMonth.sheetId, f3Name, otherRow);
    }

    return {
      trackerSheet: otherTrackerSheet,
      sheetId: otherMonth.sheetId,
      rowIndex: otherRowIndex,
      col: otherCol,
      value: otherRow[otherCol],
    };
  } catch (e) {
    return null;
  }
}

/**
 * Resolves a saved-link `token` param to {f3Name, email, mintedAtMs, viaLegacyToken, firstUse},
 * or null — tries the current CheckinSessions store first, then falls back to IdentityToken.js's
 * signed token for anything minted before the 2026-07 GUID-session rollout. Logs
 * checkinWebapp.identify.legacyTokenUsed on every legacy hit so Axiom can be watched for it to
 * taper off; once it's been silent for a full old-token's practical lifetime, the
 * verifyIdentityToken_dw_ fallback here (and IdentityToken.js itself) can be deleted.
 *
 * firstUse is exact, not a time-window guess — CheckinSessions tracks Created At and Last Used
 * At precisely, so "has this exact session ever been resolved again since the moment it was
 * created" is a direct comparison, not an inferred "still looks new-ish" heuristic the way the
 * old signed token's mintedAtMs-vs-now window had to be (there was no session store to ask
 * before). A legacy token is never firstUse: resolving one at all means the PAX already has and
 * has used this bookmark before — migrating its storage backend isn't a "welcome, first time"
 * moment for them.
 */
function resolveCheckinToken_dw_(spreadsheet, token) {
  var session = resolveCheckinSession_dw_(spreadsheet, token);
  if (session) {
    return {
      f3Name: session.f3Name,
      email: session.email,
      mintedAtMs: new Date(session.createdAt).getTime(),
      viaLegacyToken: false,
      firstUse: session.createdAt === session.lastUsedAt,
    };
  }
  var decoded = verifyIdentityToken_dw_(token);
  if (decoded) {
    GasLogger.log('checkinWebapp.identify.legacyTokenUsed', {});
    return { f3Name: decoded.f3Name, email: decoded.email, mintedAtMs: decoded.mintedAtMs, viaLegacyToken: true, firstUse: false };
  }
  return null;
}

function handleCheckinIdentify_(templateSpreadsheet, payload) {
  var t0 = Date.now();
  // A saved-link token stands in for typed f3Name/email — resolving it only proves this exact
  // guid has a live session (or, for a pre-rollout link, a valid signature) bound to an
  // identity; it does NOT bypass the resolveCheckinIdentity_ lookup below, so neither can ever
  // outlive the PAX's actual roster entry (removed/renamed). tokenInvalid distinguishes "your
  // saved link stopped working" (show a blank form, no error text) from "we couldn't find a
  // signup for what you typed" (show the sign-up prompt).
  var f3Name = payload.f3Name;
  var email = payload.email;
  var tokenInvalid = false;
  // The typed-identify form-POST path always creates a brand-new guid (baked into the form's
  // action URL before submission, so nothing could have used it yet) — unconditionally a first
  // use. The returning-bookmark path (payload.token) overrides this below once resolved, per
  // resolveCheckinToken_dw_'s exact createdAt-vs-lastUsedAt comparison.
  var firstUse = !payload.token;
  // payload.guid: the typed-identify form-POST path — identity not yet known, guid already is
  // (baked into the form's action URL at render time). payload.token: the returning-bookmark
  // path — guid known, identity not, resolved here from the session store. Never both at once
  // in practice, but either name works regardless of which call site is asking.
  var sessionGuid = payload.guid || payload.token || null;
  // Set only when this request resolved via a pre-rollout signed IdentityToken.js token (never
  // via an already-migrated session) — used below to seed the migrated session's Created At with
  // the token's own original mint time rather than "now", so a long-bookmarked link doesn't
  // suddenly look brand new (firstUse, the "go bookmark me" nudge) just because today happened
  // to be the first time it got migrated into CheckinSessions.
  var legacyTokenMintedAtIso = null;
  if (payload.token) {
    var resolved = resolveCheckinToken_dw_(templateSpreadsheet, payload.token);
    if (resolved) {
      f3Name = resolved.f3Name;
      email = resolved.email;
      firstUse = resolved.firstUse;
      if (resolved.viaLegacyToken) legacyTokenMintedAtIso = new Date(resolved.mintedAtMs).toISOString();
    } else {
      tokenInvalid = true;
    }
  }
  GasLogger.log('checkinWebapp.identify', { f3Name: f3Name, viaToken: !!payload.token });
  if (tokenInvalid) {
    GasLogger.log('checkinWebapp.identify.result', { matched: false, tokenInvalid: true, durationMs: Date.now() - t0 });
    return { ok: true, matched: false, tokenInvalid: true };
  }
  var identity = resolveCheckinIdentity_(templateSpreadsheet, f3Name, email, payload.targetMonth, payload.targetSheetId);
  if (!identity.matched) {
    // PaxDB fallback (F3Go30-xj1q.1): only here, in the typed/token-decoded miss branch — never
    // in the tokenInvalid branch above, where f3Name/email come from an unverified client and a
    // PaxDB lookup would be a name+email enumeration oracle. findPaxDbMatch_ (signupWebapp.js)
    // requires an EXACT match on both fields — the same anti-enumeration boundary the signup
    // app's own identify already exposes, so this doesn't open anything new. A PaxDB hit here
    // means "known PAX, just not signed up for the CURRENT month's tracker" — the client uses
    // knownPaxNotRegistered to auto-carry them into signup instead of a dead-end message.
    var paxDbMatch = findPaxDbMatch_dw_(templateSpreadsheet, f3Name, email);
    if (paxDbMatch) {
      GasLogger.log('checkinWebapp.identify.result', {
        matched: false, knownPaxNotRegistered: true, tokenInvalid: !!payload.token, durationMs: Date.now() - t0,
      });
      return {
        ok: true, matched: false, tokenInvalid: !!payload.token,
        knownPaxNotRegistered: true, f3Name: paxDbMatch.f3Name, email: paxDbMatch.email,
      };
    }
    GasLogger.log('checkinWebapp.identify.result', { matched: false, durationMs: Date.now() - t0 });
    return { ok: true, matched: false, tokenInvalid: !!payload.token };
  }

  var classified = classifyTrackerColumns_(identity.row2, identity.row3);
  var trackerRow = identity.trackerRow;
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // 'pending' (not yet reported) is a neutral, expected state here — never rendered as an
  // error or as the -1 "absent" outcome, which only markMinusOne (Q-side) ever sets.
  var todayCol = findDateColumnIndex_(classified.dayCols, today);
  var todayStatus = todayCol === -1 ? 'unavailable' : dayValueStatus_(trackerRow[todayCol]);

  // Yesterday may belong to a different month's tracker than today's (e.g. today is the 1st) —
  // resolveCheckinDayTarget_ falls back to that prior tracker rather than reporting unavailable.
  var yesterdayTarget = resolveCheckinDayTarget_(identity, f3Name, yesterday, templateSpreadsheet);
  var yesterdayAvailable = !!yesterdayTarget;
  var yesterdayStatus = yesterdayAvailable ? dayValueStatus_(yesterdayTarget.value) : null;

  var nextMonth = checkNextMonthRegistration_(identity.months, f3Name);

  // Binds sessionGuid to the canonical Tracker name (not whatever variant was typed, so a
  // corrected/re-typed name still round-trips through the saved link consistently) the first
  // time it's ever seen, or just bumps Last Used At on a returning bookmarked visit — see
  // CheckinSessions.js. Never re-mints a new guid on every identify the way the old signed
  // token did; the same guid persists for this browser/device's whole session lifetime.
  //
  // This is also the entire migration path for a pre-rollout signed token still in the wild:
  // sessionGuid IS that token string when payload.token resolved via the legacy fallback (see
  // resolveCheckinToken_dw_), so the very act of successfully using an old bookmark plants it
  // into CheckinSessions under its own token value — no separate migration pass needed. Every
  // request after this one for that same URL resolves via the session store directly, without
  // ever reaching verifyIdentityToken_dw_ again. There's nothing left to monitor before
  // retiring IdentityToken.js's verify path except confirming every still-active old bookmark
  // has been used at least once since this rollout — the nightly cleanup then prunes it like
  // any other session once it goes unused for CHECKIN_SESSION_STALE_DAYS_.
  if (sessionGuid) createOrTouchCheckinSession_dw_(templateSpreadsheet, sessionGuid, trackerRow[TRACKER_NAME_COL_], email, legacyTokenMintedAtIso);

  GasLogger.log('checkinWebapp.identify.result', {
    matched: true, f3Name: trackerRow[TRACKER_NAME_COL_], emailMismatch: identity.emailMismatch,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null, durationMs: Date.now() - t0,
  });
  return {
    ok: true,
    matched: true,
    emailMismatch: !!identity.emailMismatch,
    f3Name: trackerRow[TRACKER_NAME_COL_],
    email: email,
    team: trackerRow[TRACKER_TEAM_COL_],
    monthLabel: identity.monthInfo.label,
    goals: identity.goals,
    todayStatus: todayStatus,
    yesterdayAvailable: yesterdayAvailable,
    yesterdayStatus: yesterdayStatus,
    nextMonthLabel: nextMonth ? nextMonth.monthLabel : null,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null,
    // True exactly when this session has never been resolved before this request (a precise
    // createdAt-vs-lastUsedAt comparison, not a time-window guess — see
    // resolveCheckinToken_dw_) — the "Welcome" vs "Welcome back" heading and the "go bookmark
    // this" nudge are both driven by this one field (CheckinApp.html).
    firstUse: firstUse,
    // The same guid this request came in with (typed path: baked into the form's action URL
    // before submission; token path: the one just being re-verified) — never re-minted, unlike
    // the old signed token, so a bookmark stays valid under the same URL for as long as
    // CheckinSessions keeps its row alive. Client embeds this in the "save your check-in page"
    // link (CheckinApp.html); see CheckinSessions.js for why this replaced IdentityToken.js here.
    identityToken: sessionGuid,
  };
}

function handleCheckinSubmit_(templateSpreadsheet, payload) {
  if (payload.day !== 'today' && payload.day !== 'yesterday') {
    return { ok: false, error: 'invalid_day' };
  }
  // null means "clear this day's entry back to unrecorded" (the third check-in state,
  // distinct from 0/1) — the PAX's own explicit undo, not the same as the -1 "absent"
  // value markMinusOne sets after the grace period expires.
  if (payload.value !== 0 && payload.value !== 1 && payload.value !== null) {
    return { ok: false, error: 'invalid_value' };
  }

  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email, payload.targetMonth, payload.targetSheetId);
  if (!identity.matched) return { ok: false, error: 'not_found' };

  var targetDate = new Date();
  if (payload.day === 'yesterday') targetDate.setDate(targetDate.getDate() - 1);

  // Yesterday's edit target may live in the previous month's tracker (e.g. today is the 1st) —
  // resolveCheckinDayTarget_ falls back to that prior tracker rather than failing the write.
  var target = resolveCheckinDayTarget_(identity, payload.f3Name, targetDate, templateSpreadsheet);
  if (!target) return { ok: false, error: 'day_column_not_found' };

  var sheetRow = target.rowIndex + 4;
  var sheetCol = target.col + 1;
  var cell = target.trackerSheet.getRange(sheetRow, sheetCol);
  if (cell.getFormula()) return { ok: false, error: 'cell_is_formula' };

  if (payload.value === null) cell.clearContent(); else cell.setValue(payload.value);
  // Write-through: this PAX's own row changed, so drop just their cached copy rather than the
  // whole sheet's — the next lean identify/checkin repopulates it with one row read.
  deletePaxCacheRow_dw_('tracker', target.sheetId, payload.f3Name);
  // The dashboard/board's full-roster cache (resolveCheckinIdentityFull_) has no per-PAX
  // granularity — any single check-in invalidates the whole sheet's cached copy, same as every
  // other write-through call in this file.
  invalidateFullRosterCache_(target.sheetId);
  GasLogger.log('checkinWebapp.checkin', { f3Name: payload.f3Name, day: payload.day, value: payload.value });
  return { ok: true };
}

/**
 * Bonus Tracker section of the check-in page — bonusList/bonusAdd/bonusEdit all resolve the
 * PAX's identity against whichever month sheet corresponds to dateIso (default: real today),
 * via the same TrackerDB date-navigation resolver the dashboard's date arrows use
 * (resolveDashboardMonth_/resolveCheckinIdentityLean_), rather than the current/next/smoke
 * enum resolveCheckinIdentity_ uses — the client trusts a client-supplied name here either way,
 * so identity is always re-derived server-side. Writes always use the canonical Tracker name
 * (identity.trackerRow), not whatever variant the client sent, so Bonus Tracker rows always
 * "match Tracker exactly" per the sheet's own rule.
 * @param {string=} dateIso "YYYY-MM-DD" identifying which month's sheet to resolve against —
 *   handleBonusList_ passes the dashboard's viewed context day (payload.dateISO) so the bonus
 *   list matches whatever month the PAX is looking at; handleBonusAdd_/handleBonusEdit_ pass
 *   the bonus entry's own date (payload.whenIso) so a save always lands in the month sheet that
 *   date actually belongs to, regardless of which month the dashboard happens to be viewing.
 */
function resolveBonusSheet_(templateSpreadsheet, payload, dateIso) {
  var targetDate = dateIso ? parseIsoDateLocal_(dateIso) : new Date();
  if (isNaN(targetDate.getTime())) targetDate = new Date();
  // Resolve the month against the ns-scoped template (templateSpreadsheet), not the bound
  // deployment — otherwise date-based dispatch reads the wrong TrackerDB and the PAX is
  // never found in a namespace tracker (F3Go30-4j4o.1). monthInfo.sheetId then carries the
  // correct namespace tracker id downstream, so identity/write steps need no ns awareness.
  var monthInfo = resolveDashboardMonth_(targetDate, templateSpreadsheet);
  if (!monthInfo) return { error: 'not_found' };
  var identity = resolveCheckinIdentityLean_(monthInfo, payload.f3Name, payload.email, null);
  if (!identity.matched) return { error: 'not_found' };
  var bonusSheet = identity.targetSs.getSheetByName('Bonus Tracker');
  if (!bonusSheet) return { error: 'bonus_sheet_not_found' };
  return { bonusSheet: bonusSheet, canonicalName: identity.trackerRow[TRACKER_NAME_COL_], monthStart: monthInfo.startDate };
}

function handleBonusList_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload, payload.dateISO);
  if (resolved.error) return { ok: false, error: resolved.error };
  var entries = listBonusEntriesForPax_dw_(resolved.bonusSheet, resolved.canonicalName, resolved.bonusSheet.getParent().getId());
  return {
    ok: true,
    entries: annotateBonusEntryCountStatus_dw_(entries, resolved.monthStart),
    bonusTypes: bonusTypeClientRules_dw_(),
  };
}

function handleBonusAdd_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload, payload.whenIso);
  if (resolved.error) return { ok: false, error: resolved.error };
  var result = addBonusEntry_dw_(resolved.bonusSheet, resolved.canonicalName, payload);
  if (result.ok) GasLogger.log('checkinWebapp.bonusAdd', { f3Name: resolved.canonicalName, type: payload.type });
  return result;
}

/**
 * Cheap month lookup only (TrackerDB row scan on the already-open bound spreadsheet) — no
 * SpreadsheetApp.openById of the target month's own tracker spreadsheet, no Responses/Tracker
 * identity matching. Used by handleBonusEdit_ to decide whether a cross-month move is even
 * happening *before* paying for the expensive per-month identity resolution twice.
 * @returns {{sheetId:string}|null}
 */
function resolveBonusMonthOnly_(dateIso, templateSpreadsheet) {
  var targetDate = dateIso ? parseIsoDateLocal_(dateIso) : new Date();
  if (isNaN(targetDate.getTime())) targetDate = new Date();
  // Same ns-scoping as resolveBonusSheet_: the cross-month detection must consult the
  // namespace's TrackerDB or a cross-month edit under a namespace mis-detects (F3Go30-4j4o.2).
  return resolveDashboardMonth_(targetDate, templateSpreadsheet);
}

/**
 * Edits an existing Bonus Tracker entry. payload.rowIndex is only ever a *hint* — the actual row
 * is relocated by matching payload.original (the entry's pre-edit Name+Type+When+What+Link, as
 * last seen in the bonusList response) against sheet content, inside findBonusRowByIdentity_'s
 * lock. A bare row number can't be trusted to still identify the same entry by save time: besides
 * concurrent app writes, a human could have manually sorted the Bonus Tracker sheet in between —
 * see F3Go30 bonus "that entry no longer belongs to you" investigation.
 *
 * If the edited whenIso moves the entry into a different month's sheet (payload.originalWhenIso,
 * the pre-edit date, resolves to a different sheet than the new whenIso), that also means the row
 * has to be relocated in a *different* sheet than the one being written to: append a fresh row in
 * the new sheet first, then clear the old one — added-before-cleared so a failure partway through
 * leaves a recoverable duplicate rather than silently losing the entry.
 *
 * Perf note: resolveBonusSheet_'s identity resolution (SpreadsheetApp.openById + Responses/
 * Tracker matching) is the expensive part of this whole request — cheaply check via
 * resolveBonusMonthOnly_ (TrackerDB-only, no remote spreadsheet open) whether this edit is even
 * cross-month before paying for that resolution twice. The overwhelming majority of edits don't
 * change the month, so this keeps a same-month edit down to the one resolution it always needed.
 */
function handleBonusEdit_(templateSpreadsheet, payload) {
  var newMonth = resolveBonusMonthOnly_(payload.whenIso, templateSpreadsheet);
  if (!newMonth) return { ok: false, error: 'not_found' };

  var originalWhenIso = payload.originalWhenIso || payload.whenIso;
  var originalMonth = resolveBonusMonthOnly_(originalWhenIso, templateSpreadsheet);
  if (!originalMonth) return { ok: false, error: 'not_found' };

  var originalSnapshot = payload.original || null;

  if (originalMonth.sheetId !== newMonth.sheetId) {
    var resolved = resolveBonusSheet_(templateSpreadsheet, payload, payload.whenIso);
    if (resolved.error) return { ok: false, error: resolved.error };
    var original = resolveBonusSheet_(templateSpreadsheet, payload, originalWhenIso);
    if (original.error) return { ok: false, error: original.error };

    var located = findBonusRowByIdentity_dw_(original.bonusSheet, original.canonicalName, originalSnapshot, payload.rowIndex);
    if (!located) return { ok: false, error: 'not_found' };

    var addResult = addBonusEntry_dw_(resolved.bonusSheet, resolved.canonicalName, payload);
    if (!addResult.ok) return addResult;

    var clearResult = clearBonusEntry_dw_(original.bonusSheet, original.canonicalName, located, originalSnapshot);
    if (!clearResult.ok) {
      GasLogger.log('checkinWebapp.bonusEdit.clearFailed', {
        f3Name: resolved.canonicalName, oldRowIndex: located, newRowIndex: addResult.rowIndex, error: clearResult.error,
      });
    }
    GasLogger.log('checkinWebapp.bonusEdit', {
      f3Name: resolved.canonicalName, rowIndex: addResult.rowIndex, movedMonths: true,
    });
    return addResult;
  }

  // Same month: exactly one identity resolution, same as before the cross-month fix existed.
  var resolvedSame = resolveBonusSheet_(templateSpreadsheet, payload, payload.whenIso);
  if (resolvedSame.error) return { ok: false, error: resolvedSame.error };

  var result = editBonusEntry_dw_(resolvedSame.bonusSheet, resolvedSame.canonicalName, payload.rowIndex, payload, originalSnapshot);
  if (result.ok) GasLogger.log('checkinWebapp.bonusEdit', { f3Name: resolvedSame.canonicalName, rowIndex: result.rowIndex });
  return result;
}

// Averaging period (the N in the trailing N-day mean) — not the same thing as how many days of
// that averaged trend the client displays at once (CheckinApp.html's DISPLAY_WINDOW_DAYS_).
// 7 days matches Go30's natural weekly cadence (most PAX have a weekday-AO/weekend-gap
// pattern) — responsive enough to show a real trend shift within days, without being so short
// a single missed day swings it, and without being so long (14, 30) that it's still "warming
// up" for most of a program that only runs ~30 days.
var ROLLING_AVERAGE_WINDOW_DAYS_ = 7;

var MAX_STREAK_WINDOW_DAYS_ = 30;

// Mirrors CheckinApp.html's DISPLAY_WINDOW_DAYS_ (kept in sync manually — client-only display
// concern, not worth threading through a shared config just for one constant) — how many
// trailing days getPriorMonthTailValues_ needs to hand back so the rolling-average *chart*
// (bars + line), not just the averaged value, can pad its display window across a month
// boundary the same way the average itself already does.
var DASHBOARD_DISPLAY_WINDOW_DAYS_ = 14;

function buildDashboardPaxRow_(name, team, score, rawScore, streak, dayValues, totalDays, currentDay, bonusByType) {
  return {
    name: name,
    team: team,
    score: score,
    rawScore: rawScore,
    streak: streak,
    maxStreak30: computeMaxStreak_(dayValues, MAX_STREAK_WINDOW_DAYS_),
    scorePct: currentDay ? Math.round((score / currentDay) * 100) : (score >= 0 ? 100 : 0),
    dayValues: dayValues,
    daySegments: buildDaySegments_(dayValues, totalDays),
    rollingAverage: buildRollingAverage_(dayValues, ROLLING_AVERAGE_WINDOW_DAYS_),
    // F3Go30-y55y: per-PAX, same as score/streak — every board tile gets its own bonus totals,
    // not just the logged-in PAX's own stat area. Callers pass the date-scoped/capped result of
    // computeBonusPillsAsOf_, not a raw Tracker column read; the all-zero default below covers
    // a caller that omits this (e.g. a row with no Bonus Tracker entries at all).
    bonusByType: bonusByType || emptyBonusPills_dw_(),
  };
}

function _dashboardIsoDate_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Parses a "YYYY-MM-DD" string as a local-midnight Date, matching the client's parseIsoDate_
 * (CheckinApp.html). The native `new Date("YYYY-MM-DD")` constructor parses date-only strings
 * as UTC midnight, which shifts to the previous calendar day once compared/rendered in any
 * timezone behind UTC — breaking sameCalendarDate_ against Tracker day columns (local-midnight
 * Date objects from getValues()) and defeating the "default to today in the PAX's local
 * timezone" behavior the dateISO param exists for.
 */
function parseIsoDateLocal_(iso) {
  var parts = String(iso).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Builds the dashboard payload for whatever month payload.dateISO falls in (default: today),
 * resolved via TrackerDB (resolveDashboardMonth_) rather than being locked to the current
 * month — this is what backs the date-navigation arrows, including stepping into prior
 * months. Every array in the response spans the *entire* month through real "today" (not
 * just up to the viewed date) so the client can cache one payload per month and scrub
 * between days locally — see viewDayIndex — without a server round trip per day.
 */
function handleCheckinDashboard_(templateSpreadsheet, payload) {
  var t0 = Date.now();
  var realToday = new Date();
  var viewDate = payload.dateISO ? parseIsoDateLocal_(payload.dateISO) : new Date(realToday);
  if (isNaN(viewDate.getTime())) viewDate = new Date(realToday);

  var t1 = Date.now();
  var monthInfo = resolveDashboardMonth_(viewDate, templateSpreadsheet);
  var resolveMonthMs = Date.now() - t1;
  if (!monthInfo) return { ok: false, error: 'no_tracker_for_date' };

  var t2 = Date.now();
  var identity = resolveCheckinIdentityFull_(monthInfo, payload.f3Name, payload.email, null);
  var resolveIdentityMs = Date.now() - t2;
  if (!identity.matched) {
    // Distinct from the no_tracker_for_date miss above: a tracker exists for this date, but the
    // viewing PAX has no row in it (e.g. date-nav back into a month they weren't registered in —
    // F3Go30-awhw). The success path logs checkinWebapp.dashboard at the end; without this the
    // failure leaves zero Axiom trace. Warn with enough context (identity, resolved month) to
    // diagnose. Graceful degradation of this case is tracked in F3Go30-csfe.
    GasLogger.log('checkinWebapp.dashboard.identityMiss', {
      f3Name: payload.f3Name, monthLabel: monthInfo.label,
      monthKey: _dashboardIsoDate_(monthInfo.startDate).slice(0, 7),
    });
    return { ok: false, error: 'not_found' };
  }

  var classified = classifyTrackerColumns_(identity.row2, identity.row3);

  // Normally realToday (the script's own clock) is the cutoff. If the PAX's local calendar
  // date is already past that (their timezone is ahead of the script's, or a run near
  // midnight straddles the boundary), extend the cutoff to viewDate so "today" as they see it
  // is included rather than silently falling back to yesterday's already-reported day.
  var reportedCutoff = viewDate > realToday ? viewDate : realToday;
  var reportedDayCols = classified.dayCols.filter(function(d) { return d.date <= reportedCutoff; });
  var totalDays = classified.dayCols.length;
  var currentDay = reportedDayCols.length;
  var dayDates = reportedDayCols.map(function(d) { return _dashboardIsoDate_(d.date); });

  var viewDayIndex = -1;
  for (var i = 0; i < reportedDayCols.length; i++) {
    if (sameCalendarDate_(reportedDayCols[i].date, viewDate)) { viewDayIndex = i; break; }
  }
  // Requested date is beyond what's been reported yet (e.g. a future date, or "today" itself
  // clamped past the last reported column) — fall back to showing the latest reported day.
  if (viewDayIndex === -1) viewDayIndex = currentDay - 1;

  // Date-scoped, weekly-capped bonus pills (F3Go30-y55y follow-up) — read once per tracker
  // spreadsheet (cached; see getAllBonusEntriesCached_) rather than the Tracker's own C-F
  // per-type columns, which are neither date-scoped nor capped at 1/period the way the pills
  // need to be. Bonus Tracker missing entirely (a very old tracker copy) degrades to all-zero
  // pills rather than failing the whole dashboard load.
  var bonusSheet = identity.targetSs.getSheetByName('Bonus Tracker');
  var bonusEntries = bonusSheet ? getAllBonusEntriesCached_dw_(bonusSheet, monthInfo.sheetId) : [];
  var reportedDayDates = reportedDayCols.map(function(d) { return d.date; });

  var allPaxRows = [];
  var userRow = null;
  identity.trackerValues.forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    if (!String(name || '').trim()) return;
    var dayValues = reportedDayCols.map(function(d) { return row[d.col]; });
    var bonusSeries = computeBonusSeriesForPax_dw_(bonusEntries, paxCacheNormalizeName_dw_(name), reportedDayDates, monthInfo.startDate);
    var paxRow = buildDashboardPaxRow_(
      name,
      row[TRACKER_TEAM_COL_],
      row[TRACKER_SCORE_COL_],
      row[TRACKER_RAW_SCORE_COL_],
      computeStreak_(dayValues),
      dayValues,
      totalDays,
      currentDay,
      bonusSeries[bonusSeries.length - 1]
    );
    paxRow.bonusByTypeSeries = bonusSeries;
    allPaxRows.push(paxRow);
    if (idx === identity.rowIndex) userRow = paxRow;
  });

  var userDayValues = reportedDayCols.map(function(d) { return identity.trackerValues[identity.rowIndex][d.col]; });
  var outcomes = countOutcomes_(userDayValues);
  var bonusByType = userRow.bonusByType;
  var userBonusByTypeSeries = userRow.bonusByTypeSeries;

  // Early-month days would otherwise show an artificially short rolling-average window (e.g.
  // day 2 of July only has 2 days to average) — reach into the previous month's tracker so the
  // window is always a true ROLLING_AVERAGE_WINDOW_DAYS_ trailing mean. Fetched at the largest
  // of the three window sizes so the same tail also covers the chart's display-window padding
  // (see priorMonthDayValues below) and the 30-day max-streak lookback below —
  // getPriorMonthTailValues_ trims to whatever each caller actually needs.
  var priorMonthTail = getPriorMonthTailValues_(
    monthInfo, payload.f3Name,
    Math.max(ROLLING_AVERAGE_WINDOW_DAYS_, DASHBOARD_DISPLAY_WINDOW_DAYS_, MAX_STREAK_WINDOW_DAYS_),
    templateSpreadsheet
  );
  var userRollingAverage = buildRollingAverageWithLookback_(userDayValues, ROLLING_AVERAGE_WINDOW_DAYS_, priorMonthTail);

  // Same month-boundary problem as the rolling average above, applied to streak: buildDashboard
  // PaxRow_'s streak/maxStreak30 (used for every other board row) only sees this month's own
  // dayValues, so early in a month a real streak that started last month reads as artificially
  // short (or a real 30-day-best gets capped at however few days have elapsed so far this
  // month). Recompute both for the identified PAX specifically using the same prior-month tail,
  // overriding userRow's current-month-only figures. Both figures are windowed to the same
  // trailing MAX_STREAK_WINDOW_DAYS_ days — "current streak" is not an unbounded look-back, it's
  // the run within that same 30-day window, exactly like "best in 30 days" is.
  var userValuesWithLookback = priorMonthTail.concat(userDayValues);
  var userValuesTrimmed = userValuesWithLookback.slice();
  while (userValuesTrimmed.length && userValuesTrimmed[userValuesTrimmed.length - 1] === '') userValuesTrimmed.pop();
  var userValuesWindowed = userValuesTrimmed.slice(-MAX_STREAK_WINDOW_DAYS_);
  var userStreak = computeStreak_(userValuesWindowed);
  var userMaxStreak30 = computeMaxStreak_(userValuesWindowed, MAX_STREAK_WINDOW_DAYS_);

  var userTeam = String(identity.trackerValues[identity.rowIndex][TRACKER_TEAM_COL_] || '').trim().toLowerCase();
  var myTeamMembers = allPaxRows.filter(function(r) { return String(r.team || '').trim().toLowerCase() === userTeam; })
    .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

  var paxBoard = groupByTeam_(allPaxRows);

  GasLogger.log('checkinWebapp.dashboard', {
    f3Name: payload.f3Name, currentDay: currentDay, totalDays: totalDays, viewDayIndex: viewDayIndex,
    paxRows: allPaxRows.length, resolveMonthMs: resolveMonthMs, resolveIdentityMs: resolveIdentityMs,
    totalMs: Date.now() - t0,
  });

  return {
    ok: true,
    f3Name: userRow.name,
    team: userRow.team,
    monthLabel: monthInfo.label,
    monthKey: _dashboardIsoDate_(monthInfo.startDate).slice(0, 7),
    trackerUrl: monthInfo.trackerUrl,
    currentDay: currentDay,
    totalDays: totalDays,
    dayDates: dayDates,
    viewDayIndex: viewDayIndex,
    viewDate: dayDates[viewDayIndex] || null,
    streak: userStreak,
    maxStreak30: userMaxStreak30,
    score: userRow.score,
    rawScore: userRow.rawScore,
    scorePct: userRow.scorePct,
    dayValues: userDayValues,
    daySegments: userRow.daySegments,
    rollingAverage: userRollingAverage,
    // Trailing raw values (0/1/-1) from the end of the previous month's tracker, up to
    // DASHBOARD_DISPLAY_WINDOW_DAYS_-1 of them — lets the client pad the rolling-average
    // chart's display window across a month boundary the same way userRollingAverage's own
    // averaging already does, instead of showing a sparse few-point chart on early-month days.
    priorMonthDayValues: priorMonthTail,
    done: outcomes.done,
    missed: outcomes.missed,
    absent: outcomes.absent,
    bonusByType: bonusByType,
    // One bonusByType per reported day, aligned with dayDates — lets the client scrub the
    // date-nav arrows and show pills accurate to that day (F3Go30-y55y follow-up) instead of
    // always showing today's month-to-date totals.
    bonusByTypeSeries: userBonusByTypeSeries,
    myTeam: myTeamMembers,
    paxBoard: paxBoard,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    classifyTrackerColumns_: classifyTrackerColumns_,
    findDateColumnIndex_: findDateColumnIndex_,
    findTrackerRowIndexByName_: findTrackerRowIndexByName_,
    computeStreak_: computeStreak_,
    computeMaxStreak_: computeMaxStreak_,
    countOutcomes_: countOutcomes_,
    needsYesterdayCheckin_: needsYesterdayCheckin_,
    dayValueStatus_: dayValueStatus_,
    groupByTeam_: groupByTeam_,
    buildDashboardPaxRow_: buildDashboardPaxRow_,
    buildDaySegments_: buildDaySegments_,
    buildRollingAverage_: buildRollingAverage_,
    buildRollingAverageWithLookback_: buildRollingAverageWithLookback_,
    resolveCheckinDayTarget_: resolveCheckinDayTarget_,
    getCachedTrackerLayoutOnly_: getCachedTrackerLayoutOnly_,
    trackerLayoutCacheKey_: trackerLayoutCacheKey_,
    serializeRow3ForCache_: serializeRow3ForCache_,
    serializeSheetValuesForCache_: serializeSheetValuesForCache_,
    deserializeSheetValuesFromCache_: deserializeSheetValuesFromCache_,
    getCachedSheetValuesOnly_: getCachedSheetValuesOnly_,
    setCachedSheetValues_: setCachedSheetValues_,
    trackerValuesCacheKey_: trackerValuesCacheKey_,
    responsesValuesCacheKey_: responsesValuesCacheKey_,
    invalidateFullRosterCache_: invalidateFullRosterCache_,
    handleCheckinIdentify_: handleCheckinIdentify_,
    checkNextMonthRegistration_: checkNextMonthRegistration_,
    buildCheckinPageOutput_: buildCheckinPageOutput_,
    renderCheckinPage_: renderCheckinPage_,
    renderCheckinPageForTypedIdentify_: renderCheckinPageForTypedIdentify_,
  };
}
