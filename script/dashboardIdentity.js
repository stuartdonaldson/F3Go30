/*
 * dashboardIdentity.js
 *
 * The dashboard's identity-resolution engine, extracted out of dashboardWebapp.js
 * (REVIEW-260910's split-identity finding — see docs/staging/review-260910.md). This is the
 * largest self-contained block dashboardWebapp.js carried: every resolveCheckinIdentity_/
 * resolveLeanIdentityFromHandle_/resolveFullIdentityFromHandle_ path, the month-navigation and
 * next-month-registration helpers that ride alongside identity resolution, the announcement
 * splash resolver, and checkinClientConfig_dw_ (the site-config payload attached to every
 * identify response). Pure structural move — no behaviour change; this file's contents are the
 * original dashboardWebapp.js block verbatim. dashboardWebapp.js requires this module and
 * re-exposes the same symbol names, so its own call sites, module.exports, and every existing
 * test stay unchanged (mirrors the split-cache stage's dashboardCache.js pattern).
 *
 * A handful of pure Tracker-column/date helpers this block depends on (classifyTrackerColumns_,
 * findDateColumnIndex_, TRACKER_NAME_COL_, trackerRowBelongsToPax_dw_, purgeStaleTrackerBind_dw_,
 * paxCacheStatsForLog_dw_, paxHistoryScopeId_dw_, _dashboardIsoDate_, parseIsoDateLocal_) stay
 * behind in dashboardWebapp.js's "Pure functions" section, unmoved — they're also used broadly by
 * code that stays there (bonus/dashboard/month-grid handlers), so splitting them out would only
 * fragment that section. Requiring dashboardWebapp.js back from here for them would be a true
 * circular require (dashboardWebapp.js already requires this file), which under Node returns an
 * empty partial exports object before this file's own module.exports is assigned — see the
 * Node/test bridge block below, which is the deliberate, minimal fix: dashboardWebapp.js
 * publishes those few symbols to globalThis (a no-op under the real GAS runtime, where they're
 * already global) before requiring this file, and this file reads them straight off globalThis
 * (rather than via gasRequire_/require('./dashboardWebapp.js'), which would re-trigger the same
 * circular require and a harmless-but-noisy Node warning for no benefit).
 */

var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;

var dashboardIdentitySignupModule_ = gasRequire_('./signupWebapp.js', ['getCurrentAndNextMonths_', 'selectTargetMonth_', 'findSignupMatchByF3NameOnly_']);
var getCurrentAndNextMonths_dw_ = dashboardIdentitySignupModule_.getCurrentAndNextMonths_;
var selectTargetMonth_dw_ = dashboardIdentitySignupModule_.selectTargetMonth_;
var findSignupMatchByF3NameOnly_dw_ = dashboardIdentitySignupModule_.findSignupMatchByF3NameOnly_;

var dashboardIdentityUtilitiesModule_ = gasRequire_('./Utilities.js', ['getConfigValue_']);
var getConfigValue_dw_ = dashboardIdentityUtilitiesModule_.getConfigValue_;

var dashboardIdentityResponseUtilsModule_ = gasRequire_('./response_utils.js', ['resolveResponseColumns', 'getResponseEmailValue_']);
var resolveResponseColumns_dw_ = dashboardIdentityResponseUtilsModule_.resolveResponseColumns;
var getResponseEmailValue_dw_ = dashboardIdentityResponseUtilsModule_.getResponseEmailValue_;

var dashboardIdentityPaxCacheModule_ = gasRequire_('./PaxCache.js', [
  'getPaxCacheRow_', 'getPaxCacheRowsBulk_', 'setPaxCacheRow_', 'setPaxCacheRowsBulk_',
  'resolvePaxRowIndex_', 'getPaxRosterIndex_', 'paxCacheNormalizeName_', 'paxHistoryEncodeValue_',
  'setPaxHistoryEntriesBulk_', 'PAX_HISTORY_BACKFILL_DAYS_',
]);
var getPaxCacheRow_dw_ = dashboardIdentityPaxCacheModule_.getPaxCacheRow_;
var getPaxCacheRowsBulk_dw_ = dashboardIdentityPaxCacheModule_.getPaxCacheRowsBulk_;
var setPaxCacheRow_dw_ = dashboardIdentityPaxCacheModule_.setPaxCacheRow_;
var setPaxCacheRowsBulk_dw_ = dashboardIdentityPaxCacheModule_.setPaxCacheRowsBulk_;
var resolvePaxRowIndex_dw_ = dashboardIdentityPaxCacheModule_.resolvePaxRowIndex_;
var getPaxRosterIndex_dw_ = dashboardIdentityPaxCacheModule_.getPaxRosterIndex_;
var paxCacheNormalizeName_dw_ = dashboardIdentityPaxCacheModule_.paxCacheNormalizeName_;
var paxHistoryEncodeValue_dw_ = dashboardIdentityPaxCacheModule_.paxHistoryEncodeValue_;
var setPaxHistoryEntriesBulk_dw_ = dashboardIdentityPaxCacheModule_.setPaxHistoryEntriesBulk_;
var PAX_HISTORY_BACKFILL_DAYS_dw_ = dashboardIdentityPaxCacheModule_.PAX_HISTORY_BACKFILL_DAYS_;

var dashboardIdentityGo30ToolsModule_ = gasRequire_('./go30tools.js', [
  '_readTrackerDbRowsBySheetId_', '_readPaxDbRowsBySheetId_',
  'getCachedTrackerDbAvailableMonths_', 'setCachedTrackerDbAvailableMonths_',
]);
var readTrackerDbRowsBySheetId_dw_ = dashboardIdentityGo30ToolsModule_._readTrackerDbRowsBySheetId_;
var readPaxDbRowsBySheetId_dw_ = dashboardIdentityGo30ToolsModule_._readPaxDbRowsBySheetId_;
var getCachedTrackerDbAvailableMonths_dw_ = dashboardIdentityGo30ToolsModule_.getCachedTrackerDbAvailableMonths_;
var setCachedTrackerDbAvailableMonths_dw_ = dashboardIdentityGo30ToolsModule_.setCachedTrackerDbAvailableMonths_;

var dashboardIdentityAddResponseModule_ = gasRequire_('./addResponseOnSubmit.js', ['formatRegistrationMonth_']);
var formatRegistrationMonth_dw_ = dashboardIdentityAddResponseModule_.formatRegistrationMonth_;

var dashboardIdentityIdentityTokenModule_ = gasRequire_('./IdentityToken.js', ['verifyIdentityToken_']);
// mintIdentityToken_dw_ is gone — checkin bookmark links are GUID sessions now (CheckinSessions.js);
// verifyIdentityToken_dw_ stays only as resolveCheckinToken_dw_'s fallback for tokens minted
// before that rollout (see its docstring for the retirement plan).
var verifyIdentityToken_dw_ = dashboardIdentityIdentityTokenModule_.verifyIdentityToken_;

var dashboardIdentityCheckinSessionsModule_ = gasRequire_('./CheckinSessions.js', ['resolveCheckinSession_']);
var resolveCheckinSession_dw_ = dashboardIdentityCheckinSessionsModule_.resolveCheckinSession_;

var dashboardIdentityBonusTypesModule_ = gasRequire_('./BonusTypes.js', ['bonusTypeClientRules_', 'bonusTypeDisplayList_']);
var bonusTypeClientRules_dw_ = dashboardIdentityBonusTypesModule_.bonusTypeClientRules_;
var bonusTypeDisplayList_dw_ = dashboardIdentityBonusTypesModule_.bonusTypeDisplayList_;

// F3Go30-mk3a: the CacheService cache layer lives in dashboardCache.js (split-cache stage) — same
// require dashboardWebapp.js makes for its own use of these.
var dashboardIdentityCacheModule_ = gasRequire_('./dashboardCache.js', [
  'makeLazySpreadsheet_dw_', 'responsesLayoutCacheKey_', 'getCachedResponsesLayoutOnly_',
  'getResponsesLayout_', 'getCachedTrackerLayoutOnly_', 'getTrackerLayout_',
  'trackerValuesCacheKey_', 'responsesValuesCacheKey_', 'getCachedSheetValuesOnly_',
  'setCachedSheetValues_',
]);
var makeLazySpreadsheet_dw_ = dashboardIdentityCacheModule_.makeLazySpreadsheet_dw_;
var getCachedResponsesLayoutOnly_ = dashboardIdentityCacheModule_.getCachedResponsesLayoutOnly_;
var getResponsesLayout_ = dashboardIdentityCacheModule_.getResponsesLayout_;
var getCachedTrackerLayoutOnly_ = dashboardIdentityCacheModule_.getCachedTrackerLayoutOnly_;
var getTrackerLayout_ = dashboardIdentityCacheModule_.getTrackerLayout_;
var responsesValuesCacheKey_ = dashboardIdentityCacheModule_.responsesValuesCacheKey_;
var getCachedSheetValuesOnly_ = dashboardIdentityCacheModule_.getCachedSheetValuesOnly_;
var setCachedSheetValues_ = dashboardIdentityCacheModule_.setCachedSheetValues_;

// Node/test bridge only (see file header) — under the GAS runtime `module` is undefined and these
// are already true globals, so this reads exactly the same either way. dashboardWebapp.js
// publishes them to globalThis right before requiring this file (a true circular require can't
// return them via module.exports yet at this point). Read straight off globalThis rather than via
// gasRequire_/require('./dashboardWebapp.js') here specifically: that file is already mid-load on
// the caller's stack, and Node logs a (harmless, since the globalThis fallback below never
// actually needs it) "accessing property of module exports inside circular dependency" warning
// for every such access — this sidesteps that entirely rather than suppressing it.
var classifyTrackerColumns_ = globalThis.classifyTrackerColumns_;
var findDateColumnIndex_ = globalThis.findDateColumnIndex_;
var TRACKER_NAME_COL_ = globalThis.TRACKER_NAME_COL_;
var trackerRowBelongsToPax_dw_ = globalThis.trackerRowBelongsToPax_dw_;
var purgeStaleTrackerBind_dw_ = globalThis.purgeStaleTrackerBind_dw_;
var paxCacheStatsForLog_dw_ = globalThis.paxCacheStatsForLog_dw_;
var paxHistoryScopeId_dw_ = globalThis.paxHistoryScopeId_dw_;
var _dashboardIsoDate_ = globalThis._dashboardIsoDate_;
var parseIsoDateLocal_ = globalThis.parseIsoDateLocal_;

/**
 * Assembles the whole Tracker roster (in row-index order) from PaxCache's per-PAX rows via its
 * roster index (F3Go30-5nfj.3), instead of a whole-sheet CacheService blob — a single check-in
 * write-through patch (handleCheckinSubmit_) then keeps every OTHER pax's cached row untouched
 * and correct, so this assembly stays a cache hit across writes rather than being invalidated
 * wholesale. Returns null on any incompleteness (no roster index cached, or any indexed pax
 * missing its own row) so the caller falls back to its existing live Sheet range read + bulk
 * repopulate — same backstop pattern PaxCache already uses elsewhere.
 *
 * Reads via getPaxCacheRowsBulk_'s single getProperties() call rather than one getProperty() per
 * PAX (F3Go30 perf finding, 2026-07: measured ~13x faster for a ~24-PAX roster — per-call RPC
 * overhead dominates over payload size, so batching the reads wins even though it fetches the
 * whole shared PropertiesService store). Write-through stays untouched — still one setProperty
 * per PAX's own key (setPaxCacheRow_dw_/handleCheckinSubmit_) — so concurrent check-ins from
 * different PAX never contend on a shared key/lock the way a single combined blob would.
 * @returns {Array<Array>|null}
 */
function buildTrackerValuesFromPaxCache_(sheetId) {
  if (!getPaxRosterIndex_dw_ || !getPaxCacheRowsBulk_dw_) return null;
  var rosterIndex = getPaxRosterIndex_dw_('tracker', sheetId);
  if (!rosterIndex) return null;
  var names = Object.keys(rosterIndex);
  if (!names.length) return null;

  var maxIndex = -1;
  for (var i = 0; i < names.length; i++) {
    if (rosterIndex[names[i]] > maxIndex) maxIndex = rosterIndex[names[i]];
  }
  var rowsByName = getPaxCacheRowsBulk_dw_('tracker', sheetId, names);
  var values = new Array(maxIndex + 1);
  for (var j = 0; j < names.length; j++) {
    var row = rowsByName[names[j]];
    if (!row) return null; // incomplete cache — caller falls back to a live read
    values[rosterIndex[names[j]]] = row;
  }
  return values;
}

/**
 * Lean identity resolution for identify/checkin-submit/bonus — actions that only ever need one
 * PAX's own data, not the whole roster (contrast resolveCheckinIdentityFull_, used by the
 * dashboard's team/board view). Matches Responses by F3 Name alone (findSignupMatchByF3NameOnly_
 * — see file header on why email isn't a hard gate) via PaxCache's roster index, so a repeat
 * lookup for the same PAX resolves via a single-row read (or a cache hit) instead of scanning
 * every PAX's row. Never caches a name that isn't found (see PaxCache.js). The Responses match
 * itself (existence check) is load-bearing for every caller — it's the server-side re-derivation
 * of identity a client-supplied name can't be trusted to skip (see resolveBonusSheet_'s header) —
 * so it always runs; only the goals/email extraction below it is conditional.
 * Lazy about SpreadsheetApp.openById() (F3Go30-440b.6): on a full cache hit — Responses layout,
 * Tracker layout, roster index, and per-PAX row all already warm — the spreadsheet is never
 * opened at all. targetSs in the returned object is the lazy wrapper (call .get() to force an
 * open), not a raw Spreadsheet, so a caller that never touches it (identify) never pays for one.
 * @param {boolean=} needGoals Default true. identify is the only caller that surfaces
 *   goals (WHO/WHAT/HOW) or emailMismatch to the client — checkin-submit's fallback path and
 *   bonus (resolveBonusSheet_) use neither (F3Go30-o39s.9 audit, F9), so passing false skips the
 *   per-PAX Responses row fetch + WHO/WHAT/HOW/EMAIL extraction entirely once the Responses match
 *   itself has confirmed `matched`.
 * @returns {{matched:boolean, emailMismatch?:boolean, months:Object, monthInfo:Object,
 *   targetSs:Object, row2:Array, row3:Array, trackerRow:Array, trackerRowIndex:number}}
 */
function resolveCheckinIdentityLean_(monthInfo, f3Name, email, months, needGoals) {
  if (needGoals === undefined) needGoals = true;
  var t0 = Date.now();
  var lazySs = makeLazySpreadsheet_dw_(monthInfo.sheetId);

  var t1 = Date.now();
  var responsesLayout = getCachedResponsesLayoutOnly_(monthInfo.sheetId);
  var responsesSheet = null;
  function responsesSheet_() {
    if (!responsesSheet) responsesSheet = lazySs.get().getSheetByName('Responses');
    return responsesSheet;
  }
  if (!responsesLayout) {
    var rs = responsesSheet_();
    if (!rs) return { matched: false, months: months };
    responsesLayout = getResponsesLayout_(rs, monthInfo.sheetId);
  }
  var columns = responsesLayout.columns;

  var responsesRowIndex = resolvePaxRowIndex_dw_('responses', monthInfo.sheetId, f3Name, function() {
    var rs = responsesSheet_();
    if (!rs) return [];
    var lastRow = rs.getLastRow();
    if (lastRow < 2) return [];
    var rows = rs.getRange(2, 1, lastRow - 1, rs.getLastColumn()).getValues();
    // DELETED rows (ADR-008 email-change convention) must never win a name match — blank out
    // their name here so PaxCache's roster-index builder skips them, same as
    // findSignupMatchByF3NameOnly_'s live scan does.
    return rows.map(function(row) {
      return String(row[columns.PARTICIPATION] || '').trim().toLowerCase() === 'deleted' ? '' : row[columns.F3_NAME];
    });
  });
  if (responsesRowIndex === -1) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: false, lean: true, openMs: lazySs.getOpenMs(), totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
    return { matched: false, months: months };
  }

  // The per-PAX Responses row itself (as opposed to the match above, which only proves
  // existence) backs nothing but goals (WHO/WHAT/HOW) and the registered-email mismatch check —
  // skip fetching/caching it for a caller that surfaces neither (F3Go30-o39s.9 audit, F9).
  var responsesRow = null;
  if (needGoals) {
    responsesRow = getPaxCacheRow_dw_('responses', monthInfo.sheetId, f3Name);
    if (!responsesRow) {
      var rs2 = responsesSheet_();
      responsesRow = rs2.getRange(responsesRowIndex + 2, 1, 1, rs2.getLastColumn()).getValues()[0];
      setPaxCacheRow_dw_('responses', monthInfo.sheetId, f3Name, responsesRow);
    }
  }
  var responsesMs = Date.now() - t1;

  var emailMismatch;
  if (needGoals) {
    var registeredEmail = String(
      responsesLayout.headers && typeof getResponseEmailValue_dw_ === 'function'
        ? getResponseEmailValue_dw_(responsesRow, columns, responsesLayout.headers)
        : responsesRow[columns.EMAIL]
    ).trim().toLowerCase();
    emailMismatch = registeredEmail !== String(email || '').trim().toLowerCase();
  }

  var t2 = Date.now();
  var trackerLayout = getCachedTrackerLayoutOnly_(monthInfo.sheetId);
  var trackerSheet = null;
  function trackerSheet_() {
    if (!trackerSheet) trackerSheet = lazySs.get().getSheetByName('Tracker');
    return trackerSheet;
  }
  if (!trackerLayout) {
    var ts = trackerSheet_();
    if (!ts || ts.getLastRow() < 4) return { matched: false, months: months };
    trackerLayout = getTrackerLayout_(ts, monthInfo.sheetId);
  }
  function readTrackerNameColumn_() {
    var ts = trackerSheet_();
    if (!ts || ts.getLastRow() < 4) return [];
    var lastRow = ts.getLastRow();
    return ts.getRange(4, 1, lastRow - 3, 1).getValues().map(function(r) { return r[0]; });
  }

  // Two attempts (F3Go30-a2hq): a cached roster index that predates a Tracker re-sort points at
  // the wrong row, and the row it yields is then written back into PaxCache under THIS pax's
  // name, so the poison persists across requests until something purges it. Attempt 1 uses the
  // caches; if the row it produces doesn't bear this PAX's name, purge both carriers and take
  // attempt 2, which is guaranteed live (the index was just deleted, the row entry with it).
  // A second failure means the roster genuinely no longer contains this PAX — report the miss
  // rather than returning a row belonging to someone else.
  var trackerRowIndex = -1;
  var trackerRow = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    trackerRowIndex = resolvePaxRowIndex_dw_('tracker', monthInfo.sheetId, f3Name, readTrackerNameColumn_);
    if (trackerRowIndex === -1) return { matched: false, months: months };

    trackerRow = getPaxCacheRow_dw_('tracker', monthInfo.sheetId, f3Name);
    if (!trackerRow) {
      var ts2 = trackerSheet_();
      trackerRow = ts2.getRange(trackerRowIndex + 4, 1, 1, ts2.getLastColumn()).getValues()[0];
      if (trackerRowBelongsToPax_dw_(trackerRow, f3Name)) {
        setPaxCacheRow_dw_('tracker', monthInfo.sheetId, f3Name, trackerRow);
      }
    }
    if (trackerRowBelongsToPax_dw_(trackerRow, f3Name)) break;

    GasLogger.log('checkinWebapp.resolveIdentity.staleBind', {
      lean: true, sheetId: monthInfo.sheetId, requested: f3Name,
      foundAtRowIndex: trackerRowIndex, attempt: attempt,
    });
    if (attempt === 1) return { matched: false, months: months };
    purgeStaleTrackerBind_dw_(monthInfo.sheetId, f3Name);
  }
  var trackerMs = Date.now() - t2;

  GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({
    matched: true, lean: true, emailMismatch: emailMismatch,
    openMs: lazySs.getOpenMs(), responsesMs: responsesMs, trackerMs: trackerMs, totalMs: Date.now() - t0,
  }, paxCacheStatsForLog_dw_()));

  return {
    matched: true,
    emailMismatch: emailMismatch,
    months: months,
    monthInfo: monthInfo,
    targetSs: lazySs,
    row2: trackerLayout.row2,
    row3: trackerLayout.row3,
    trackerRow: trackerRow,
    trackerRowIndex: trackerRowIndex,
    goals: needGoals ? {
      who: responsesRow[columns.WHO] || '',
      what: responsesRow[columns.WHAT] || '',
      how: responsesRow[columns.HOW] || '',
    } : undefined,
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
 * @param {string=} contextDateOverride Per-request contextDate override (F3Go30-31w5.1) — must
 *   be threaded through to getCurrentAndNextMonths_dw_ so "current month" for identify itself
 *   honors the pinned test date, not just the day/yesterday arithmetic layered on top of it.
 * @param {boolean=} needGoals See resolveCheckinIdentityLean_ — default true (identify's own
 *   need); handleCheckinSubmit_'s no-handle fallback passes false (F3Go30-o39s.9 audit, F9).
 */
function resolveCheckinIdentity_(templateSpreadsheet, f3Name, email, targetMonth, targetSheetId, contextDateOverride, needGoals) {
  var t0 = Date.now();
  var months = getCurrentAndNextMonths_dw_(templateSpreadsheet, targetSheetId, contextDateOverride);
  GasLogger.log('checkinWebapp.resolveMonths.timing', { durationMs: Date.now() - t0 });
  var monthInfo = selectTargetMonth_dw_(months, targetMonth);
  if (!monthInfo) return { matched: false, months: months };
  return resolveCheckinIdentityLean_(monthInfo, f3Name, email, months, needGoals);
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
 * Every TrackerDB month as {monthKey, label, startDateIso} (ascending chronological order), plus
 * — when f3Name is given — which of those monthKeys this PAX has a PaxDB row for. Backs the
 * static check-in calendar's month picker (F3Go30-k5fn epic): identify reads this once instead
 * of the client re-deriving month resolution itself.
 *
 * One TrackerDB read (_readTrackerDbRowsBySheetId_) always; one Template-resident PaxDB read
 * (_readPaxDbRowsBySheetId_) only when f3Name is given, never a per-month read loop (AC3).
 * Only pass f3Name from branches where it's already a confirmed identity (a full identify match,
 * or an exact-both-fields PaxDB match) — never unverified client-supplied input, which would turn
 * this into a name-enumeration oracle the same way findPaxDbMatch_'s exact-match rule already
 * guards against.
 * @returns {{availableMonths:Array, registeredMonthKeys:Array<string>}}
 */
function buildMonthNavigationPayload_dw_(spreadsheet, f3Name) {
  // F3Go30-bopt: timing split for finding #5 (bd memories F3Go30-perf-checkin-dashboard-eval) —
  // these are the two unthrottled getDataRange().getValues() reads with no row cap suspected of
  // explaining checkinWebapp.identify's unmeasured 2-4s.
  // F3Go30-m732: the TrackerDB half is now served from a cached DERIVED availableMonths blob
  // (write-through invalidated at every TrackerDB mutation point — go30tools.js's
  // _updateTrackerDB and CreateNewTracker.js's upsertLinksRow_ call site) whenever one is
  // present; a miss falls back to the live read below and repopulates it. The PaxDB half is
  // deliberately NOT cached here — see go30tools.js's TRACKER_DB_AVAILABLE_MONTHS_CACHE_PREFIX_
  // docstring on why that's out of scope (subsumed by F3Go30-uz9e.5 instead).
  var tTracker0 = Date.now();
  var cachedNav = getCachedTrackerDbAvailableMonths_dw_ ? getCachedTrackerDbAvailableMonths_dw_(spreadsheet) : null;
  var availableMonths, monthKeyBySheetId, trackerDbCacheHit;
  if (cachedNav && cachedNav.availableMonths && cachedNav.monthKeyBySheetId) {
    availableMonths = cachedNav.availableMonths;
    monthKeyBySheetId = cachedNav.monthKeyBySheetId;
    trackerDbCacheHit = true;
  } else {
    trackerDbCacheHit = false;
    var bySheetId = (readTrackerDbRowsBySheetId_dw_ ? readTrackerDbRowsBySheetId_dw_(spreadsheet) : { bySheetId: {} }).bySheetId || {};
    monthKeyBySheetId = {};
    availableMonths = Object.keys(bySheetId).map(function(sheetId) {
      var row = bySheetId[sheetId];
      var startDate = row.startDate instanceof Date ? row.startDate : new Date(row.startDate);
      var monthKey = _dashboardIsoDate_(startDate).slice(0, 7);
      monthKeyBySheetId[sheetId] = monthKey;
      return { monthKey: monthKey, label: formatRegistrationMonth_dw_(startDate), startDateIso: _dashboardIsoDate_(startDate) };
    }).sort(function(a, b) { return a.startDateIso < b.startDateIso ? -1 : a.startDateIso > b.startDateIso ? 1 : 0; });
    if (setCachedTrackerDbAvailableMonths_dw_) {
      setCachedTrackerDbAvailableMonths_dw_(spreadsheet, { availableMonths: availableMonths, monthKeyBySheetId: monthKeyBySheetId });
    }
  }
  var trackerDbReadMs = Date.now() - tTracker0;

  var norm = f3Name ? paxCacheNormalizeName_dw_(f3Name) : '';
  var registeredMonthKeys = [];
  var paxDbReadMs = 0;
  if (norm) {
    var tPax0 = Date.now();
    var paxRowsBySheetId = (readPaxDbRowsBySheetId_dw_ ? readPaxDbRowsBySheetId_dw_(spreadsheet) : { bySheetId: {} }).bySheetId || {};
    paxDbReadMs = Date.now() - tPax0;
    var registered = {};
    Object.keys(paxRowsBySheetId).forEach(function(sheetId) {
      var monthKey = monthKeyBySheetId[sheetId];
      if (!monthKey) return;
      var hasRow = paxRowsBySheetId[sheetId].some(function(r) { return paxCacheNormalizeName_dw_(r.f3Name) === norm; });
      if (hasRow) registered[monthKey] = true;
    });
    registeredMonthKeys = Object.keys(registered);
  }

  GasLogger.log('checkinWebapp.buildMonthNavigationPayload.timing', {
    withF3Name: !!norm, trackerRows: availableMonths.length, trackerDbCacheHit: trackerDbCacheHit,
    trackerDbReadMs: trackerDbReadMs, paxDbReadMs: paxDbReadMs,
    totalMs: trackerDbReadMs + paxDbReadMs,
  });

  return { availableMonths: availableMonths, registeredMonthKeys: registeredMonthKeys };
}

/*
 * ── Prior-month backfill context (F3Go30-xzm2) ────────────────────────────────────────────────
 *
 * The dashboard's roster loop calls getPriorMonthTailValues_ once per PAX. Everything that call
 * did EXCEPT the per-PAX row lookup is identical for every row of one request: resolving which
 * month precedes the viewed one (a TrackerDB read, via resolveDashboardMonth_), and reading that
 * month's Tracker layout + rows. Before this stage a rollover load paid both once per PAX —
 * SIT telemetry had historyBackfillMs at ~97% of rosterLoopMs (REVIEW-260910 Stage 3).
 *
 * WHY A MEMO IS SAFE HERE — the same Apps Script one-execution-one-request guarantee
 * getScriptPropertiesSnapshot_ (ScriptProperties.js) and _configContextDateMemoized_
 * (go30tools.js) rest on: each execution gets a freshly-evaluated global scope, so module-level
 * state is created and discarded inside one request and can never be observed by another. The
 * only staleness window is *within* one request, and handleCheckinDashboard_ drops the memo at
 * request entry (resetPriorMonthTailContextMemo_) so a write earlier in the same execution — the
 * "yesterday" check-in path is the only writer that can touch a prior month — can never be read
 * back through it. This is a memo, NOT a second persisted cache: it holds no invalidation
 * contract of its own and never outlives the request (bead AC).
 *
 * The context is LAZY on purpose. A fully warm dashboard load has every PAX served from the
 * stored history window and never reaches the backfill at all; resolving the prior month eagerly
 * would add a TrackerDB read to exactly the loads that currently cost nothing.
 */

/** Per-execution memo: {key: currentMonthSheetId, context: ?Object} — see the block comment. */
var priorMonthTailContextMemo_ = null;
/** Per-execution counters, shaped to drop straight into the dashboard's log payload. */
var priorMonthTailStats_ = { resolves: 0, opens: 0 };

/** Drops the memo and its counters. Called at dashboard request entry; test-only otherwise. */
function resetPriorMonthTailContextMemo_() {
  priorMonthTailContextMemo_ = null;
  priorMonthTailStats_ = { resolves: 0, opens: 0 };
}

/** Snapshot of this execution's prior-month counters, field-named for checkinWebapp.dashboard. */
function priorMonthTailStatsForLog_() {
  return { priorMonthResolves: priorMonthTailStats_.resolves, priorMonthOpens: priorMonthTailStats_.opens };
}

/**
 * The once-per-request half of the prior-month backfill: which month precedes monthInfo, and its
 * Tracker layout when already cached. Null when there is no distinct prior tracker (the caller
 * then degrades to [], exactly as the per-PAX path did).
 * @returns {?{sheetId: string, dayCols: ?Array, rowsByNorm: ?Object, bulkRead: boolean}}
 */
function getPriorMonthTailContext_(monthInfo, templateSpreadsheet) {
  var key = monthInfo ? String(monthInfo.sheetId) : '';
  if (priorMonthTailContextMemo_ && priorMonthTailContextMemo_.key === key) {
    return priorMonthTailContextMemo_.context;
  }
  var context = null;
  try {
    if (monthInfo && monthInfo.startDate) {
      var dayBeforeMonth = new Date(monthInfo.startDate);
      dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);
      priorMonthTailStats_.resolves++;
      var priorMonth = resolveDashboardMonth_(dayBeforeMonth, templateSpreadsheet);
      if (priorMonth && priorMonth.sheetId !== monthInfo.sheetId) {
        // Layout cache hit is the common case once the prior month has been viewed once; a miss
        // leaves dayCols null and the first PAX that needs a row triggers the single bulk read.
        var cachedLayout = getCachedTrackerLayoutOnly_(priorMonth.sheetId);
        context = {
          sheetId: priorMonth.sheetId,
          dayCols: cachedLayout ? classifyTrackerColumns_(cachedLayout.row2, cachedLayout.row3).dayCols : null,
          rowsByNorm: null,
          bulkRead: false,
        };
      }
    }
  } catch (e) {
    context = null;
  }
  priorMonthTailContextMemo_ = { key: key, context: context };
  return context;
}

/**
 * Fills the context's layout + rows from ONE read of the prior month's Tracker, at most once per
 * request — the whole-roster replacement for the per-PAX open + single-row read. Also warms
 * PaxCache for that month (readTrackerMonthRoster_ does), so the next request's rows are hits.
 * Best-effort: a failed read leaves bulkRead true with no rows, and every PAX degrades to [].
 */
function ensurePriorMonthTailRoster_(context) {
  if (!context || context.bulkRead) return;
  context.bulkRead = true;
  priorMonthTailStats_.opens++;
  var roster = readTrackerMonthRoster_({ sheetId: context.sheetId });
  if (!roster) return;
  context.dayCols = roster.dayCols;
  context.rowsByNorm = {};
  Object.keys(roster.rowsByName).forEach(function(name) {
    var norm = paxCacheNormalizeName_dw_(name);
    if (norm && !Object.prototype.hasOwnProperty.call(context.rowsByNorm, norm)) {
      context.rowsByNorm[norm] = roster.rowsByName[name];
    }
  });
}

/**
 * Trailing day values (up to windowSize-1) from the PAX's *previous* month's tracker — used by
 * getPaxHistoryWindowValues_'s cold-start self-heal so a rolling window shouldn't reset to a
 * truncated one just because a new month started. Best-effort: returns [] (never throws) whenever there's no
 * prior tracker, the PAX has no row there, or anything else goes wrong — a missing lookback
 * degrades to the old month-truncated behavior rather than breaking the dashboard.
 * Uses the same per-PAX PaxCache (kind 'tracker', keyed by the prior month's sheetId) as the
 * current month, so repeat lookups within the cache's lifetime are a single-row read, not a
 * full scan.
 * @param {Object=} priorContext F3Go30-xzm2: the request's shared prior-month context
 *   (getPriorMonthTailContext_), passed in by the roster loop the same way history entries are.
 *   Omit and this call resolves it from the per-execution memo, which is the same object — the
 *   parameter exists so a caller can hold and inspect it, not to enable a second resolution.
 */
function getPriorMonthTailValues_(monthInfo, f3Name, windowSize, templateSpreadsheet, priorContext) {
  var t0 = Date.now();
  try {
    var context = priorContext || getPriorMonthTailContext_(monthInfo, templateSpreadsheet);
    if (!context) return [];

    // Fast path: if the layout and this PAX's row are both already cached (the common case
    // once the prior month has been viewed once), skip SpreadsheetApp.openById entirely —
    // it's the expensive part, and both caches are write-through invalidated on the one write
    // that can still touch a prior month (handleCheckinSubmit_'s "yesterday" path), so a hit
    // here is never stale.
    var priorRow = getPaxCacheRow_dw_('tracker', context.sheetId, f3Name);
    if (context.dayCols && priorRow) {
      var cachedDayValues = context.dayCols.map(function(d) { return priorRow[d.col]; });
      GasLogger.log('checkinWebapp.priorMonthTail.timing', { skippedOpen: true, durationMs: Date.now() - t0 });
      return cachedDayValues.slice(-(windowSize - 1));
    }

    // Miss: one whole-roster read for the request (not one row read per PAX), then this PAX's
    // row out of it.
    ensurePriorMonthTailRoster_(context);
    if (!priorRow && context.rowsByNorm) priorRow = context.rowsByNorm[paxCacheNormalizeName_dw_(f3Name)] || null;
    if (!context.dayCols || !priorRow) return [];

    // The prior month is already fully over, so every one of its day columns is "reported."
    var priorDayValues = context.dayCols.map(function(d) { return priorRow[d.col]; });
    GasLogger.log('checkinWebapp.priorMonthTail.timing', { skippedOpen: false, durationMs: Date.now() - t0 });
    return priorDayValues.slice(-(windowSize - 1));
  } catch (e) {
    return [];
  }
}

/**
 * Splits a whole-Tracker read into the two shapes PaxCache stores: the {normalizedName: rowIndex}
 * roster index and the {rawName: row} map setPaxCacheRowsBulk_ writes. First occurrence of a
 * normalized name wins the index slot (a duplicate roster row must not shadow the original);
 * blank names contribute nothing.
 *
 * F3Go30-uz9e.3: this was hand-copied at resolveCheckinIdentityFull_ and
 * resolveFullIdentityFromHandle_, and reloadPaxCacheForCurrentAndPriorMonth_ would have made a
 * third copy. Same shape at every site, so it lives in one place.
 * @param {Array<Array>} trackerValues Data rows (from row 4 down), in sheet order.
 * @returns {{rosterIndex: Object<string, number>, rowsByName: Object<string, Array>}}
 */
function buildRosterFromTrackerValues_(trackerValues) {
  var rosterIndex = {};
  var rowsByName = {};
  (trackerValues || []).forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    var norm = paxCacheNormalizeName_dw_(name);
    if (!norm) return;
    if (!Object.prototype.hasOwnProperty.call(rosterIndex, norm)) rosterIndex[norm] = idx;
    rowsByName[name] = row;
  });
  return { rosterIndex: rosterIndex, rowsByName: rowsByName };
}

/**
 * Reads one month's Tracker and warms PaxCache's per-PAX rows + roster index for it, returning
 * what the history rebuild needs (the day columns reported as of contextDate, plus the rows).
 * Best-effort: a month with no tracker, no Tracker sheet, or no data rows yields null rather than
 * throwing — the reload must never be the reason an admin action fails.
 * @returns {?{sheetId: string, dayCols: Array, rowsByName: Object, trackerValues: Array}}
 */
function warmTrackerMonthIntoPaxCache_(monthInfo, contextDate) {
  var roster = readTrackerMonthRoster_(monthInfo, 'reloadPaxCache.monthWarmFailed');
  if (!roster) return null;
  // Only days that have actually happened count as reported — the same rule the dashboard's own
  // reportedDayCols applies. Including future columns would stamp a historyEndDate ahead of
  // today and pad real history off the front, exactly what advancePaxHistoryDay_ refuses to do.
  var dayCols = roster.dayCols.filter(function(d) { return d.date.getTime() <= contextDate.getTime(); });
  return { sheetId: roster.sheetId, dayCols: dayCols, rowsByName: roster.rowsByName, trackerValues: roster.trackerValues };
}

/**
 * One read of a month's Tracker — layout, every day column, every roster row — that also warms
 * PaxCache's per-PAX rows + roster index for that month. The shared body behind
 * warmTrackerMonthIntoPaxCache_ (which additionally clips dayCols to a contextDate) and
 * ensurePriorMonthTailRoster_ (F3Go30-xzm2, which wants every day column since the prior month is
 * already over). Best-effort: any failure yields null rather than throwing — neither caller may be
 * the reason a dashboard load or an admin action fails.
 * @param {?{sheetId: string}} monthInfo
 * @param {string=} failureLogName Event name for the swallowed-error log line.
 * @returns {?{sheetId: string, dayCols: Array, rowsByName: Object, trackerValues: Array}}
 */
function readTrackerMonthRoster_(monthInfo, failureLogName) {
  if (!monthInfo) return null;
  try {
    var sheet = SpreadsheetApp.openById(monthInfo.sheetId).getSheetByName('Tracker');
    if (!sheet || sheet.getLastRow() < 4) return null;
    var layout = getTrackerLayout_(sheet, monthInfo.sheetId);
    var classified = classifyTrackerColumns_(layout.row2, layout.row3);
    var trackerValues = sheet.getRange(4, 1, sheet.getLastRow() - 3, sheet.getLastColumn()).getValues();
    var roster = buildRosterFromTrackerValues_(trackerValues);
    setPaxCacheRowsBulk_dw_('tracker', monthInfo.sheetId, roster.rowsByName, roster.rosterIndex);
    return { sheetId: monthInfo.sheetId, dayCols: classified.dayCols, rowsByName: roster.rowsByName, trackerValues: trackerValues };
  } catch (e) {
    GasLogger.log(failureLogName || 'trackerMonthRoster.readFailed', { sheetId: monthInfo.sheetId, error: e.message });
    return null;
  }
}

/**
 * Repopulates the cache immediately after a wholesale wipe (F3Go30-uz9e.3) — the reload half of
 * WebApp.js's invalidateAllCache admin action.
 *
 * wipeAllPaxCache_ on its own leaves every PAX cold, so the first dashboard load afterwards pays a
 * full rebuild, including a prior-month spreadsheet open per PAX for the cross-month streak. Every
 * caller of that wipe is operator- or deploy-time (the onOpen "Invalidate Cache" menu item, the
 * admin action, tools/manage-deployments.js's post-deploy step) and never sits on a PAX request,
 * so the rebuild is paid here, where nobody is waiting on it.
 *
 * Current AND prior month, because they are jointly what a check-in read needs: the 30-day streak
 * spans the month boundary, so warming only the current month still forces a live prior-month read
 * on the first dashboard load of every month.
 *
 * LOCKING (the reason this is one guarded block rather than a loop of write-throughs): this is a
 * read-modify-write over the same rows handleCheckinSubmit_ patches via
 * refreshPaxCacheRowFromSheet_, and the same history entries advancePaxHistoryDay_ shifts. Taking
 * their lock is what stops a check-in landing between this function's sheet read and its cache
 * write and being silently overwritten by the pre-write snapshot — the LOST UPDATE documented on
 * refreshPaxCacheRowFromSheet_, which is permanent once it happens because the roster index still
 * looks complete. On lock-acquire failure the reload is skipped entirely: the wipe still stands
 * and the next reader rebuilds live, which is slow but correct. Nothing is ever written unlocked.
 * @param {Spreadsheet} templateSpreadsheet
 * @param {Date=} contextDate Injectable for tests; defaults to the resolved context date.
 * @returns {{skipped: boolean, months: Array<string>, paxRows: number, historyEntries: number}}
 */
function reloadPaxCacheForCurrentAndPriorMonth_(templateSpreadsheet, contextDate) {
  var t0 = Date.now();
  var today = contextDate || resolveContextDate_(templateSpreadsheet);
  var result = { skipped: false, months: [], paxRows: 0, historyEntries: 0 };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    GasLogger.log('reloadPaxCache.lockFailed', { error: e.message });
    result.skipped = true;
    return result;
  }

  try {
    var currentMonth = resolveDashboardMonth_(today, templateSpreadsheet);
    var current = warmTrackerMonthIntoPaxCache_(currentMonth, today);
    if (!current) { result.skipped = true; return result; }
    result.months.push(current.sheetId);
    result.paxRows += Object.keys(current.rowsByName).length;

    var dayBeforeMonth = new Date(currentMonth.startDate);
    dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);
    var priorMonthInfo = resolveDashboardMonth_(dayBeforeMonth, templateSpreadsheet);
    // A first-ever month has no prior tracker; resolveDashboardMonth_ can also fall back to the
    // same month, which would double-count its own days into the window.
    var prior = (priorMonthInfo && priorMonthInfo.sheetId !== current.sheetId)
      ? warmTrackerMonthIntoPaxCache_(priorMonthInfo, today)
      : null;
    if (prior) {
      result.months.push(prior.sheetId);
      result.paxRows += Object.keys(prior.rowsByName).length;
    }

    // The window must end on a real reported day for its stamped historyEndDate to mean anything.
    // Before the current month's first day column comes due there is none, so leave the history
    // entries for the next dashboard read to rebuild — the row cache above is still warm.
    if (!current.dayCols.length) return result;
    var anchorIso = _dashboardIsoDate_(current.dayCols[current.dayCols.length - 1].date);

    var priorRowsByNorm = {};
    if (prior) {
      Object.keys(prior.rowsByName).forEach(function(name) {
        priorRowsByNorm[paxCacheNormalizeName_dw_(name)] = prior.rowsByName[name];
      });
    }

    var historyBatch = {};
    Object.keys(current.rowsByName).forEach(function(name) {
      var currentRow = current.rowsByName[name];
      var currentDays = current.dayCols.map(function(d) { return currentRow[d.col]; });
      var priorRow = priorRowsByNorm[paxCacheNormalizeName_dw_(name)];
      var priorDays = (prior && priorRow) ? prior.dayCols.map(function(d) { return priorRow[d.col]; }) : [];
      var days = priorDays.concat(currentDays).slice(-PAX_HISTORY_BACKFILL_DAYS_dw_).map(paxHistoryEncodeValue_dw_).join('');
      // Same rule getPaxHistoryWindowValues_'s rebuild follows: an all-'.' window says "no data",
      // which the miss path already says for free — storing it costs one Script Property per
      // never-active PAX against a 500KB store.
      if (!/[^.]/.test(days)) return;
      historyBatch[name] = { historyEndDate: anchorIso, days: days };
      result.historyEntries++;
    });
    if (result.historyEntries) setPaxHistoryEntriesBulk_dw_(paxHistoryScopeId_dw_(templateSpreadsheet), historyBatch);

    return result;
  } catch (e2) {
    GasLogger.log('reloadPaxCache.failed', { error: e2.message });
    result.skipped = true;
    return result;
  } finally {
    lock.releaseLock();
    GasLogger.log('reloadPaxCache', Object.assign({ durationMs: Date.now() - t0 }, result));
  }
}

/**
 * Full-roster identity resolution for the dashboard's team/board view, which needs every PAX's
 * Tracker row (contrast resolveCheckinIdentityLean_, used by identify/checkin-submit, which
 * only ever need one PAX's own row). The Tracker roster comes from PaxCache's per-PAX rows +
 * roster index (buildTrackerValuesFromPaxCache_, F3Go30-5nfj.3) rather than a whole-sheet
 * CacheService blob: a single check-in write-through patch leaves every OTHER pax's row
 * untouched, so this assembly stays a cache hit across writes instead of needing invalidation.
 * Responses still goes through getCachedSheetValuesOnly_/setCachedSheetValues_ (whole-sheet
 * CacheService blob) — check-in writes never touch Responses, so that cache has no write-through
 * counterpart to build here. Manual edits that don't go through this webapp's own code are caught
 * instead by TrackerEditTrigger.js's onEdit-driven invalidation (F3Go30-o39s epic). On any Tracker
 * cache miss, this falls back to a live full-range read and opportunistically writes every row
 * into PaxCache as a side effect, so the very next identify/checkin for any of these PAX (same
 * day) hits the lean per-PAX path instead of another scan.
 */
function resolveCheckinIdentityFull_(monthInfo, f3Name, email, months) {
  var t0 = Date.now();
  var targetSs = SpreadsheetApp.openById(monthInfo.sheetId);
  var openMs = Date.now() - t0;

  var responsesCacheKey = responsesValuesCacheKey_(monthInfo.sheetId);
  var dataRows = getCachedSheetValuesOnly_(responsesCacheKey);
  var trackerValues = buildTrackerValuesFromPaxCache_(monthInfo.sheetId);

  var responsesSheet = targetSs.getSheetByName('Responses');
  if (!responsesSheet) return { matched: false, months: months };

  var t1 = Date.now();
  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns_dw_(headers);
  if (!dataRows) {
    dataRows = responsesSheet.getLastRow() > 1
      ? responsesSheet.getRange(2, 1, responsesSheet.getLastRow() - 1, responsesSheet.getLastColumn()).getValues()
      : [];
    setCachedSheetValues_(responsesCacheKey, dataRows);
  }
  var match = findSignupMatchByF3NameOnly_dw_(dataRows, f3Name, columns);
  var responsesMs = Date.now() - t1;

  // F3Go30-csfe.1: no signup match here doesn't necessarily mean nothing to show — a PAX
  // previewing a just-created next month's roster before registering has no Responses/Tracker
  // row of their own, but everyone ELSE already registered for that month is still on its
  // Tracker. Read the roster regardless of match so handleCheckinDashboard_ can render a
  // board-only view instead of a hard miss; only bail with no roster fields at all when the
  // Tracker sheet itself isn't there to read (nothing to show under any perspective).
  var trackerSheet = targetSs.getSheetByName('Tracker');
  if (!trackerSheet || trackerSheet.getLastRow() < 4) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: false, lean: false, openMs: openMs, responsesMs: responsesMs, totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
    return { matched: false, months: months };
  }

  var t2 = Date.now();
  var layout = getTrackerLayout_(trackerSheet, monthInfo.sheetId);
  var trackerFromCache = !!trackerValues;
  if (!trackerValues) {
    var lastRow = trackerSheet.getLastRow();
    var lastCol = trackerSheet.getLastColumn();
    trackerValues = trackerSheet.getRange(4, 1, lastRow - 3, lastCol).getValues();
  }
  var trackerMs = Date.now() - t2;

  // Snapshotted fresh at each return point below (reads the current trackerValues/rowIndex
  // closure variables, not a value captured once) — the stale-bind path further down reassigns
  // trackerValues to a fresh read, and this must reflect that if it fires after.
  function boardOnlyIdentity_dw_() {
    return {
      matched: false, months: months, monthInfo: monthInfo,
      targetSs: { get: function() { return targetSs; }, getOpenMs: function() { return openMs; } },
      trackerSheet: trackerSheet, row2: layout.row2, row3: layout.row3, trackerValues: trackerValues,
      trackerFromCache: trackerFromCache,
    };
  }

  if (!match) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: false, lean: false, openMs: openMs, responsesMs: responsesMs, trackerMs: trackerMs, totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
    return boardOnlyIdentity_dw_();
  }

  var registeredEmail = String(
    headers && typeof getResponseEmailValue_dw_ === 'function'
      ? getResponseEmailValue_dw_(match.row, columns, headers)
      : match.row[columns.EMAIL]
  ).trim().toLowerCase();
  var emailMismatch = registeredEmail !== String(email || '').trim().toLowerCase();

  var t3 = Date.now();
  var roster = buildRosterFromTrackerValues_(trackerValues);
  var rosterIndex = roster.rosterIndex;
  // trackerValues already came from PaxCache's own per-PAX rows + roster index — writing it back
  // would just be an unconditional PropertiesService round trip for data already stored there.
  // Only a live read (cold cache) needs this bulk repopulate.
  if (!trackerFromCache) {
    setPaxCacheRowsBulk_dw_('tracker', monthInfo.sheetId, roster.rowsByName, rosterIndex);
  }
  var cacheWriteMs = Date.now() - t3;

  var rowIndex = rosterIndex[paxCacheNormalizeName_dw_(f3Name)];
  if (rowIndex === undefined) return boardOnlyIdentity_dw_();

  // Same invariant as the lean path (F3Go30-a2hq). rosterIndex here was rebuilt from
  // trackerValues in this very function, so it agrees with those values by construction — but
  // trackerValues itself may have come from PaxCache (buildTrackerValuesFromPaxCache_), which
  // assembles rows using the SAME possibly-stale cached index. Verify against the row rather
  // than trusting the assembly, and on a mismatch purge and fall back to a live read.
  if (!trackerRowBelongsToPax_dw_(trackerValues[rowIndex], f3Name)) {
    GasLogger.log('checkinWebapp.resolveIdentity.staleBind', {
      lean: false, sheetId: monthInfo.sheetId, requested: f3Name, foundAtRowIndex: rowIndex,
      fromCache: trackerFromCache,
    });
    purgeStaleTrackerBind_dw_(monthInfo.sheetId, f3Name);
    if (!trackerFromCache) return boardOnlyIdentity_dw_();
    var freshLastRow = trackerSheet.getLastRow();
    var freshLastCol = trackerSheet.getLastColumn();
    trackerValues = trackerSheet.getRange(4, 1, freshLastRow - 3, freshLastCol).getValues();
    rowIndex = -1;
    for (var fi = 0; fi < trackerValues.length; fi++) {
      if (trackerRowBelongsToPax_dw_(trackerValues[fi], f3Name)) { rowIndex = fi; break; }
    }
    if (rowIndex === -1) return boardOnlyIdentity_dw_();
  }

  GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({
    matched: true, lean: false, emailMismatch: emailMismatch,
    openMs: openMs, responsesMs: responsesMs, trackerMs: trackerMs,
    cacheWriteMs: cacheWriteMs, totalMs: Date.now() - t0,
  }, paxCacheStatsForLog_dw_()));

  return {
    matched: true,
    emailMismatch: emailMismatch,
    months: months,
    monthInfo: monthInfo,
    // Already opened above (this fallback path has no cache-only shortcut) — wrapped in the same
    // lazy-wrapper shape (F3Go30-440b.6) purely so downstream consumers (resolveBonusSheet_,
    // handleCheckinDashboard_) can call identity.targetSs.get() uniformly regardless of which
    // resolver produced this identity.
    targetSs: { get: function() { return targetSs; }, getOpenMs: function() { return openMs; } },
    trackerSheet: trackerSheet,
    row2: layout.row2,
    row3: layout.row3,
    trackerValues: trackerValues,
    rowIndex: rowIndex,
    trackerFromCache: trackerFromCache,
  };
}

/**
 * Builds the lightweight resolved-context handle handleCheckinIdentify_ returns in its result and
 * the checkin/dashboard POSTs echo back (F3Go30-qi26.1). Carries just enough to let those
 * follow-up calls skip resolveMonths + the identity re-lookup: the target tracker's sheetId (so
 * the month needn't be re-derived from a date via a TrackerDB scan), the PAX's Tracker rowIndex +
 * canonical F3 name (so their row is read directly instead of scanned for), and the
 * monthKey/label/url/startDate needed to reconstruct a monthInfo without that scan. Everything
 * here is only ever a HINT — every consumer re-validates that rowIndex still names this PAX before
 * trusting it and falls back to full resolution when it doesn't (roster edit, month rollover).
 */
function buildResolvedContextHandle_(monthInfo, trackerRowIndex, canonicalF3Name) {
  return {
    sheetId: monthInfo.sheetId,
    monthKey: _dashboardIsoDate_(monthInfo.startDate).slice(0, 7),
    startDateIso: _dashboardIsoDate_(monthInfo.startDate),
    trackerUrl: monthInfo.trackerUrl || null,
    label: monthInfo.label,
    rowIndex: trackerRowIndex,
    f3Name: canonicalF3Name,
  };
}

/**
 * Reconstructs a monthInfo-shaped object from an echoed resolved-context handle without a
 * TrackerDB scan (contrast resolveDashboardMonth_/getCurrentAndNextMonths_). Returns null when
 * the handle lacks the fields needed to be trusted at all.
 */
function monthInfoFromHandle_(handle) {
  if (!handle || !handle.sheetId || !handle.startDateIso) return null;
  return {
    sheetId: handle.sheetId,
    trackerUrl: handle.trackerUrl || null,
    label: handle.label || '',
    startDate: parseIsoDateLocal_(handle.startDateIso),
  };
}

/**
 * Fast-path lean identity from an echoed handle (F3Go30-qi26.1), for handleCheckinSubmit_: opens
 * the handle's own tracker and reads the single Tracker row it points at directly, skipping both
 * resolveMonths (getCurrentAndNextMonths_) and the identity re-lookup (Responses match + Tracker
 * roster scan) resolveCheckinIdentity_ would otherwise pay for. Returns a lean-identity-shaped
 * object (same fields handleCheckinSubmit_/resolveCheckinDayTarget_ read) on success, or null when
 * the handle no longer validates — a rowIndex whose row no longer carries the handle's canonical
 * F3 name (roster edit shifted rows, or a wholly stale handle) — so the caller transparently
 * falls back to full resolution. Note: goals/emailMismatch aren't computed here (the submit path
 * uses neither).
 */
function resolveLeanIdentityFromHandle_(handle) {
  var monthInfo = monthInfoFromHandle_(handle);
  if (!monthInfo || typeof handle.rowIndex !== 'number' || handle.rowIndex < 0) return null;
  var t0 = Date.now();
  var targetSs;
  try { targetSs = SpreadsheetApp.openById(monthInfo.sheetId); } catch (e) { return null; }

  var trackerSheet = targetSs.getSheetByName('Tracker');
  if (!trackerSheet || trackerSheet.getLastRow() < handle.rowIndex + 4) return null;

  var trackerRow = trackerSheet.getRange(handle.rowIndex + 4, 1, 1, trackerSheet.getLastColumn()).getValues()[0];
  // Staleness gate: the row the handle pointed at must still carry the same canonical PAX name.
  if (paxCacheNormalizeName_dw_(trackerRow[TRACKER_NAME_COL_]) !== paxCacheNormalizeName_dw_(handle.f3Name)) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: false, fromHandle: true, stale: true, totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
    return null;
  }
  var layout = getTrackerLayout_(trackerSheet, monthInfo.sheetId);
  // Keep PaxCache's per-PAX row warm for any follow-up lean lookup that DOESN'T carry the handle.
  setPaxCacheRow_dw_('tracker', monthInfo.sheetId, trackerRow[TRACKER_NAME_COL_], trackerRow);

  GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: true, fromHandle: true, lean: true, totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
  return {
    matched: true,
    fromHandle: true,
    months: null,
    monthInfo: monthInfo,
    targetSs: targetSs,
    trackerSheet: trackerSheet,
    row2: layout.row2,
    row3: layout.row3,
    trackerRow: trackerRow,
    trackerRowIndex: handle.rowIndex,
  };
}

/**
 * Fast-path full identity from an echoed handle (F3Go30-qi26.1), for handleCheckinDashboard_:
 * reads the tracker's full roster (still needed to build the board) but skips the Responses
 * match + emailMismatch resolveCheckinIdentityFull_ pays for (the dashboard uses neither), taking
 * the PAX's rowIndex straight from the handle after validating the canonical name still lives
 * there. Returns null when the handle's rowIndex no longer names this PAX (roster edit) so the
 * caller falls back to full resolution. Mirrors resolveCheckinIdentityFull_'s roster read + cache
 * side effects (whole-sheet cache, PaxCache warm) — kept parallel deliberately rather than shared,
 * so each keeps its own purpose-built Axiom timing.
 */
function resolveFullIdentityFromHandle_(handle) {
  var monthInfo = monthInfoFromHandle_(handle);
  if (!monthInfo || typeof handle.rowIndex !== 'number' || handle.rowIndex < 0) return null;
  var t0 = Date.now();
  var lazySs = makeLazySpreadsheet_dw_(monthInfo.sheetId);
  var trackerSheet = null;
  function trackerSheet_() {
    if (!trackerSheet) {
      var ss;
      try { ss = lazySs.get(); } catch (e) { return null; }
      trackerSheet = ss.getSheetByName('Tracker');
    }
    return trackerSheet;
  }

  var t2 = Date.now();
  // Lazy about SpreadsheetApp.openById() (F3Go30-440b.6): on a full cache hit — Tracker layout
  // AND the whole roster both already warm — the spreadsheet is never opened, so the bounds
  // check below (getLastRow() < 4) only runs when a live read is genuinely needed to fill a gap.
  var layout = getCachedTrackerLayoutOnly_(monthInfo.sheetId);
  // Whole-roster read — required for the dashboard's team/board view: every PAX's Tracker row
  // backs allPaxRows/paxBoard/myTeamMembers (see handleCheckinDashboard_), so this read stays on
  // the critical path by necessity. Sourced from PaxCache's per-PAX rows + roster index
  // (buildTrackerValuesFromPaxCache_, F3Go30-5nfj.3) rather than a whole-sheet CacheService blob:
  // a check-in write-through patch leaves every OTHER pax's row untouched, so this stays a cache
  // hit across writes. Mirrors resolveLeanIdentityFromHandle_, which already trusts its single-row
  // live read with no probe.
  var trackerValues = buildTrackerValuesFromPaxCache_(monthInfo.sheetId);
  var trackerFromCache = !!trackerValues;
  if (!layout || !trackerValues) {
    var ts = trackerSheet_();
    if (!ts || ts.getLastRow() < 4) return null;
    if (!layout) layout = getTrackerLayout_(ts, monthInfo.sheetId);
  }
  if (!trackerValues) {
    var lastRow = trackerSheet.getLastRow();
    var lastCol = trackerSheet.getLastColumn();
    trackerValues = trackerSheet.getRange(4, 1, lastRow - 3, lastCol).getValues();
  }
  var trackerMs = Date.now() - t2;

  var t3 = Date.now();
  var roster = buildRosterFromTrackerValues_(trackerValues);
  var rosterIndex = roster.rosterIndex;
  // trackerValues already came from PaxCache's own per-PAX rows + roster index when trackerFromCache
  // is true — writing it back would just be an unconditional PropertiesService round trip for data
  // already stored there. Only a live read (cold cache) needs this bulk repopulate.
  if (!trackerFromCache) {
    setPaxCacheRowsBulk_dw_('tracker', monthInfo.sheetId, roster.rowsByName, rosterIndex);
  }
  var cacheWriteMs = Date.now() - t3;

  // Staleness gate: prefer the handle's own rowIndex, but only if that row still names this PAX.
  // If a roster edit shifted rows, re-derive from the freshly-built index; if the PAX is gone
  // entirely, bail so the caller falls back to full resolution (which reports the identity miss).
  var rowIndex = handle.rowIndex;
  if (paxCacheNormalizeName_dw_((trackerValues[rowIndex] || [])[TRACKER_NAME_COL_]) !== paxCacheNormalizeName_dw_(handle.f3Name)) {
    rowIndex = rosterIndex[paxCacheNormalizeName_dw_(handle.f3Name)];
    if (rowIndex === undefined) {
      GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: false, fromHandle: true, lean: false, stale: true, totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
      return null;
    }
  }

  GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({
    matched: true, fromHandle: true, lean: false,
    openMs: lazySs.getOpenMs(), trackerMs: trackerMs, cacheWriteMs: cacheWriteMs, totalMs: Date.now() - t0,
  }, paxCacheStatsForLog_dw_()));
  return {
    matched: true,
    fromHandle: true,
    months: null,
    monthInfo: monthInfo,
    targetSs: lazySs,
    row2: layout.row2,
    row3: layout.row3,
    trackerValues: trackerValues,
    rowIndex: rowIndex,
    trackerFromCache: trackerFromCache,
  };
}

// How close to next month's start the nudge is allowed to appear — a PAX who hasn't signed up
// yet three weeks out isn't neglecting anything, they just haven't gotten there; nagging them
// that early reads as noise, not a reminder. Someone who wants to sign up further ahead always
// can, unprompted, via the plain signup URL — this only gates the automatic nudge shown on the
// check-in page.
var NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_ = 3;

/**
 * Per-execution memo for resolveNextMonthRegistrationStatus_dw_ (F3Go30-nclp), keyed by
 * `${sheetId}::${normalizedF3Name}` — same one-execution-one-request rationale as
 * priorMonthTailContextMemo_ above (GAS re-evaluates this file's top-level state fresh on every
 * execution, so the memo can never leak across requests). checkNextMonthRegistration_ and
 * resolveSignupReminder_dw_ each independently call the uncached resolver below on every matched
 * identify that has a next-month tracker; without this, that's a SpreadsheetApp.openById + a
 * Responses header read paid twice for the exact same (sheetId, f3Name) question.
 */
var nextMonthRegistrationStatusMemo_ = {};

/** Drops the memo — test-only; production never needs it (see the memo's docstring). */
function resetNextMonthRegistrationStatusMemo_() {
  nextMonthRegistrationStatusMemo_ = {};
}

/**
 * Whether f3Name has a live (non-DELETED) Responses row for months.next — the shared lookup
 * behind both checkNextMonthRegistration_'s day-window-gated inline nudge and
 * resolveSignupReminder_dw_'s always-on popup (F3Go30-xyvs); each applies its own gating on top
 * of this, so the Sheets/PaxCache read itself lives in exactly one place. Returns null when
 * there's no next-month tracker yet at all (nothing to register for).
 *
 * Memoized per (months.next.sheetId, f3Name) for one execution (F3Go30-nclp) — see
 * nextMonthRegistrationStatusMemo_'s docstring.
 * @returns {{registered: boolean, monthLabel: string, startDate: (string|Date), sheetId: string}|null}
 */
function resolveNextMonthRegistrationStatus_dw_(months, f3Name) {
  if (!months || !months.next) return null;
  var memoKey = months.next.sheetId + '::' + paxCacheNormalizeName_dw_(f3Name);
  if (Object.prototype.hasOwnProperty.call(nextMonthRegistrationStatusMemo_, memoKey)) {
    return nextMonthRegistrationStatusMemo_[memoKey];
  }
  var result = resolveNextMonthRegistrationStatusUncached_dw_(months, f3Name);
  nextMonthRegistrationStatusMemo_[memoKey] = result;
  return result;
}

/** The actual resolution logic, never memoized directly — see resolveNextMonthRegistrationStatus_dw_. */
function resolveNextMonthRegistrationStatusUncached_dw_(months, f3Name) {
  var nextMonth = months.next;
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

  return { registered: rowIndex !== -1, monthLabel: nextMonth.label, startDate: nextMonth.startDate, sheetId: nextMonth.sheetId };
}

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
  var daysUntilNextMonth = (new Date(months.next.startDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysUntilNextMonth > NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_) return null;
  var status = resolveNextMonthRegistrationStatus_dw_(months, f3Name);
  return status && { registered: status.registered, monthLabel: status.monthLabel };
}

/**
 * F3Go30-xyvs: SignupReminder popup trigger. Unlike checkNextMonthRegistration_'s inline nudge —
 * gated to only the final NEXT_MONTH_SIGNUP_NUDGE_WINDOW_DAYS_ before next month starts — this
 * popup is meant to persist for as long as next month's tracker exists and the PAX has no record
 * in it yet, so it reuses resolveNextMonthRegistrationStatus_dw_ with no day-window gate. Safe to
 * call unconditionally on every matched identify: resolvePaxRowIndex_dw_ (PaxCache) means the
 * underlying Responses row-column read only happens once per cache cycle, not on every request.
 * @returns {{monthLabel: string}|null} null when there's nothing to remind about (no next-month
 *   tracker yet, or the PAX is already registered for it).
 */
function resolveSignupReminder_dw_(months, f3Name) {
  var status = resolveNextMonthRegistrationStatus_dw_(months, f3Name);
  if (!status || status.registered) return null;
  return { monthLabel: status.monthLabel };
}

/**
 * Resolves the Tracker cell for a specific check-in date, given the PAX's already-resolved
 * identity for their *current* month — expands into that date's own tracker when it falls
 * outside the current month (e.g. looking up/editing yesterday's check-in on the 1st of a new
 * month, when the current month's tracker has no column for it at all). Mirrors the cross-month
 * lookback pattern in getPriorMonthTailValues_. Returns null when no tracker has a day column
 * for targetDate (never throws).
 * @returns {?{trackerSheet:Sheet, sheetId:string, rowIndex:number, col:number, value:*, row:Array}}
 *   row is the PAX's full pre-write Tracker row (F3Go30-5nfj.3) — handleCheckinSubmit_ patches a
 *   copy of it into PaxCache instead of deleting the cached entry after the write.
 */
function resolveCheckinDayTarget_(identity, f3Name, targetDate, templateSpreadsheet) {
  var classified = classifyTrackerColumns_(identity.row2, identity.row3);
  var col = findDateColumnIndex_(classified.dayCols, targetDate);
  if (col !== -1) {
    // identity.trackerSheet: resolveLeanIdentityFromHandle_'s always-eager result. identity.targetSs
    // (lazy wrapper, F3Go30-440b.6): resolveCheckinIdentityLean_'s result — forces the open here,
    // which is correct since this is the write path and a live Sheet handle is always needed.
    return {
      trackerSheet: identity.trackerSheet || identity.targetSs.get().getSheetByName('Tracker'),
      sheetId: identity.monthInfo.sheetId,
      rowIndex: identity.trackerRowIndex,
      col: col,
      value: identity.trackerRow[col],
      row: identity.trackerRow,
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
      row: otherRow,
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

/**
 * F3Go30-g9bi: resolves the single active splash-notice, if any, from the Config sheet's
 * `Announce.<day>` rows (key = literal prefix + integer day-of-month, e.g. `Announce.11`;
 * primary/column B = the short title shown bold in the splash; secondary/column C = the body
 * text below it). A row with a blank title is treated as unconfigured/not-active — never shown,
 * regardless of what's in the body column — since the title is what makes a row "filled in" at
 * a glance on the Config sheet. The body may be blank (title-only notice).
 * A row is active when `today` falls within [day, day+3] inclusive — read off the same
 * ns/Template-resolved Config sheet `resolveTemplateSpreadsheet_`/`Context Date` already use
 * (live verification F3Go30-g9bi, 2026-08-11: this is NOT scoped per monthly tracker-copy
 * spreadsheet, despite this issue's original brainstorm phrasing — `spreadsheet` here is the
 * same ns-level Template handleCheckinIdentify_ always receives), so `day` normally names a date
 * in the current calendar month, but the window is checked against BOTH the current month's and
 * the prior month's candidate date (whichever actually produces an age in [0, 3]) so a
 * day-28/29/30/31 announcement's tail end still resolves correctly for a PAX who opens the app a
 * day or two into the following month.
 * If more than one row's window is active at once, the newest (highest) day wins — only one
 * announcement is ever shown at a time.
 * @param {Array<Array<*>>} rows Pre-fetched Config sheet values (checkinClientConfig_dw_ reads
 *   the sheet once and shares it across Site Q/NameSpace/announcement — see that function's
 *   docstring; this must NOT call openConfigSheet/getValues() itself, each of which is its own
 *   live Sheets API round trip).
 * @param {Date} today Resolved via resolveContextDate_ by the caller.
 * @returns {{day: number, title: string, message: string}|null}
 */
function resolveActiveAnnouncement_dw_(rows, today) {
  var active = null;
  rows = rows || [];
  var todayYmd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  function ageInDays_(candidateStart) { return Math.round((todayYmd - candidateStart) / 86400000); }
  for (var i = 0; i < rows.length; i++) {
    var match = /^Announce\.(\d+)$/.exec(String(rows[i][0] || '').trim());
    if (!match) continue;
    var title = String(rows[i][1] || '').trim();
    if (!title) continue; // blank title = blank/unconfigured entry, never active
    var message = String(rows[i][2] || '').trim();
    var day = parseInt(match[1], 10);
    var ageThisMonth = ageInDays_(new Date(todayYmd.getFullYear(), todayYmd.getMonth(), day));
    var agePriorMonth = ageInDays_(new Date(todayYmd.getFullYear(), todayYmd.getMonth() - 1, day));
    var inWindow = (ageThisMonth >= 0 && ageThisMonth <= 3) || (agePriorMonth >= 0 && agePriorMonth <= 3);
    if (!inWindow) continue;
    if (!active || day > active.day) active = { day: day, title: title, message: message };
  }
  return active;
}

/**
 * Site-config payload for the check-in front end: bonus type rules/labels, Site Q contact, the
 * namespace label, the current app version, and any active splash-notice. Attached to every
 * handleCheckinIdentify_ response (F3Go30-5nfj.2: static-pages/src/index.html has no
 * server-render step to bake these into — unlike the removed GAS-hosted CheckinApp.html template
 * (DR-04, 2026-08-04) — so it reads them from here instead).
 * @param {string=} contextDateOverride payload.contextDate, if the caller has one — threaded
 *   through to resolveContextDate_ so SIT's setContextDate override drives announcement testing
 *   (F3Go30-g9bi) the same way it already drives todayStatus/yesterdayStatus.
 */
function checkinClientConfig_dw_(spreadsheet, contextDateOverride) {
  // Best-effort: a Config-sheet lookup hiccup must never break identify itself (the config
  // payload only feeds cosmetic/secondary UI — error-banner contact info, bonus type labels,
  // the announcement splash — nothing on the critical identify/checkin path depends on it).
  //
  // F3Go30-g9bi perf follow-up: the Config sheet is opened and read ONCE here and the resulting
  // rows are reused for every lookup below (Site Q, NameSpace, announcement) — a live Sheets API
  // read is a real, measurable round trip on every single identify/checkin/dashboard call, and
  // this used to run it 2x (getConfigValue_dw_ x2, each with no pre-fetched `data`) before the
  // announcement splash added a 3rd. A slow/dropped read here is exactly the kind of extra
  // latency a PAX would feel as "sync taking forever" on every app open.
  var siteQConfig = {}, nameSpaceConfig = {}, announcement = null;
  var configRows = null;
  try {
    var configSheet = openConfigSheet(spreadsheet);
    configRows = configSheet ? configSheet.getValues() : [];
  } catch (e) {
    configRows = null; // fall through — every lookup below degrades to its own default
  }
  try {
    siteQConfig = getConfigValue_dw_(spreadsheet, 'Site Q', configRows) || {};
    nameSpaceConfig = getConfigValue_dw_(spreadsheet, 'NameSpace', configRows) || {};
  } catch (e) {
    // fall through with the {} defaults below
  }
  try {
    announcement = resolveActiveAnnouncement_dw_(configRows, resolveContextDate_(spreadsheet, contextDateOverride));
  } catch (e) {
    // fall through with no announcement
  }
  var cfg = {
    appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
    bonusTypeRules: bonusTypeClientRules_dw_(),
    bonusTypeCodes: bonusTypeDisplayList_dw_(),
    siteQName: siteQConfig.primary || 'Site Q',
    siteQEmail: siteQConfig.secondary || '',
    nameSpace: nameSpaceConfig.primary || 'F3 Go30',
  };
  if (announcement) cfg.announcement = announcement;
  return cfg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildTrackerValuesFromPaxCache_: buildTrackerValuesFromPaxCache_,
    resolveCheckinIdentityLean_: resolveCheckinIdentityLean_,
    resolveCheckinIdentity_: resolveCheckinIdentity_,
    resolveDashboardMonth_: resolveDashboardMonth_,
    buildMonthNavigationPayload_dw_: buildMonthNavigationPayload_dw_,
    getPriorMonthTailValues_: getPriorMonthTailValues_,
    getPriorMonthTailContext_: getPriorMonthTailContext_,
    resetPriorMonthTailContextMemo_: resetPriorMonthTailContextMemo_,
    priorMonthTailStatsForLog_: priorMonthTailStatsForLog_,
    buildRosterFromTrackerValues_: buildRosterFromTrackerValues_,
    readTrackerMonthRoster_: readTrackerMonthRoster_,
    warmTrackerMonthIntoPaxCache_: warmTrackerMonthIntoPaxCache_,
    reloadPaxCacheForCurrentAndPriorMonth_: reloadPaxCacheForCurrentAndPriorMonth_,
    resolveCheckinIdentityFull_: resolveCheckinIdentityFull_,
    buildResolvedContextHandle_: buildResolvedContextHandle_,
    monthInfoFromHandle_: monthInfoFromHandle_,
    resolveLeanIdentityFromHandle_: resolveLeanIdentityFromHandle_,
    resolveFullIdentityFromHandle_: resolveFullIdentityFromHandle_,
    resolveNextMonthRegistrationStatus_dw_: resolveNextMonthRegistrationStatus_dw_,
    resetNextMonthRegistrationStatusMemo_: resetNextMonthRegistrationStatusMemo_,
    checkNextMonthRegistration_: checkNextMonthRegistration_,
    resolveSignupReminder_dw_: resolveSignupReminder_dw_,
    resolveCheckinDayTarget_: resolveCheckinDayTarget_,
    resolveCheckinToken_dw_: resolveCheckinToken_dw_,
    resolveActiveAnnouncement_dw_: resolveActiveAnnouncement_dw_,
    checkinClientConfig_dw_: checkinClientConfig_dw_,
  };
}
