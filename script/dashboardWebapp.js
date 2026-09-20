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

var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
var dashboardWebappSignupModule_ = gasRequire_('./signupWebapp.js', ['getCurrentAndNextMonths_', 'selectTargetMonth_', 'findSignupMatchByF3NameOnly_', 'findPaxDbMatch_']);
var getCurrentAndNextMonths_dw_ = dashboardWebappSignupModule_.getCurrentAndNextMonths_;
var findPaxDbMatch_dw_ = dashboardWebappSignupModule_.findPaxDbMatch_;

var dashboardWebappPaxCacheModule_ = gasRequire_('./PaxCache.js', ['getPaxCacheRow_', 'getPaxCacheRowsBulk_', 'setPaxCacheRow_', 'setPaxCacheRowsBulk_', 'resolvePaxRowIndex_', 'getPaxRosterIndex_', 'deletePaxRosterIndex_', 'refreshPaxCacheRowFromSheet_', 'refreshPaxCacheRowAndAdvanceHistoryForCheckin_', 'deletePaxCacheRow_', 'paxCacheNormalizeName_', 'getPaxCacheRequestStats_', 'getPaxHistoryEntry_', 'setPaxHistoryEntry_', 'paxHistoryDaysToValues_', 'anchorPaxHistoryValues_', 'getPaxHistoryEntriesBulk_', 'paxHistoryDayDiff_', 'paxHistoryEncodeValue_', 'setPaxHistoryEntriesBulk_', 'PAX_HISTORY_BACKFILL_DAYS_', 'getPaxGoalsForMonth_']);
var getPaxCacheRow_dw_ = dashboardWebappPaxCacheModule_.getPaxCacheRow_;
var setPaxCacheRow_dw_ = dashboardWebappPaxCacheModule_.setPaxCacheRow_;
var resolvePaxRowIndex_dw_ = dashboardWebappPaxCacheModule_.resolvePaxRowIndex_;
var deletePaxRosterIndex_dw_ = dashboardWebappPaxCacheModule_.deletePaxRosterIndex_;
var refreshPaxCacheRowFromSheet_dw_ = dashboardWebappPaxCacheModule_.refreshPaxCacheRowFromSheet_;
// F3Go30-y0pw D4: the check-in write path's combined single-lock refresh+history-advance —
// used ONLY by handleCheckinSubmit_ below, which used to call refreshPaxCacheRowFromSheet_dw_
// and advancePaxHistoryDay_dw_ back to back under two separate lock acquisitions.
var refreshPaxCacheRowAndAdvanceHistoryForCheckin_dw_ = dashboardWebappPaxCacheModule_.refreshPaxCacheRowAndAdvanceHistoryForCheckin_;
var deletePaxCacheRow_dw_ = dashboardWebappPaxCacheModule_.deletePaxCacheRow_;
var paxCacheNormalizeName_dw_ = dashboardWebappPaxCacheModule_.paxCacheNormalizeName_;
var getPaxCacheRequestStats_dw_ = dashboardWebappPaxCacheModule_.getPaxCacheRequestStats_;
// f3Name-keyed rolling history window (F3Go30-5uk2) — see PaxCache.js file header.
var getPaxHistoryEntry_dw_ = dashboardWebappPaxCacheModule_.getPaxHistoryEntry_;
var setPaxHistoryEntry_dw_ = dashboardWebappPaxCacheModule_.setPaxHistoryEntry_;
var paxHistoryDaysToValues_dw_ = dashboardWebappPaxCacheModule_.paxHistoryDaysToValues_;
// F3Go30-uz9e.2 — read-side anchoring + the roster-wide batched entry read.
var anchorPaxHistoryValues_dw_ = dashboardWebappPaxCacheModule_.anchorPaxHistoryValues_;
var getPaxHistoryEntriesBulk_dw_ = dashboardWebappPaxCacheModule_.getPaxHistoryEntriesBulk_;
var paxHistoryDayDiff_dw_ = dashboardWebappPaxCacheModule_.paxHistoryDayDiff_;
var paxHistoryEncodeValue_dw_ = dashboardWebappPaxCacheModule_.paxHistoryEncodeValue_;
var PAX_HISTORY_BACKFILL_DAYS_dw_ = dashboardWebappPaxCacheModule_.PAX_HISTORY_BACKFILL_DAYS_;
// f3Name-keyed versioned goals list (F3Go30-uz9e.4, PAX data model migration Slice 2) — see
// PaxCache.js's PAX_GOALS_PREFIX_ header comment.
var getPaxGoalsForMonth_dw_ = dashboardWebappPaxCacheModule_.getPaxGoalsForMonth_;

/**
 * go30hist scopeId (DR-01, 2026-08-04 design review) — the namespace identity every history
 * read/write is keyed on, so two namespaces sharing this script project's PropertiesService store
 * (ADR-014) never collide on the same PAX name. templateSpreadsheet is always a resolved
 * Spreadsheet in production (resolveTemplateSpreadsheet_, go30tools.js, guarantees this — absent
 * an ns it falls back to the bound spreadsheet, never null), so this never throws in practice; the
 * guard exists only so a history-window lookup can never abort an otherwise-successful
 * checkin/dashboard request.
 */
function paxHistoryScopeId_dw_(templateSpreadsheet) {
  try { return templateSpreadsheet.getId(); } catch (e) { return ''; }
}

/** F3Go30-440b.1 — folds this execution's PaxCache hit/miss/wipe counters into the caller's own
 *  per-request GasLogger event object; {} if PaxCache isn't wired (never true in production). */
function paxCacheStatsForLog_dw_() {
  return getPaxCacheRequestStats_dw_ ? getPaxCacheRequestStats_dw_() : {};
}

// F3Go30-h4xt: per-execution script-properties memo counters + the store's measured size.
// propsStoreBytes is the gauge that matters operationally — PropertiesService caps the whole
// store at 500KB and this project's PaxCache/history/goals entries are what grow in it, so a
// creeping value here is the early warning for the purge job falling behind. Resolved lazily for
// the same reason as PaxCache.js's accessors (GAS file evaluation order).
var scriptPropertiesModule_dw_ = (typeof require === 'function') ? require('./ScriptProperties.js') : null;
function scriptPropertiesStatsForLog_dw_() {
  var fn = scriptPropertiesModule_dw_
    ? scriptPropertiesModule_dw_.getScriptPropertiesSnapshotStats_
    : (typeof getScriptPropertiesSnapshotStats_ === 'function' ? getScriptPropertiesSnapshotStats_ : null);
  return fn ? fn() : {};
}

/**
 * True when `row` really is `f3Name`'s row (F3Go30-a2hq). Every identity resolver in this file
 * binds a PAX to a Tracker row via a cached name->offset index, so a stale index silently hands
 * back a DIFFERENT PAX's row — and nothing downstream would notice: identify would report that
 * row's f3Name/team as the caller's own, and handleCheckinSubmit_ would write a check-in into it.
 * The handle-based fast paths (resolveLeanIdentityFromHandle_, resolveFullIdentityFromHandle_)
 * always carried this gate; the resolvers identify itself uses did not, which is how a cross-PAX
 * identity leak reached SIT. Treat this as an invariant every rowIndex-derived row must clear,
 * not as an optimization.
 * @param {Array} row Tracker row values.
 * @param {string} f3Name Canonical name the caller resolved (session-supplied, for identify).
 */
function trackerRowBelongsToPax_dw_(row, f3Name) {
  if (!row) return false;
  return paxCacheNormalizeName_dw_(row[TRACKER_NAME_COL_]) === paxCacheNormalizeName_dw_(f3Name);
}

/**
 * Purges the PaxCache entries that could have produced a wrong-row bind for {sheetId, f3Name}:
 * the roster index (the actual carrier of stale offsets) and this PAX's own row entry, which a
 * prior wrong-row read will have populated with someone else's values under this PAX's key.
 * Best-effort — a resolver that cannot purge still falls through to a live re-read.
 */
function purgeStaleTrackerBind_dw_(sheetId, f3Name) {
  try { if (deletePaxRosterIndex_dw_) deletePaxRosterIndex_dw_('tracker', sheetId); } catch (e) { /* best-effort */ }
  try { if (deletePaxCacheRow_dw_) deletePaxCacheRow_dw_('tracker', sheetId, f3Name); } catch (e) { /* best-effort */ }
}

var dashboardWebappBonusModule_ = gasRequire_('./bonusWebapp.js', ['listBonusEntriesForPax_', 'addBonusEntry_', 'editBonusEntry_', 'clearBonusEntry_', 'findBonusRowByIdentity_', 'getAllBonusEntriesCached_', 'getCachedBonusEntriesOnly_']);
var listBonusEntriesForPax_dw_ = dashboardWebappBonusModule_.listBonusEntriesForPax_;
var addBonusEntry_dw_ = dashboardWebappBonusModule_.addBonusEntry_;
var editBonusEntry_dw_ = dashboardWebappBonusModule_.editBonusEntry_;
var clearBonusEntry_dw_ = dashboardWebappBonusModule_.clearBonusEntry_;
var findBonusRowByIdentity_dw_ = dashboardWebappBonusModule_.findBonusRowByIdentity_;
var getAllBonusEntriesCached_dw_ = dashboardWebappBonusModule_.getAllBonusEntriesCached_;
var getCachedBonusEntriesOnly_dw_ = dashboardWebappBonusModule_.getCachedBonusEntriesOnly_;

var dashboardWebappCheckinSessionsModule_ = gasRequire_('./CheckinSessions.js', ['resolveCheckinSession_', 'createOrTouchCheckinSession_', 'deleteCheckinSessionsByIdentity_']);
var createOrTouchCheckinSession_dw_ = dashboardWebappCheckinSessionsModule_.createOrTouchCheckinSession_;
var resolveCheckinSession_dw2_ = dashboardWebappCheckinSessionsModule_.resolveCheckinSession_;
var deleteCheckinSessionsByIdentity_dw_ = dashboardWebappCheckinSessionsModule_.deleteCheckinSessionsByIdentity_;

var dashboardWebappBonusTypesModule_ = gasRequire_('./BonusTypes.js', ['bonusTypeClientRules_', 'bonusTypeDisplayList_', 'emptyBonusPills_', 'weekOfMonth_', 'computeBonusPillsAsOf_', 'computeBonusSeriesForPax_', 'groupBonusEntriesByPax_', 'annotateBonusEntryCountStatus_', 'annotateBonusEntryDuplicateLinkStatus_']);
var bonusTypeClientRules_dw_ = dashboardWebappBonusTypesModule_.bonusTypeClientRules_;
var emptyBonusPills_dw_ = dashboardWebappBonusTypesModule_.emptyBonusPills_;
var weekOfMonth_dw_ = dashboardWebappBonusTypesModule_.weekOfMonth_;
var computeBonusPillsAsOf_dw_ = dashboardWebappBonusTypesModule_.computeBonusPillsAsOf_;
var computeBonusSeriesForPax_dw_ = dashboardWebappBonusTypesModule_.computeBonusSeriesForPax_;
var groupBonusEntriesByPax_dw_ = dashboardWebappBonusTypesModule_.groupBonusEntriesByPax_;
var annotateBonusEntryCountStatus_dw_ = dashboardWebappBonusTypesModule_.annotateBonusEntryCountStatus_;
var annotateBonusEntryDuplicateLinkStatus_dw_ = dashboardWebappBonusTypesModule_.annotateBonusEntryDuplicateLinkStatus_;

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
 *
 * windowDays, when given, restricts the count to the trailing windowDays reported values, exactly
 * as computeMaxStreak_ does — trimming first, then slicing, so not-yet-reported days never eat
 * into the window. F3Go30-uz9e.3: the cap used to be incidental (getPaxHistoryWindowValues_
 * happened to return only 30 days), which meant lengthening the history window would silently
 * change every displayed streak. It is stated at the call site now instead.
 */
function computeStreak_(dayValues, windowDays) {
  var values = (dayValues || []).slice();
  while (values.length && values[values.length - 1] === '') values.pop();
  if (windowDays) values = values.slice(-windowDays);
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
  // F3Go30-9ywo (REVIEW-260910 finding 6): avgScore-only comparator has no tiebreak, so two
  // groups tied on average (every team is 0.0 early in a month) fall to Array.prototype.sort's
  // behaviour on equal keys — order can flicker between two loads with identical data. Break
  // ties on team name, same precedent scorecardPaxComparator_ (static-pages/src/index.html)
  // already sets for tied PAX.
  groups.sort(function(a, b) { return (b.avgScore - a.avgScore) || a.name.localeCompare(b.name); });
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
 * Builds the Advanced whole-month calendar's per-day payload (F3Go30-th22.1 Decision 2) — one
 * entry per classified day column, ascending date order (= column order). A future day's status
 * is computed exactly like any other day's (almost always 'pending' unless the PAX pre-marked it).
 * @returns {Array<{dateIso:string, status:string}>}
 */
function buildMonthGridEntries_(dayCols, trackerRow) {
  return (dayCols || []).map(function(d) {
    return { dateIso: _dashboardIsoDate_(d.date), status: dayValueStatus_(trackerRow[d.col]) };
  });
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
 * Count of leading dayValues entries up to and including the last non-'pending' (reported) day —
 * i.e. dayValues trimmed of any trailing blank/pending cells. Shared by buildDashboardPaxRow_'s
 * rollingAverage cutoff (F3Go30-3uvp) so the two never derive the pending boundary independently
 * again; uses the same dayValueStatus_ buildDaySegments_ already classifies each day with.
 */
function lastReportedDayCount_(dayValues) {
  var values = dayValues || [];
  for (var i = values.length - 1; i >= 0; i--) {
    if (dayValueStatus_(values[i]) !== 'pending') return i + 1;
  }
  return 0;
}

/**
 * Trailing windowSize-day mean at each reported-day index, for the 7-day moving-average chart
 * and team-tile sparklines. Blank cells within the window are excluded from the average rather
 * than treated as 0 — a not-yet-reported day shouldn't drag the average down.
 *
 * Rounded to 3 decimals before it is serialized (F3Go30-7p61): a raw IEEE double like
 * 0.42857142857142855 costs 19 JSON bytes per point, × up to 31 points × every roster row, and the
 * only consumer is an SVG polyline where nothing past ~2 decimals is renderable. This is a
 * response-shape change under docs/OPERATIONS.md §API compatibility with installed clients, but a
 * numerically compatible one — the field stays a plain number in the same range, so an older
 * installed client plotting 0.429 renders identically to one plotting 0.42857….
 */
function buildRollingAverage_(dayValues, windowSize) {
  var values = dayValues || [];
  var series = [];
  for (var i = 0; i < values.length; i++) {
    var start = Math.max(0, i - windowSize + 1);
    var windowVals = values.slice(start, i + 1).filter(function(v) { return v === 1 || v === 0 || v === -1; });
    var avg = windowVals.length ? windowVals.reduce(function(a, b) { return a + b; }, 0) / windowVals.length : 0;
    series.push(Math.round(avg * 1000) / 1000);
  }
  return series;
}

/** Bonus pill/score computation (weekOfMonth_, computeBonusPillsAsOf_, computeBonusSeriesForPax_,
 *  annotateBonusEntryCountStatus_) lives in BonusTypes.js — see the require block above for the
 *  *_dw_ bindings used below. */

// ─────────────────────────────────────────────────────────────────────────
// GAS orchestration (not unit-tested — composes the pure functions above,
// verified against the live TEST_APP deployment, same boundary as signupWebapp.js).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Serves the cmd=checkin route. DR-04/F3Go30-wjpu (2026-08-04): the GAS-rendered check-in page
 * (formerly CheckinApp.html, built via a now-removed buildCheckinPageOutput_) is gone — every
 * arrival, legacy or fresh, is handed to the static front end (static-pages/src/index.html,
 * wrapping this webapp as its API backend) via the same query-preserving redirect
 * renderHomePage_/renderSignupPage_ use (buildStaticCheckinRedirectUrl_, Utilities.js;
 * renderStaticRedirect_, WebApp.js) — see ADR-019/ADR-020 and this repo's design-review DR-04
 * for why no PAX-facing flow keeps a working GAS-rendered fallback. If the static host can't be
 * resolved (STATIC_PAGES_BASE_URL_ unconfigured — only happens under Node tests, never in a
 * real deployment), this returns a minimal explanatory page rather than reintroducing that
 * removed template.
 */
function renderCheckinPage_(e) {
  var staticCheckinUrl = (typeof buildStaticCheckinRedirectUrl_ === 'function')
    ? buildStaticCheckinRedirectUrl_(ScriptApp.getService().getUrl(), (e && e.parameter) || {})
    : '';
  if (staticCheckinUrl) {
    logStaticRedirect_(e, 'renderCheckinPage_', 'check-in');
    return renderStaticRedirect_(staticCheckinUrl, { bodyLabel: 'Go30 check-in', title: 'Go30 Check-In' });
  }
  return renderStaticUnavailable_('Go30 Check-In');
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
    if (payload.action === 'paxGoals') return jsonOutput_(handlePaxGoals_(spreadsheet, payload));
    if (payload.action === 'monthGrid') return jsonOutput_(handleMonthGrid_(spreadsheet, payload));
    if (payload.action === 'bonusList') return jsonOutput_(handleBonusList_(spreadsheet, payload));
    if (payload.action === 'bonusAdd') return jsonOutput_(handleBonusAdd_(spreadsheet, payload));
    if (payload.action === 'bonusEdit') return jsonOutput_(handleBonusEdit_(spreadsheet, payload));
    // F3Go30-xyri/n40u: client telemetry (captured errors + reconnect-poll outcomes). Dispatched
    // ahead of any spreadsheet-dependent work above — see ClientTelemetryLog.js — but resolving
    // `spreadsheet` unconditionally above is harmless (resolveTemplateSpreadsheet_ fails safe to
    // the bound spreadsheet) and keeps this dispatcher's shape uniform with every other action.
    if (payload.action === 'clientTelemetry') return jsonOutput_(handleClientTelemetryPost_(payload));
    // F3Go30-1pqo.4: settings-menu "Send Feedback" — see handleSiteFeedback_ below.
    if (payload.action === 'siteFeedback') return jsonOutput_(handleSiteFeedback_(spreadsheet, payload));
    // F3Go30-1pqo.2: settings-menu "Logout" server-side half — see handleCheckinLogout_ below.
    if (payload.action === 'logout') return jsonOutput_(handleCheckinLogout_(spreadsheet, payload));
    return jsonOutput_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    GasLogger.logError('handleCheckinPost_.error', err, { action: payload.action });
    return jsonOutput_({ ok: false, error: 'server_error' });
  }
}

// F3Go30-mkpa: handleSiteFeedback_ (settings-menu "Send Feedback") lives in siteFeedback.js now —
// see that file's header. At ~60 lines with no coupling to its former neighbours, it rode along
// with the dashboardIdentity.js extraction rather than counting as a second split-cache-shaped
// instance. Local alias below keeps this file's own module.exports unchanged.
var dashboardWebappSiteFeedbackModule_ = gasRequire_('./siteFeedback.js', ['handleSiteFeedback_']);
var handleSiteFeedback_ = dashboardWebappSiteFeedbackModule_.handleSiteFeedback_;

// F3Go30-mk3a: the CacheService cache layer (layout + full-roster value caches, their key
// builders, and write-through invalidation) lives in dashboardCache.js now — see that file's
// header. Local aliases below keep every existing call site in this file, and this file's own
// module.exports (which tests destructure directly), unchanged.
var dashboardWebappCacheModule_ = gasRequire_('./dashboardCache.js', [
  'TRACKER_LAYOUT_CACHE_TTL_SECONDS_', 'trackerLayoutCacheKey_', 'makeLazySpreadsheet_dw_',
  'responsesLayoutCacheKey_', 'getCachedResponsesLayoutOnly_', 'getResponsesLayout_',
  'serializeRow3ForCache_', 'deserializeRow3FromCache_', 'getCachedTrackerLayoutOnly_',
  'getTrackerLayout_', 'FULL_ROSTER_CACHE_TTL_SECONDS_', 'trackerValuesCacheKey_',
  'responsesValuesCacheKey_', 'serializeSheetValuesForCache_', 'deserializeSheetValuesFromCache_',
  'getCachedSheetValuesOnly_', 'setCachedSheetValues_', 'invalidateFullRosterCache_',
]);
var TRACKER_LAYOUT_CACHE_TTL_SECONDS_ = dashboardWebappCacheModule_.TRACKER_LAYOUT_CACHE_TTL_SECONDS_;
var trackerLayoutCacheKey_ = dashboardWebappCacheModule_.trackerLayoutCacheKey_;
var makeLazySpreadsheet_dw_ = dashboardWebappCacheModule_.makeLazySpreadsheet_dw_;
var responsesLayoutCacheKey_ = dashboardWebappCacheModule_.responsesLayoutCacheKey_;
var getCachedResponsesLayoutOnly_ = dashboardWebappCacheModule_.getCachedResponsesLayoutOnly_;
var getResponsesLayout_ = dashboardWebappCacheModule_.getResponsesLayout_;
var serializeRow3ForCache_ = dashboardWebappCacheModule_.serializeRow3ForCache_;
var deserializeRow3FromCache_ = dashboardWebappCacheModule_.deserializeRow3FromCache_;
var getCachedTrackerLayoutOnly_ = dashboardWebappCacheModule_.getCachedTrackerLayoutOnly_;
var getTrackerLayout_ = dashboardWebappCacheModule_.getTrackerLayout_;
var FULL_ROSTER_CACHE_TTL_SECONDS_ = dashboardWebappCacheModule_.FULL_ROSTER_CACHE_TTL_SECONDS_;
var trackerValuesCacheKey_ = dashboardWebappCacheModule_.trackerValuesCacheKey_;
var responsesValuesCacheKey_ = dashboardWebappCacheModule_.responsesValuesCacheKey_;
var serializeSheetValuesForCache_ = dashboardWebappCacheModule_.serializeSheetValuesForCache_;
var deserializeSheetValuesFromCache_ = dashboardWebappCacheModule_.deserializeSheetValuesFromCache_;
var getCachedSheetValuesOnly_ = dashboardWebappCacheModule_.getCachedSheetValuesOnly_;
var setCachedSheetValues_ = dashboardWebappCacheModule_.setCachedSheetValues_;
var invalidateFullRosterCache_ = dashboardWebappCacheModule_.invalidateFullRosterCache_;

// F3Go30-tity: the identity-resolution engine (every resolveCheckinIdentity*/resolveLean|Full
// IdentityFromHandle_ path, month-navigation + next-month-registration helpers, the announcement
// splash resolver, and checkinClientConfig_dw_) lives in dashboardIdentity.js now — see that
// file's header. Node/test bridge only (meaningless under the real GAS runtime, where `module` is
// undefined and every symbol below is already global): dashboardIdentity.js needs a handful of
// this file's own "Pure functions" section helpers back, and a true circular require can't return
// them via module.exports before this file's own module.exports is assigned at the bottom — so
// they're published to globalThis here, immediately before the require, for gasRequire_'s existing
// globalThis fallback to resolve there instead.
if (typeof module !== 'undefined' && module.exports) {
  globalThis.classifyTrackerColumns_ = classifyTrackerColumns_;
  globalThis.findDateColumnIndex_ = findDateColumnIndex_;
  globalThis.TRACKER_NAME_COL_ = TRACKER_NAME_COL_;
  globalThis.trackerRowBelongsToPax_dw_ = trackerRowBelongsToPax_dw_;
  globalThis.purgeStaleTrackerBind_dw_ = purgeStaleTrackerBind_dw_;
  globalThis.paxCacheStatsForLog_dw_ = paxCacheStatsForLog_dw_;
  globalThis.paxHistoryScopeId_dw_ = paxHistoryScopeId_dw_;
  globalThis._dashboardIsoDate_ = _dashboardIsoDate_;
  globalThis.parseIsoDateLocal_ = parseIsoDateLocal_;
}
var dashboardWebappIdentityModule_ = gasRequire_('./dashboardIdentity.js', [
  'buildTrackerValuesFromPaxCache_', 'resolveCheckinIdentityLean_', 'resolveCheckinIdentity_',
  'resolveDashboardMonth_', 'buildMonthNavigationPayload_dw_', 'getPriorMonthTailValues_',
  'getPriorMonthTailContext_', 'resetPriorMonthTailContextMemo_', 'priorMonthTailStatsForLog_',
  'buildRosterFromTrackerValues_', 'warmTrackerMonthIntoPaxCache_',
  'reloadPaxCacheForCurrentAndPriorMonth_', 'resolveCheckinIdentityFull_',
  'buildResolvedContextHandle_', 'monthInfoFromHandle_', 'resolveLeanIdentityFromHandle_',
  'resolveFullIdentityFromHandle_', 'resolveNextMonthRegistrationStatus_dw_',
  'resetNextMonthRegistrationStatusMemo_',
  'checkNextMonthRegistration_', 'resolveSignupReminder_dw_', 'resolveCheckinDayTarget_',
  'resolveCheckinToken_dw_', 'resolveActiveAnnouncement_dw_', 'checkinClientConfig_dw_',
]);
var buildTrackerValuesFromPaxCache_ = dashboardWebappIdentityModule_.buildTrackerValuesFromPaxCache_;
var resolveCheckinIdentityLean_ = dashboardWebappIdentityModule_.resolveCheckinIdentityLean_;
var resolveCheckinIdentity_ = dashboardWebappIdentityModule_.resolveCheckinIdentity_;
var resolveDashboardMonth_ = dashboardWebappIdentityModule_.resolveDashboardMonth_;
var buildMonthNavigationPayload_dw_ = dashboardWebappIdentityModule_.buildMonthNavigationPayload_dw_;
var getPriorMonthTailValues_ = dashboardWebappIdentityModule_.getPriorMonthTailValues_;
var getPriorMonthTailContext_ = dashboardWebappIdentityModule_.getPriorMonthTailContext_;
var resetPriorMonthTailContextMemo_ = dashboardWebappIdentityModule_.resetPriorMonthTailContextMemo_;
var priorMonthTailStatsForLog_ = dashboardWebappIdentityModule_.priorMonthTailStatsForLog_;
var buildRosterFromTrackerValues_ = dashboardWebappIdentityModule_.buildRosterFromTrackerValues_;
var warmTrackerMonthIntoPaxCache_ = dashboardWebappIdentityModule_.warmTrackerMonthIntoPaxCache_;
var reloadPaxCacheForCurrentAndPriorMonth_ = dashboardWebappIdentityModule_.reloadPaxCacheForCurrentAndPriorMonth_;
var resolveCheckinIdentityFull_ = dashboardWebappIdentityModule_.resolveCheckinIdentityFull_;
var buildResolvedContextHandle_ = dashboardWebappIdentityModule_.buildResolvedContextHandle_;
var monthInfoFromHandle_ = dashboardWebappIdentityModule_.monthInfoFromHandle_;
var resolveLeanIdentityFromHandle_ = dashboardWebappIdentityModule_.resolveLeanIdentityFromHandle_;
var resolveFullIdentityFromHandle_ = dashboardWebappIdentityModule_.resolveFullIdentityFromHandle_;
var resolveNextMonthRegistrationStatus_dw_ = dashboardWebappIdentityModule_.resolveNextMonthRegistrationStatus_dw_;
var resetNextMonthRegistrationStatusMemo_ = dashboardWebappIdentityModule_.resetNextMonthRegistrationStatusMemo_;
var checkNextMonthRegistration_ = dashboardWebappIdentityModule_.checkNextMonthRegistration_;
var resolveSignupReminder_dw_ = dashboardWebappIdentityModule_.resolveSignupReminder_dw_;
var resolveCheckinDayTarget_ = dashboardWebappIdentityModule_.resolveCheckinDayTarget_;
var resolveCheckinToken_dw_ = dashboardWebappIdentityModule_.resolveCheckinToken_dw_;
var resolveActiveAnnouncement_dw_ = dashboardWebappIdentityModule_.resolveActiveAnnouncement_dw_;
var checkinClientConfig_dw_ = dashboardWebappIdentityModule_.checkinClientConfig_dw_;

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
    // F3Go30-276s: identify's own unattributed-time investigation — this is real work
    // (CheckinSessions lookup, or the legacy signed-token verify fallback) that ran before
    // resolveCheckinIdentity_'s own resolveMonths/resolveIdentity spans even start.
    var tTokenResolve0 = Date.now();
    var resolved = resolveCheckinToken_dw_(templateSpreadsheet, payload.token);
    GasLogger.log('checkinWebapp.tokenResolve.timing', { durationMs: Date.now() - tTokenResolve0 });
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
    // f3Name/email are unverified here (the token itself failed to resolve), so registeredMonthKeys
    // must stay empty rather than risk a PaxDB lookup on untrusted input (see the PaxDB-fallback
    // comment below) — availableMonths is PAX-agnostic (every TrackerDB month) so it's safe either way.
    return {
      ok: true, matched: false, tokenInvalid: true, config: checkinClientConfig_dw_(templateSpreadsheet, payload.contextDate),
      availableMonths: buildMonthNavigationPayload_dw_(templateSpreadsheet).availableMonths,
      registeredMonthKeys: [],
    };
  }
  var identity = resolveCheckinIdentity_(templateSpreadsheet, f3Name, email, payload.targetMonth, payload.targetSheetId, payload.contextDate);
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
      var knownPaxNav = buildMonthNavigationPayload_dw_(templateSpreadsheet, paxDbMatch.f3Name);
      // F3Go30-ez8v: distinguish "never signed up" from "already signed up for NEXT month,
      // just not the current one" — the latter is the confusing tail-of-month case where a PAX
      // who just completed signup for next month follows their check-in link and would otherwise
      // be dropped straight into a signup wizard defaulted to the current month with no context
      // that they're already registered elsewhere. currentAndNext is purely date-driven (no PAX
      // identity involved), so it's safe to compute even though identity.matched is false here.
      var currentAndNext = getCurrentAndNextMonths_dw_(templateSpreadsheet, null, payload.contextDate);
      var nextMonthKey = currentAndNext.next ? _dashboardIsoDate_(new Date(currentAndNext.next.startDate)).slice(0, 7) : null;
      var knownPaxNextMonthRegistered = !!(nextMonthKey && knownPaxNav.registeredMonthKeys.indexOf(nextMonthKey) !== -1);
      GasLogger.log('checkinWebapp.identify.result', {
        matched: false, knownPaxNotRegistered: true, knownPaxNextMonthRegistered: knownPaxNextMonthRegistered,
        tokenInvalid: !!payload.token, durationMs: Date.now() - t0,
      });
      return {
        ok: true, matched: false, tokenInvalid: !!payload.token,
        knownPaxNotRegistered: true, f3Name: paxDbMatch.f3Name, email: paxDbMatch.email,
        knownPaxNextMonthRegistered: knownPaxNextMonthRegistered,
        currentMonthLabel: currentAndNext.current ? currentAndNext.current.label : null,
        nextMonthLabel: currentAndNext.next ? currentAndNext.next.label : null,
        config: checkinClientConfig_dw_(templateSpreadsheet, payload.contextDate),
        availableMonths: knownPaxNav.availableMonths,
        registeredMonthKeys: knownPaxNav.registeredMonthKeys,
      };
    }
    GasLogger.log('checkinWebapp.identify.result', { matched: false, durationMs: Date.now() - t0 });
    // No PaxDB match either — this f3Name isn't a confirmed identity, so registeredMonthKeys stays
    // empty rather than running an unverified-name PaxDB lookup (same anti-enumeration boundary
    // as the branch above).
    return {
      ok: true, matched: false, tokenInvalid: !!payload.token, config: checkinClientConfig_dw_(templateSpreadsheet, payload.contextDate),
      availableMonths: buildMonthNavigationPayload_dw_(templateSpreadsheet).availableMonths,
      registeredMonthKeys: [],
    };
  }

  var classified = classifyTrackerColumns_(identity.row2, identity.row3);
  var trackerRow = identity.trackerRow;
  var today = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // 'pending' (not yet reported) is a neutral, expected state here — never rendered as an
  // error or as the -1 "absent" outcome, which only markMinusOne (Q-side) ever sets.
  var todayCol = findDateColumnIndex_(classified.dayCols, today);
  var todayStatus = todayCol === -1 ? 'unavailable' : dayValueStatus_(trackerRow[todayCol]);

  // F3Go30-276s: identify's own unattributed-time investigation — this block is the largest
  // unmeasured slice found: resolveCheckinDayTarget_'s cross-month fallback path can open a
  // SECOND spreadsheet (a month other than the PAX's current one). checkNextMonthRegistration_
  // and resolveSignupReminder_dw_ below used to EACH independently open next month's spreadsheet
  // via resolveNextMonthRegistrationStatus_dw_ (called twice, once per function) — F3Go30-nclp
  // memoized that resolver per (months.next.sheetId, f3Name) for one execution, so the second
  // call is now a memo hit, not a second SpreadsheetApp.openById + Responses read.
  var tPostIdentityPrep0 = Date.now();

  // Yesterday may belong to a different month's tracker than today's (e.g. today is the 1st) —
  // resolveCheckinDayTarget_ falls back to that prior tracker rather than reporting unavailable.
  var yesterdayTarget = resolveCheckinDayTarget_(identity, f3Name, yesterday, templateSpreadsheet);
  var yesterdayAvailable = !!yesterdayTarget;
  var yesterdayStatus = yesterdayAvailable ? dayValueStatus_(yesterdayTarget.value) : null;

  var nextMonth = checkNextMonthRegistration_(identity.months, f3Name);
  // F3Go30-xyvs: SignupReminder popup — same trigger data as nextMonth above (next-month tracker
  // exists, PAX has no record in it) but WITHOUT nextMonth's day-window gate, since the popup is
  // meant to persist across the whole month rather than only the final few days before it starts.
  var signupReminder = resolveSignupReminder_dw_(identity.months, f3Name);

  GasLogger.log('checkinWebapp.postIdentityPrep.timing', {
    hasNextMonth: !!(identity.months && identity.months.next), durationMs: Date.now() - tPostIdentityPrep0,
  });

  var monthNav = buildMonthNavigationPayload_dw_(templateSpreadsheet, trackerRow[TRACKER_NAME_COL_]);

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
  if (sessionGuid) {
    var tCheckinSession0 = Date.now();
    createOrTouchCheckinSession_dw_(templateSpreadsheet, sessionGuid, trackerRow[TRACKER_NAME_COL_], email, legacyTokenMintedAtIso);
    GasLogger.log('checkinWebapp.checkinSession.timing', { durationMs: Date.now() - tCheckinSession0 });
  }

  GasLogger.log('checkinWebapp.identify.result', {
    matched: true, f3Name: trackerRow[TRACKER_NAME_COL_], emailMismatch: identity.emailMismatch,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null, signupReminder: !!signupReminder,
    durationMs: Date.now() - t0,
  });
  return {
    ok: true,
    matched: true,
    config: checkinClientConfig_dw_(templateSpreadsheet, payload.contextDate),
    emailMismatch: !!identity.emailMismatch,
    f3Name: trackerRow[TRACKER_NAME_COL_],
    email: email,
    team: trackerRow[TRACKER_TEAM_COL_],
    monthLabel: identity.monthInfo.label,
    goals: identity.goals,
    // F3Go30-xyvs: null when there's no next-month tracker yet, or the PAX is already signed up
    // for it — applyServerConfig_-style unconditional show/hide on the client (never just gates
    // showing), so signing up through ANY path clears the popup on the very next response.
    signupReminder: signupReminder,
    todayStatus: todayStatus,
    yesterdayAvailable: yesterdayAvailable,
    yesterdayStatus: yesterdayStatus,
    // Advanced whole-month calendar (F3Go30-th22): one entry per day of this identify's own
    // tracker month, ascending date order — the client seeds the calendar/selection panel from
    // this without a second server round trip.
    monthGrid: buildMonthGridEntries_(classified.dayCols, trackerRow),
    nextMonthLabel: nextMonth ? nextMonth.monthLabel : null,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null,
    // Month-to-month navigation (F3Go30-k5fn.1): every TrackerDB month, and which of them this
    // PAX is registered for — the client's calendar month-picker + monthGrid follow-up requests
    // are seeded from this instead of a second round trip.
    availableMonths: monthNav.availableMonths,
    registeredMonthKeys: monthNav.registeredMonthKeys,
    // True exactly when this session has never been resolved before this request (a precise
    // createdAt-vs-lastUsedAt comparison, not a time-window guess — see
    // resolveCheckinToken_dw_) — the "Welcome" vs "Welcome back" heading and the "go bookmark
    // this" nudge are both driven by this one field (static-pages/src/index.html).
    firstUse: firstUse,
    // Resolved-context handle (F3Go30-qi26.1) — the client echoes this back on its follow-up
    // checkin/dashboard POSTs so those handlers skip resolveMonths + the identity re-lookup and
    // go straight to this PAX's known Tracker row. Only ever a hint: the server re-validates it
    // (row still names this PAX) and falls back to full resolution when it doesn't.
    resolvedContext: buildResolvedContextHandle_(identity.monthInfo, identity.trackerRowIndex, trackerRow[TRACKER_NAME_COL_]),
    // The same guid this request came in with (typed path: baked into the form's action URL
    // before submission; token path: the one just being re-verified) — never re-minted, unlike
    // the old signed token, so a bookmark stays valid under the same URL for as long as
    // CheckinSessions keeps its row alive. Client embeds this in the "save your check-in page"
    // link (static-pages/src/index.html); see CheckinSessions.js for why this replaced IdentityToken.js here.
    identityToken: sessionGuid,
  };
}

/**
 * F3Go30-1pqo.2: server-side half of Logout — invalidates the check-in session TOKEN ONLY.
 * Never touches Tracker/Responses/PaxDB/PaxCache/history/goals/Bonus/score data — see
 * CheckinSessions.js's deleteCheckinSessionsByIdentity_ docstring, the one primitive this calls,
 * which is scoped to the CheckinSessions sheet + its own roster-index script property.
 *
 * Authenticates the caller BY THE TOKEN they are logging out with — payload.f3Name/email are
 * never trusted for this action (unlike identify's typed path), because trusting a client-
 * supplied name would let anyone sign anyone else out. The session the token itself resolves to
 * (resolveCheckinSession_, CheckinSessions.js) is the only identity ever acted on.
 *
 * A missing or already-invalid token is not an error — it means there is nothing left to log
 * out of server-side (or the client called this before ever completing an identify) — reported
 * as {ok:true, loggedOut:false} rather than a failure the client would need to handle specially.
 */
function handleCheckinLogout_(templateSpreadsheet, payload) {
  var session = payload.token ? resolveCheckinSession_dw2_(templateSpreadsheet, payload.token) : null;
  if (!session) {
    GasLogger.log('checkinWebapp.logout.result', { matched: false });
    return { ok: true, loggedOut: false };
  }
  var removed = deleteCheckinSessionsByIdentity_dw_(templateSpreadsheet, session.f3Name, session.email);
  GasLogger.log('checkinWebapp.logout.result', { matched: true, f3Name: session.f3Name, removed: removed });
  return { ok: true, loggedOut: true };
}

/**
 * True when targetDate's calendar date is strictly before today's calendar date (time-of-day
 * ignored on both sides) — the -1 "Failed" date gate (F3Go30-th22.1 Decision 1/3): a PAX can only
 * honestly mark a day Failed once it's actually over, never today itself or a future day.
 */
function isStrictlyPastCalendarDate_(targetDate, today) {
  var t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  var n = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return t.getTime() < n.getTime();
}

/**
 * Validates + resolves handleCheckinSubmit_'s widened day/value write contract (F3Go30-th22.1
 * Decision 1) — split out as a pure function so the domain rules are unit-testable without a
 * spreadsheet fixture. `day` is 'today' | 'yesterday' | an explicit "YYYY-MM-DD" string; `value`
 * is 0 | 1 | null | -1 (the four-state model: Miss/Hit/No-Check-in/Failed).
 * @returns {{ok:true, explicitDate:?Date}|{ok:false, error:string}}
 */
function validateCheckinSubmitDayValue_(payload) {
  var explicitDate = null;
  if (payload.day !== 'today' && payload.day !== 'yesterday') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.day || ''))) {
      return { ok: false, error: 'invalid_day' };
    }
    explicitDate = parseIsoDateLocal_(payload.day);
    // new Date(y, m, d) silently rolls overflowing components into the next month (e.g.
    // "2026-13-40" parses to a valid-looking Feb 2027 date) — round-trip back through
    // _dashboardIsoDate_ to reject anything the regex let through but isn't a real calendar date.
    if (isNaN(explicitDate.getTime()) || _dashboardIsoDate_(explicitDate) !== payload.day) {
      return { ok: false, error: 'invalid_day' };
    }
  }
  // null means "clear this day's entry back to unrecorded" — the PAX's own explicit undo, not
  // the same as the -1 "absent"/Failed value (markMinusOne's automatic mark, or now also a
  // PAX-set honor-system value).
  if (payload.value !== 0 && payload.value !== 1 && payload.value !== null && payload.value !== -1) {
    return { ok: false, error: 'invalid_value' };
  }
  return { ok: true, explicitDate: explicitDate };
}

function handleCheckinSubmit_(templateSpreadsheet, payload) {
  var validated = validateCheckinSubmitDayValue_(payload);
  if (!validated.ok) return { ok: false, error: validated.error };

  // Fast path (F3Go30-qi26.1): an echoed resolved-context handle from a prior identify lets us
  // skip resolveMonths + the identity re-lookup and go straight to the known Tracker row — but
  // only when it still validates (resolveLeanIdentityFromHandle_'s name-at-rowIndex gate). A
  // stale/absent handle falls through to full resolution transparently. Cross-month writes (e.g.
  // yesterday on the 1st, or an explicit prior-month date from the calendar) still resolve
  // correctly: resolveCheckinDayTarget_ re-resolves the actual target month itself regardless of
  // which month this identity is anchored to.
  var identity = payload.resolvedContext ? resolveLeanIdentityFromHandle_(payload.resolvedContext) : null;
  if (!identity) {
    // needGoals=false: submit never reads identity.goals/emailMismatch (only the tracker row/day
    // column below), so this fallback skips the per-PAX Responses row fetch entirely
    // (F3Go30-o39s.9 audit, F9).
    identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email, payload.targetMonth, payload.targetSheetId, payload.contextDate, false);
  }
  if (!identity.matched) return { ok: false, error: 'not_found' };

  var today = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  var targetDate;
  if (validated.explicitDate) {
    targetDate = validated.explicitDate;
  } else {
    targetDate = new Date(today);
    if (payload.day === 'yesterday') targetDate.setDate(targetDate.getDate() - 1);
  }

  // Defense-in-depth mirroring the selection panel's #selFailBtn disable rule: a manipulated/
  // replayed request can't pre-mark a future (or today's own) day Failed even though the client
  // UI never offers that combination. 1/0/null are accepted for any date, past or future.
  if (payload.value === -1 && !isStrictlyPastCalendarDate_(targetDate, today)) {
    return { ok: false, error: 'invalid_value' };
  }

  // Yesterday's edit target may live in the previous month's tracker (e.g. today is the 1st) —
  // resolveCheckinDayTarget_ falls back to that prior tracker rather than failing the write.
  var target = resolveCheckinDayTarget_(identity, payload.f3Name, targetDate, templateSpreadsheet);
  if (!target) return { ok: false, error: 'day_column_not_found' };

  var sheetRow = target.rowIndex + 4;
  var sheetCol = target.col + 1;
  var cell = target.trackerSheet.getRange(sheetRow, sheetCol);
  // F3Go30-y0pw D1: the pre-write cell.getFormula() probe that used to guard here is gone — the
  // write column can never BE a formula/Bonus column by construction (classifyTrackerColumns_
  // admits a column to dayCols only when row3 holds a real Date, never 'Bonus', and
  // findDateColumnIndex_ selects exclusively from dayCols; a structural Tracker edit that could
  // move columns under this also invalidates go30dash:trackerLayout:, so it can't go stale behind
  // the TTL). D3 (PaxCache.js's refreshPaxCacheRowCore_) is the post-write mitigation for the
  // accepted residual risk (a structural edit that never fires onEdit): it validates the re-read
  // row's name column before caching, and deletes-and-logs on a mismatch instead of caching a
  // possibly wrong-PAX row. AC2: confirmed no client path depends on the removed 'cell_is_formula'
  // error string — static-pages/src/index.html (and every other static page in this repo) has no
  // reference to that string at all (searched with Python; grep is unreliable on that file).

  if (payload.value === null) cell.clearContent(); else cell.setValue(payload.value);
  // Write-through (F3Go30-5nfj.3) — still a single-row, single-PAX refresh, so every OTHER pax's
  // PaxCache row (and the dashboard's PaxCache-assembled full-board read,
  // resolveCheckinIdentityFull_/resolveFullIdentityFromHandle_) stays untouched and correct. But
  // the row is re-read from the sheet rather than derived from target.row, this request's
  // PRE-write snapshot: that snapshot loses a concurrent check-in's day (F3Go30-xg8f) and carries
  // stale formula-computed score columns (F3Go30-s1a5). See refreshPaxCacheRowCore_.
  //
  // F3Go30-y0pw D4: this used to be two separate calls (refreshPaxCacheRowFromSheet_dw_ then
  // advancePaxHistoryDay_dw_), each acquiring PaxCache.js's global script lock independently even
  // though both operations always need it back to back on the same write. Collapsed into one
  // call that shares a single lock acquisition — see refreshPaxCacheRowAndAdvanceHistoryForCheckin_
  // for why this is equivalent, not just cheaper (both lock-failure fallbacks still fire; the
  // future-day clamp still runs before the lock is taken).
  // The context date is passed explicitly (F3Go30-uz9e.2) so the future-day clamp inside judges
  // "future" against the same day this request resolved, not the script's raw clock.
  refreshPaxCacheRowAndAdvanceHistoryForCheckin_dw_(
    'tracker', target.sheetId, payload.f3Name, target.trackerSheet, sheetRow,
    paxHistoryScopeId_dw_(templateSpreadsheet), targetDate, payload.value, _dashboardIsoDate_(today)
  );
  // F3Go30-dyj9: paxCacheStatsForLog_dw_() now also carries paxLockFailed/paxLockWaitMs — the
  // check-in write-through above is exactly the path that acquires PaxCache.js's script locks
  // (refreshPaxCacheRowFromSheet_, advancePaxHistoryDay_), so this is where lock contention data
  // needs to land to answer the single-global-lock question.
  GasLogger.log('checkinWebapp.checkin', Object.assign({ f3Name: payload.f3Name, day: payload.day, value: payload.value }, paxCacheStatsForLog_dw_()));
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
  var targetDate = dateIso ? parseIsoDateLocal_(dateIso) : resolveContextDate_(templateSpreadsheet, payload.contextDate);
  if (isNaN(targetDate.getTime())) targetDate = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  // Resolve the month against the ns-scoped template (templateSpreadsheet), not the bound
  // deployment — otherwise date-based dispatch reads the wrong TrackerDB and the PAX is
  // never found in a namespace tracker (F3Go30-4j4o.1). monthInfo.sheetId then carries the
  // correct namespace tracker id downstream, so identity/write steps need no ns awareness.
  var monthInfo = resolveDashboardMonth_(targetDate, templateSpreadsheet);
  if (!monthInfo) return { error: 'not_found' };
  // needGoals=false: bonus consumes only identity.targetSs/trackerRow below, never
  // goals/emailMismatch (F3Go30-o39s.9 audit, F9) — skips the per-PAX Responses row fetch.
  var identity = resolveCheckinIdentityLean_(monthInfo, payload.f3Name, payload.email, null, false);
  if (!identity.matched) return { error: 'not_found' };
  var bonusSheet = identity.targetSs.get().getSheetByName('Bonus Tracker');
  if (!bonusSheet) return { error: 'bonus_sheet_not_found' };
  return {
    bonusSheet: bonusSheet,
    canonicalName: identity.trackerRow[TRACKER_NAME_COL_],
    monthStart: monthInfo.startDate,
    // Carried purely so a write path can refresh this PAX's cached Tracker row afterwards
    // (refreshTrackerRowAfterBonusWrite_) — identity is already resolved here, so no caller
    // has to resolve it a second time just to know which row to re-read.
    sheetId: monthInfo.sheetId,
    targetSs: identity.targetSs,
    trackerRowIndex: identity.trackerRowIndex,
  };
}

/**
 * Re-derives this PAX's cached Tracker row from the sheet after a Bonus Tracker write
 * (F3Go30-s1a5 item 2). A bonus entry doesn't touch the Tracker sheet directly, but the Tracker's
 * Score / Raw Score / per-period bonus columns are FORMULAS fed by the Bonus Tracker — so the
 * cached row (which is what the dashboard reads those columns out of) is stale the moment a bonus
 * lands, and stays stale for every warm read until something rebuilds it. Same shared helper,
 * same post-write derivation rule as the check-in path (F3Go30-xg8f): never patch a cached row
 * from pre-write state, always re-read it from the sheet.
 *
 * Best-effort by construction — refreshPaxCacheRowFromSheet_ drops the entry rather than caching
 * an untrustworthy derivation, so the worst case is a cold rebuild on the next read.
 * @param {{sheetId:string, targetSs:Object, trackerRowIndex:number, canonicalName:string}} resolved
 *   a resolveBonusSheet_ result.
 */
function refreshTrackerRowAfterBonusWrite_(resolved) {
  if (!resolved || resolved.trackerRowIndex === undefined || resolved.trackerRowIndex < 0) return;
  var trackerSheet = resolved.targetSs.get().getSheetByName('Tracker');
  if (!trackerSheet) return;
  refreshPaxCacheRowFromSheet_dw_('tracker', resolved.sheetId, resolved.canonicalName,
    trackerSheet, resolved.trackerRowIndex + 4);
}

function handleBonusList_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload, payload.dateISO);
  if (resolved.error) return { ok: false, error: resolved.error };
  var entries = listBonusEntriesForPax_dw_(resolved.bonusSheet, resolved.canonicalName, resolved.bonusSheet.getParent().getId());
  // Two independent annotation passes (F3Go30-6faz.1 adds duplicateLink alongside the existing
  // counts) — each is detection-only over the same entries and neither depends on the other.
  entries = annotateBonusEntryCountStatus_dw_(entries, resolved.monthStart);
  entries = annotateBonusEntryDuplicateLinkStatus_dw_(entries, resolved.monthStart);
  // F3Go30-ilqx: bonusList previously emitted no outcome event at all on success — a read-only
  // action, but one whose entry count/failure mode was otherwise invisible in Axiom.
  GasLogger.log('checkinWebapp.bonusList', { f3Name: resolved.canonicalName, entries: entries.length });
  return {
    ok: true,
    entries: entries,
    bonusTypes: bonusTypeClientRules_dw_(),
  };
}

function handleBonusAdd_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload, payload.whenIso);
  if (resolved.error) return { ok: false, error: resolved.error };
  var result = addBonusEntry_dw_(resolved.bonusSheet, resolved.canonicalName, payload);
  if (result.ok) {
    refreshTrackerRowAfterBonusWrite_(resolved);
    // F3Go30-786l: `duplicate` distinguishes a dedupe hit (nothing written) from a real append —
    // derived from addBonusEntry_'s own branch, not re-inferred here. Log-only per AC3: the
    // field is deleted from the client-facing response below rather than left in the ok:true
    // shape, since surfacing it to the client hasn't been separately justified.
    GasLogger.log('checkinWebapp.bonusAdd', { f3Name: resolved.canonicalName, type: payload.type, duplicate: !!result.duplicate });
    delete result.duplicate;
  }
  return result;
}

/**
 * Cheap month lookup only (TrackerDB row scan on the already-open bound spreadsheet) — no
 * SpreadsheetApp.openById of the target month's own tracker spreadsheet, no Responses/Tracker
 * identity matching. Used by handleBonusEdit_ to decide whether a cross-month move is even
 * happening *before* paying for the expensive per-month identity resolution twice.
 * @returns {{sheetId:string}|null}
 */
function resolveBonusMonthOnly_(dateIso, templateSpreadsheet, contextDateOverride) {
  var targetDate = dateIso ? parseIsoDateLocal_(dateIso) : resolveContextDate_(templateSpreadsheet, contextDateOverride);
  if (isNaN(targetDate.getTime())) targetDate = resolveContextDate_(templateSpreadsheet, contextDateOverride);
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
  var newMonth = resolveBonusMonthOnly_(payload.whenIso, templateSpreadsheet, payload.contextDate);
  if (!newMonth) return { ok: false, error: 'not_found' };

  var originalWhenIso = payload.originalWhenIso || payload.whenIso;
  var originalMonth = resolveBonusMonthOnly_(originalWhenIso, templateSpreadsheet, payload.contextDate);
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
    // Both months' Tracker scores moved — the entry arrived in one and left the other — so both
    // cached rows are stale. Refreshed unconditionally: whatever the clear did or didn't do, the
    // sheet is the authority and re-reading it is right either way.
    refreshTrackerRowAfterBonusWrite_(resolved);
    refreshTrackerRowAfterBonusWrite_(original);
    if (!clearResult.ok) {
      GasLogger.log('checkinWebapp.bonusEdit.clearFailed', {
        f3Name: resolved.canonicalName, oldRowIndex: located, newRowIndex: addResult.rowIndex, error: clearResult.error,
      });
    }
    // F3Go30-ilqx AC2: movedMonths is explicit true/false on every outcome log (rather than
    // present-only-when-true) so a query never has to infer the same-month case from absence.
    GasLogger.log('checkinWebapp.bonusEdit', {
      f3Name: resolved.canonicalName, rowIndex: addResult.rowIndex, movedMonths: true,
    });
    // F3Go30-786l: addBonusEntry_ now always sets `duplicate` (log-only signal for bonusAdd) —
    // strip it here too so bonusEdit's own response shape stays exactly what it was.
    delete addResult.duplicate;
    return addResult;
  }

  // Same month: exactly one identity resolution, same as before the cross-month fix existed.
  var resolvedSame = resolveBonusSheet_(templateSpreadsheet, payload, payload.whenIso);
  if (resolvedSame.error) return { ok: false, error: resolvedSame.error };

  var result = editBonusEntry_dw_(resolvedSame.bonusSheet, resolvedSame.canonicalName, payload.rowIndex, payload, originalSnapshot);
  if (result.ok) {
    refreshTrackerRowAfterBonusWrite_(resolvedSame);
    GasLogger.log('checkinWebapp.bonusEdit', { f3Name: resolvedSame.canonicalName, rowIndex: result.rowIndex, movedMonths: false });
  }
  return result;
}

// Averaging period (the N in the trailing N-day mean) — not the same thing as how many days of
// that averaged trend the client displays at once (static-pages/src/index.html's DISPLAY_WINDOW_DAYS_).
// 7 days matches Go30's natural weekly cadence (most PAX have a weekday-AO/weekend-gap
// pattern) — responsive enough to show a real trend shift within days, without being so short
// a single missed day swings it, and without being so long (14, 30) that it's still "warming
// up" for most of a program that only runs ~30 days.
var ROLLING_AVERAGE_WINDOW_DAYS_ = 7;

var MAX_STREAK_WINDOW_DAYS_ = 30;

// Mirrors static-pages/src/index.html's DISPLAY_WINDOW_DAYS_ (kept in sync manually — client-only display
// concern, not worth threading through a shared config just for one constant) — how many
// trailing days getPriorMonthTailValues_ needs to hand back so the rolling-average *chart*
// (bars + line), not just the averaged value, can pad its display window across a month
// boundary the same way the average itself already does.
var DASHBOARD_DISPLAY_WINDOW_DAYS_ = 14;

// F3Go30-nhge.1: first index where a PAX has a genuine check-in day (present, 1, or missed, 0)
// — used to anchor the score %% denominator so a mid-month joiner isn't penalized for days
// before they were enrolled. Only matches 1/0; a leading -1 (explicit absence) does not anchor.
function firstActiveDayIndex_(dayValues) {
  for (var i = 0; i < dayValues.length; i++) {
    if (dayValues[i] === 1 || dayValues[i] === 0) return i;
  }
  return -1;
}

// F3Go30-h8tt: rawScore/score computed from already-cutoff-limited data (dayValues only holds
// day columns at or before reportedCutoff — see handleCheckinDashboard_), NOT read from the
// Tracker sheet's own Raw Score/Score cells (cols G/H). Those sheet formulas
// (=SUMIF(...,I4:AS4) / =SUM($I4:$AS4), docs/sheet-reference.md) sum every day column in the
// row with no date cutoff at all, so a PAX who pre-marks a future calendar day 1 would otherwise
// get an inflated score on the dashboard/leaderboard the moment that cell is written, even though
// the day-grid still (correctly) shows that day as upcoming.
function computeRawScoreFromDayValues_(dayValues) {
  return (dayValues || []).reduce(function(count, v) { return v === 1 ? count + 1 : count; }, 0);
}

// F3Go30-h8tt: total bonus points as of the last reported day — sums the same per-type pill
// totals (bonusByType) already computed cutoff-consistently by computeBonusSeriesForPax_dw_
// (BonusTypes.js), rather than re-deriving bonus-crediting/weekly-cap logic a second time here.
function sumBonusPillValues_(bonusPills) {
  var pills = bonusPills || {};
  return Object.keys(pills).reduce(function(sum, key) { return sum + (pills[key] || 0); }, 0);
}

function buildDashboardPaxRow_(name, team, score, rawScore, streak, dayValues, totalDays, currentDay, bonusByType, historyValues) {
  var firstActiveIdx = firstActiveDayIndex_(dayValues);
  var denom = firstActiveIdx === -1 ? 0 : (currentDay - firstActiveIdx);
  // F3Go30-uz9e.1: same historyValues (PaxCache's f3Name-keyed rolling window, spans the month
  // boundary) already used for maxStreak30 below, now also driving rollingAverage — its leading
  // points are computed against the real prior-month tail instead of truncating at day 1 of the
  // month.
  //
  // F3Go30-uz9e.2: averaged over the prior-month LEAD plus the full dayValues, not over
  // historyValues alone. historyValues is capped at MAX_STREAK_WINDOW_DAYS_ (30), which is SHORTER
  // than a 31-day month and shorter still than a prior-month date-nav view — averaging over it and
  // then slicing produced a rollingAverage with fewer entries than dayValues, silently breaking
  // the 1:1 alignment with dayValues/dayDates that both server and client assume. Splitting the
  // window at the overlap keeps every day of the viewed month represented, with whatever
  // cross-month lead is available in front of it.
  var historyForPadding = historyValues || [];
  var overlapWithMonth = Math.min(historyForPadding.length, dayValues.length);
  var priorMonthLead = historyForPadding.slice(0, historyForPadding.length - overlapWithMonth);
  var averagedHistory = buildRollingAverage_(priorMonthLead.concat(dayValues), ROLLING_AVERAGE_WINDOW_DAYS_);
  // F3Go30-uz9e.1: the prior-month tail of historyValues, same source userRollingAverage's
  // padding used to be built from viewer-only — every board row gets it now, so the pax-detail
  // popup's chart can pad its display window across a month boundary for ANY teammate, not just
  // the logged-in viewer (renderPaxDetail_, static-pages/src/index.html).
  var priorMonthDayValues = priorMonthLead.slice(-(DASHBOARD_DISPLAY_WINDOW_DAYS_ - 1));
  return {
    name: name,
    team: team,
    score: score,
    rawScore: rawScore,
    streak: streak,
    // F3Go30-5uk2: windowed across the month boundary via historyValues (PaxCache's f3Name-keyed
    // rolling window) when the caller has it — falls back to dayValues (this month only) for any
    // caller that doesn't, e.g. a unit test exercising this function directly.
    maxStreak30: computeMaxStreak_(historyValues || dayValues, MAX_STREAK_WINDOW_DAYS_),
    scorePct: denom ? Math.round((score / denom) * 100) : (score >= 0 ? 100 : 0),
    dayValues: dayValues,
    daySegments: buildDaySegments_(dayValues, totalDays),
    // F3Go30-3uvp: the series stops at the last REPORTED day, not at dayValues.length — a
    // pending trailing day still has no real value to plot, and continuing the window past it
    // let an old value age out with zero new check-in activity, making the line visibly rise
    // on no data. Shorter than dayValues on purpose: the client only draws points for entries
    // that exist, so the line ends before the pending days rather than flattening into them.
    rollingAverage: dayValues.length
      ? averagedHistory.slice(averagedHistory.length - dayValues.length).slice(0, lastReportedDayCount_(dayValues))
      : [],
    priorMonthDayValues: priorMonthDayValues,
    // F3Go30-y55y: per-PAX, same as score/streak — every board tile gets its own bonus totals,
    // not just the logged-in PAX's own stat area. Callers pass the date-scoped/capped result of
    // computeBonusPillsAsOf_, not a raw Tracker column read; the all-zero default below covers
    // a caller that omits this (e.g. a row with no Bonus Tracker entries at all).
    bonusByType: bonusByType || emptyBonusPills_dw_(),
  };
}

/**
 * Trailing dayValues for f3Name, spanning any month boundary — the cross-month read side of
 * F3Go30-5uk2's PaxCache history window, used for EVERY board row (buildDashboardPaxRow_'s
 * caller, below), not just the logged-in viewer.
 *
 * Length is whatever the stored window holds, up to PAX_HISTORY_WINDOW_DAYS_; a rebuild fills it
 * back to the start of the prior month (PAX_HISTORY_BACKFILL_DAYS_). Callers that want a bounded
 * streak pass MAX_STREAK_WINDOW_DAYS_ to computeStreak_/computeMaxStreak_ — the window length and
 * the displayed streak cap are independent (F3Go30-uz9e.3).
 *
 * Cache hit: decodes the stored dense days string straight into the same 1/0/-1/'' shape
 * computeStreak_/computeMaxStreak_ already expect from a live Tracker dayValues array.
 *
 * Cache miss (a PAX with no rolling-window entry yet — first read after this shipped): self-heals
 * once by falling back to the same computation the old viewer-only override used — this month's
 * own dayValues plus getPriorMonthTailValues_'s prior-month tail — then persists the windowed
 * result under the new f3Name-only key so every subsequent read is a plain cache hit.
 * @param {string} f3Name
 * @param {Array} currentMonthDayValues This month's reported day values, in column order.
 * @param {Object} monthInfo Resolved month (see resolveDashboardMonth_).
 * @param {Spreadsheet} templateSpreadsheet
 * Anchored and reconciled on read (F3Go30-uz9e.2). Two things a raw cache hit can't promise:
 *   - It ends where the CALLER says the world ends. A stored window ends wherever its last write
 *     left it (anchorPaxHistoryValues_, PaxCache.js) — ahead of the anchor if the PAX pre-marked a
 *     future day, behind it if nothing has been written for a few days, a different month
 *     entirely under date navigation. The caller tail-aligns the result against dayValues, so any
 *     difference silently shifts every day in the window.
 *   - It agrees with the Tracker. go30hist and the tracker-kind PaxCache row are two
 *     representations of the same day values, written by two independent write-through calls with
 *     nothing reconciling them — a manual sheet edit, a tracker regeneration, or an import lands
 *     on one and not the other, and a wrong entry never self-heals (the miss path only fires on a
 *     MISSING entry). The Tracker row is already in hand (identity.trackerValues is fetched
 *     regardless), so checking the overlapping tail against it is free.
 * Either check failing falls through to the same rebuild-from-sheet path a cold start takes.
 *
 * @param {string} anchorIso "YYYY-MM-DD" the returned window must END on — the date of the last
 *   reported day column (dayDates[dayDates.length - 1]), NOT reportedCutoff. reportedCutoff stays
 *   at today when navigating BACKWARD (viewDate > realToday ? viewDate : realToday), so using it
 *   would leave a June view in August anchored in August.
 * @param {Object=} entriesByNormName Prefetched entries from getPaxHistoryEntriesBulk_ (one
 *   PropertiesService round trip for the whole roster). Omit to look this PAX up individually.
 * @param {{count:number, ms:number}=} backfillStats F3Go30-kyyy: when supplied, incremented by one
 *   invocation and the elapsed ms every time this call falls through to getPriorMonthTailValues_ —
 *   the per-load counters the checkinWebapp.dashboard event reports. Omit for callers (tests,
 *   other call sites) that don't need the count.
 * @returns {Array} Trailing day values (up to the stored window's length, or fewer early in the
 *   program), ending on anchorIso.
 */
function getPaxHistoryWindowValues_(f3Name, currentMonthDayValues, monthInfo, templateSpreadsheet, anchorIso, entriesByNormName, backfillStats, priorMonthContext) {
  var scopeId = paxHistoryScopeId_dw_(templateSpreadsheet);
  var entry = entriesByNormName
    ? (entriesByNormName[paxCacheNormalizeName_dw_(f3Name)] || null)
    : (getPaxHistoryEntry_dw_ ? getPaxHistoryEntry_dw_(scopeId, f3Name) : null);
  var anchored = anchorPaxHistoryValues_dw_ ? anchorPaxHistoryValues_dw_(entry, anchorIso) : null;
  // F3Go30-uz9e.3: the WHOLE stored window is returned, not a 30-day slice of it. Its leading
  // (prior-month) portion is what rollingAverage and priorMonthDayValues are built from; the
  // 30-day streak cap is applied by computeStreak_/computeMaxStreak_ at the point of use.
  // F3Go30-b6jy: agreement alone isn't enough — a window truncated to the current month (e.g. by
  // month rollover) agrees with the Tracker row trivially, since there's nothing outside the
  // overlap left to disagree. Coverage checks the part agreement can't see: whether the window
  // actually reaches back before this month's first reported day (its "lead"). No lead means the
  // 14-day average and cross-month streak the caller wants have nothing behind them, so this is
  // the same as a miss and must fall through to the backfill below.
  if (anchored && paxHistoryWindowMatchesTracker_(anchored, currentMonthDayValues)
      && paxHistoryWindowHasCoverage_(anchored, currentMonthDayValues)) {
    return anchored;
  }

  var tBackfill0 = backfillStats ? Date.now() : 0;
  // F3Go30-xzm2: the prior month itself (which month, its layout, its rows) is resolved once per
  // request — passed in here by a caller that already holds it, or taken from the per-execution
  // memo getPriorMonthTailContext_ keeps (same object either way; see its block comment in
  // dashboardIdentity.js). What stays per-PAX is only this PAX's row lookup.
  var tail = getPriorMonthTailValues_(monthInfo, f3Name, PAX_HISTORY_BACKFILL_DAYS_dw_, templateSpreadsheet,
    priorMonthContext || getPriorMonthTailContext_(monthInfo, templateSpreadsheet));
  if (backfillStats) {
    backfillStats.count++;
    backfillStats.ms += Date.now() - tBackfill0;
  }
  // No trailing-blank trim: the combined array ends on anchorIso by construction
  // (currentMonthDayValues is the reported day columns, whose last one IS the anchor), and that
  // is exactly what makes the stamped historyEndDate below true.
  var windowed = tail.concat(currentMonthDayValues || []).slice(-PAX_HISTORY_BACKFILL_DAYS_dw_);
  // Don't clobber a live window with an older-anchored rebuild — a backward date-nav read
  // legitimately computes a prior month's window, but that must not become the stored one.
  var wouldRegress = entry && entry.historyEndDate && paxHistoryDayDiff_dw_(entry.historyEndDate, anchorIso) < 0;
  if (windowed.length && !wouldRegress && setPaxHistoryEntry_dw_ && paxHistoryEncodeValue_dw_) {
    var days = windowed.map(paxHistoryEncodeValue_dw_).join('');
    // A roster row with nothing reported yet encodes to all-'.' — storing that would put one
    // Script Property per never-active PAX in a 500KB store to say "no data", which the miss path
    // already says for free.
    if (/[^.]/.test(days)) {
      var rebuilt = { historyEndDate: anchorIso, days: days };
      setPaxHistoryEntry_dw_(scopeId, f3Name, rebuilt);
      if (entriesByNormName) entriesByNormName[paxCacheNormalizeName_dw_(f3Name)] = rebuilt;
    }
  }
  return windowed;
}

/** Normalizes a day cell (Tracker) or decoded window character to one comparable value —
 *  a blank cell and a never-observed '.' day are both "no data". */
function paxHistoryComparableDayValue_(value) {
  if (value === 1) return 1;
  if (value === 0) return 0;
  if (value === -1) return -1;
  return '';
}

/**
 * True when the anchored window agrees with the Tracker row everywhere the two overlap. Both end
 * on the same day (the anchor), so the comparison walks backward from the tail of each.
 */
function paxHistoryWindowMatchesTracker_(historyValues, currentMonthDayValues) {
  var dayValues = currentMonthDayValues || [];
  var overlap = Math.min(historyValues.length, dayValues.length);
  for (var i = 1; i <= overlap; i++) {
    var fromWindow = paxHistoryComparableDayValue_(historyValues[historyValues.length - i]);
    var fromSheet = paxHistoryComparableDayValue_(dayValues[dayValues.length - i]);
    if (fromWindow !== fromSheet) return false;
  }
  return true;
}

/**
 * True when the window's lead (F3Go30-b6jy) — the part preceding currentMonthDayValues — is
 * non-empty. Both arrays are tail-aligned to the same anchor day, so any excess length on the
 * window side is days it holds that the Tracker row can't supply, i.e. days before this month's
 * first reported column. A window no longer than the Tracker row's own reported days has nothing
 * before month start to serve a 14-day average or a cross-month streak with, agreement or not.
 */
function paxHistoryWindowHasCoverage_(historyValues, currentMonthDayValues) {
  var dayValues = currentMonthDayValues || [];
  return historyValues.length > dayValues.length;
}

function _dashboardIsoDate_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Parses a "YYYY-MM-DD" string as a local-midnight Date, matching the client's parseIsoDate_
 * (static-pages/src/index.html). The native `new Date("YYYY-MM-DD")` constructor parses date-only strings
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
  // F3Go30-xzm2: the prior-month backfill context is memoized for the duration of ONE request
  // (dashboardIdentity.js). Dropping it here is what makes "request-scoped" true rather than
  // "execution-scoped": nothing this handler reads can be served from a memo populated before a
  // write earlier in the same execution.
  if (resetPriorMonthTailContextMemo_) resetPriorMonthTailContextMemo_();
  var realToday = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  var viewDate = payload.dateISO ? parseIsoDateLocal_(payload.dateISO) : new Date(realToday);
  if (isNaN(viewDate.getTime())) viewDate = new Date(realToday);

  // Fast path (F3Go30-qi26.1): an echoed resolved-context handle lets us skip resolveDashboard
  // Month_'s TrackerDB scan (reconstruct monthInfo from the handle) + the Responses re-lookup
  // (resolveFullIdentityFromHandle_ takes the PAX's rowIndex straight from the handle). Guarded to
  // the handle's own month only — the requested day must fall in it (a plain YYYY-MM compare,
  // since trackers are per calendar month). Date-nav into any other month, or a month rollover
  // since identify (default view's today is now a new month), fails that compare and re-resolves
  // from the date; a roster edit that stales the rowIndex makes resolveFullIdentityFromHandle_
  // return null, also falling back. Neither is a user-visible error.
  var handle = payload.resolvedContext;
  var useHandle = !!(handle && handle.monthKey && String(payload.dateISO || '').slice(0, 7) === handle.monthKey);

  var tFast = Date.now();
  var monthInfo = useHandle ? monthInfoFromHandle_(handle) : null;
  var identity = monthInfo ? resolveFullIdentityFromHandle_(handle) : null;
  var resolveMonthMs = 0;
  var resolveIdentityMs = identity ? Date.now() - tFast : 0;
  if (!identity) {
    // Handle absent, out-of-month, or stale — authoritative date-based month resolution + full lookup.
    var t1 = Date.now();
    monthInfo = resolveDashboardMonth_(viewDate, templateSpreadsheet);
    resolveMonthMs = Date.now() - t1;
    if (!monthInfo) return { ok: false, error: 'no_tracker_for_date' };
    var t2 = Date.now();
    identity = resolveCheckinIdentityFull_(monthInfo, payload.f3Name, payload.email, null);
    resolveIdentityMs = Date.now() - t2;
  }
  if (!identity.matched) {
    // Distinct from the no_tracker_for_date miss above: a tracker exists for this date, but the
    // viewing PAX has no row in it (e.g. date-nav into a month they weren't registered in, or
    // previewing a just-opened next month's roster before signing up — F3Go30-awhw). The success
    // path logs checkinWebapp.dashboard at the end; without this the miss leaves zero Axiom
    // trace. Warn with enough context (identity, resolved month) to diagnose.
    GasLogger.log('checkinWebapp.dashboard.identityMiss', {
      f3Name: payload.f3Name, monthLabel: monthInfo.label,
      monthKey: _dashboardIsoDate_(monthInfo.startDate).slice(0, 7),
      boardOnly: !!identity.trackerValues,
    });
    // F3Go30-csfe.1: no roster at all (Tracker itself unreadable) is still a hard miss — nothing
    // to render under any perspective. A readable roster with no row for THIS viewer degrades to
    // a board-only view (registered:false) below instead of failing the whole load.
    if (!identity.trackerValues) return { ok: false, error: 'not_found' };
  }

  // F3Go30-bopt: checkpoint marking the end of identity/month resolution — everything below is
  // the "render step" that finding #4 (bd memories F3Go30-perf-checkin-dashboard-eval) found
  // unexplained (25-30s of totalMs not accounted for by resolveMonthMs+resolveIdentityMs).
  var tRenderStart = Date.now();

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
  // Cache-first (F3Go30-440b.6): only opens the spreadsheet to fetch the Bonus Tracker sheet on
  // a genuine cache miss — a fully warm dashboard load (identity + tracker roster + bonus
  // entries all cached) never calls SpreadsheetApp.openById at all.
  var tBonus0 = Date.now();
  var bonusEntries = getCachedBonusEntriesOnly_dw_ ? getCachedBonusEntriesOnly_dw_(monthInfo.sheetId) : null;
  var bonusCacheHit = bonusEntries !== null;
  if (bonusEntries === null) {
    var bonusSheet = identity.targetSs.get().getSheetByName('Bonus Tracker');
    bonusEntries = bonusSheet ? getAllBonusEntriesCached_dw_(bonusSheet, monthInfo.sheetId) : [];
  }
  var bonusEntriesMs = Date.now() - tBonus0;
  var reportedDayDates = reportedDayCols.map(function(d) { return d.date; });

  // F3Go30-uz9e.2: the day every figure on this load is computed "as of" — the last reported day
  // column, which for the current month is today and for a prior-month view is that month's last
  // day. NOT reportedCutoffIso, which stays at today when navigating backward (see
  // getPaxHistoryWindowValues_). dayDates is empty only for a month whose first day hasn't been
  // reached yet; fall back to the cutoff there so the anchor is never undefined.
  var historyAnchorIso = dayDates.length ? dayDates[dayDates.length - 1] : _dashboardIsoDate_(reportedCutoff);
  // One PropertiesService round trip for the whole roster's history entries instead of one
  // getProperty per row inside the loop below (F3Go30-uz9e.2) — same reasoning as
  // getPaxCacheRowsBulk_ for the tracker rows.
  var tHistory0 = Date.now();
  var historyEntries = getPaxHistoryEntriesBulk_dw_
    ? getPaxHistoryEntriesBulk_dw_(paxHistoryScopeId_dw_(templateSpreadsheet), identity.trackerValues.map(function(row) { return row[TRACKER_NAME_COL_]; }))
    : null;
  var historyEntriesMs = Date.now() - tHistory0;
  var tRosterLoop0 = Date.now();
  // F3Go30-kyyy: per-load count/duration of getPaxHistoryWindowValues_ calls that fall through to
  // the prior-month backfill — the mechanism behind rollover latency (§prior-month-bulk), measured
  // here so the fix in that stage has a before/after number to check against.
  var backfillStats = { count: 0, ms: 0 };
  // F3Go30-ja7d: bucket the month's bonus entries by nameNorm ONCE (O(entries)) instead of letting
  // each PAX-day re-filter the whole array. Deliberately inside the rosterLoopMs window so the
  // telemetry keeps measuring the full cost of this work rather than showing a drop that only
  // moved the cost outside the timer.
  var bonusEntriesByPax = groupBonusEntriesByPax_dw_(bonusEntries);
  var allPaxRows = [];
  var userRow = null;
  identity.trackerValues.forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    if (!String(name || '').trim()) return;
    var dayValues = reportedDayCols.map(function(d) { return row[d.col]; });
    // F3Go30-5uk2/uz9e.1: cross-month streak/maxStreak30/rollingAverage for EVERY row
    // (myTeam/paxBoard), not just the logged-in viewer — see getPaxHistoryWindowValues_.
    var historyValues = getPaxHistoryWindowValues_(name, dayValues, monthInfo, templateSpreadsheet, historyAnchorIso, historyEntries, backfillStats);
    var bonusSeries = computeBonusSeriesForPax_dw_(bonusEntriesByPax[paxCacheNormalizeName_dw_(name)] || [], reportedDayDates, monthInfo.startDate);
    var currentBonusPills = bonusSeries[bonusSeries.length - 1];
    // F3Go30-h8tt: rawScore/score are computed here from the already-cutoff-limited dayValues +
    // bonusPills, NOT read from row[TRACKER_RAW_SCORE_COL_]/row[TRACKER_SCORE_COL_] — see
    // computeRawScoreFromDayValues_'s comment for why the sheet's own cells can't be trusted.
    var rawScore = computeRawScoreFromDayValues_(dayValues);
    var score = rawScore + sumBonusPillValues_(currentBonusPills);
    var paxRow = buildDashboardPaxRow_(
      name,
      row[TRACKER_TEAM_COL_],
      score,
      rawScore,
      computeStreak_(historyValues, MAX_STREAK_WINDOW_DAYS_),
      dayValues,
      totalDays,
      currentDay,
      currentBonusPills,
      historyValues
    );
    paxRow.bonusByTypeSeries = bonusSeries;
    allPaxRows.push(paxRow);
    if (idx === identity.rowIndex) { userRow = paxRow; }
  });
  var rosterLoopMs = Date.now() - tRosterLoop0;

  // F3Go30-csfe.1: identity.matched is false for a board-only view (viewer has no row in this
  // month — e.g. previewing next month's roster before registering). Every field below reads
  // identity.rowIndex/userRow, neither of which exist in that case — skip straight to the
  // team/board data, which the roster loop above already built independent of the viewer's own
  // identity.
  var userDayValues = null, outcomes = null, bonusByType = null, userBonusByTypeSeries = null;
  var userRollingAverage = null, priorMonthTail = null, userStreak = null, userMaxStreak30 = null;
  var myTeamMembers = null;
  if (identity.matched) {
    userDayValues = reportedDayCols.map(function(d) { return identity.trackerValues[identity.rowIndex][d.col]; });
    outcomes = countOutcomes_(userDayValues);
    bonusByType = userRow.bonusByType;
    userBonusByTypeSeries = userRow.bonusByTypeSeries;

    // F3Go30-uz9e.1: userRow's rollingAverage and priorMonthDayValues (built inside the roster
    // loop above, from the same historyValues-sourced computation every other row now gets too)
    // already span the month boundary — no separate override/getPriorMonthTailValues_ call
    // needed here anymore (that used to run a second, potentially cache-missing lookup for the
    // viewer alone).
    userRollingAverage = userRow.rollingAverage;
    priorMonthTail = userRow.priorMonthDayValues;

    // F3Go30-5uk2: userRow (built inside the roster loop above) already carries a cross-month
    // streak/maxStreak30 via getPaxHistoryWindowValues_ — the same PaxCache history window used
    // for every other board row, so the viewer no longer needs a separate override computation.
    userStreak = userRow.streak;
    userMaxStreak30 = userRow.maxStreak30;

    var userTeam = String(identity.trackerValues[identity.rowIndex][TRACKER_TEAM_COL_] || '').trim().toLowerCase();
    myTeamMembers = allPaxRows.filter(function(r) { return String(r.team || '').trim().toLowerCase() === userTeam; })
      .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
  }

  var paxBoard = groupByTeam_(allPaxRows);

  // F3Go30-bopt: renderMs (tRenderStart to here) is the previously-unmeasured 25-30s gap from
  // finding #4 — bonusEntriesMs/historyEntriesMs/rosterLoopMs split it further so a future spike
  // points at a specific sub-step rather than "somewhere in render" again.
  GasLogger.log('checkinWebapp.dashboard', Object.assign({
    f3Name: payload.f3Name, currentDay: currentDay, totalDays: totalDays, viewDayIndex: viewDayIndex,
    paxRows: allPaxRows.length, resolveMonthMs: resolveMonthMs, resolveIdentityMs: resolveIdentityMs,
    renderMs: Date.now() - tRenderStart, bonusEntriesMs: bonusEntriesMs, bonusCacheHit: bonusCacheHit,
    historyEntriesMs: historyEntriesMs, rosterLoopMs: rosterLoopMs,
    trackerFromCache: !!identity.trackerFromCache,
    historyBackfillCount: backfillStats.count, historyBackfillMs: backfillStats.ms,
    totalMs: Date.now() - t0,
    // F3Go30-xzm2: priorMonthResolves/priorMonthOpens are the hoist's own evidence — both stay at
    // most 1 per request no matter how many PAX need a backfill (they were one per backfilling PAX
    // before). A value above 1 means something re-entered the loop's month resolution.
  }, priorMonthTailStatsForLog_ ? priorMonthTailStatsForLog_() : {}, paxCacheStatsForLog_dw_(), scriptPropertiesStatsForLog_dw_()));

  var result = {
    ok: true,
    registered: identity.matched,
    f3Name: identity.matched ? userRow.name : payload.f3Name,
    monthLabel: monthInfo.label,
    monthKey: _dashboardIsoDate_(monthInfo.startDate).slice(0, 7),
    trackerUrl: monthInfo.trackerUrl,
    currentDay: currentDay,
    totalDays: totalDays,
    dayDates: dayDates,
    viewDayIndex: viewDayIndex,
    viewDate: dayDates[viewDayIndex] || null,
    paxBoard: paxBoard,
  };
  // F3Go30-csfe.1: everything below is the viewer's own "you" panel — meaningless (and its
  // inputs, e.g. userRow, don't exist) when registered is false. A board-only view carries the
  // team data above and nothing else.
  if (identity.matched) {
    result.team = userRow.team;
    result.streak = userStreak;
    result.maxStreak30 = userMaxStreak30;
    result.score = userRow.score;
    result.rawScore = userRow.rawScore;
    result.scorePct = userRow.scorePct;
    result.dayValues = userDayValues;
    result.daySegments = userRow.daySegments;
    result.rollingAverage = userRollingAverage;
    // Trailing raw values (0/1/-1) from the end of the previous month's tracker, up to
    // DASHBOARD_DISPLAY_WINDOW_DAYS_-1 of them — lets the client pad the rolling-average
    // chart's display window across a month boundary the same way userRollingAverage's own
    // averaging already does, instead of showing a sparse few-point chart on early-month days.
    result.priorMonthDayValues = priorMonthTail;
    result.done = outcomes.done;
    result.missed = outcomes.missed;
    result.absent = outcomes.absent;
    result.bonusByType = bonusByType;
    // One bonusByType per reported day, aligned with dayDates — lets the client scrub the
    // date-nav arrows and show pills accurate to that day (F3Go30-y55y follow-up) instead of
    // always showing today's month-to-date totals.
    result.bonusByTypeSeries = userBonusByTypeSeries;
    result.myTeam = myTeamMembers;
  }
  return result;
}

/**
 * cmd=checkin `paxGoals` action (F3Go30 pax-detail popup): on-demand WHO/WHAT/HOW for a single
 * teammate, looked up by name — the dashboard payload's myTeam/paxBoard rows deliberately don't
 * carry goals (that would mean a per-PAX Responses row read for the *entire* roster on every
 * dashboard load, most of which are never clicked into), so the pax-detail popup fetches just the
 * one row it needs, right when a PAX taps a tile/board row to open it.
 *
 * Reuses the viewer's own resolvedContext handle for month resolution only (same fast path as
 * handleCheckinDashboard_) — the handle's rowIndex/f3Name belong to the *viewer*, not the target
 * pax, so identity itself always goes through resolveCheckinIdentityLean_(needGoals=true) rather
 * than any handle-based shortcut.
 *
 * F3Go30-uz9e.4 (PAX data model migration Slice 2): `monthKey` ("YYYY-MM") is an additive,
 * optional param for point-in-time goal reporting — a PAX's goals as of a specific past month, not
 * just "current." An installed client that never sends it keeps getting current-month goals
 * exactly as before (this repo's installed-client compatibility rule,
 * docs/OPERATIONS.md §API compatibility with installed clients). When given, it also selects which
 * month's tracker `monthInfo` resolves to, so the Responses-row fallback below reads the SAME
 * month's Responses sheet the goals record miss would otherwise be silently misaligned against.
 * Goals-record lookup is a fast-path cache check ahead of the existing Responses-row fetch
 * (§3.2's contract-impact note) — a miss falls through to Responses exactly as it always has
 * (invariant 8, §4: a missing cache entry is a miss, never rendered as an empty goals set).
 */
function handlePaxGoals_(templateSpreadsheet, payload) {
  var targetName = payload.f3Name;
  if (!targetName) return { ok: false, error: 'missing_f3Name' };

  var realToday = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  var viewDate = payload.dateISO ? parseIsoDateLocal_(payload.dateISO) : new Date(realToday);
  if (isNaN(viewDate.getTime())) viewDate = new Date(realToday);

  var handle = payload.resolvedContext;
  // F3Go30-uz9e.4 code review: an explicit payload.monthKey must win over the handle fast path —
  // the handle only ever describes the VIEWER's current month (see docstring above), so honoring
  // it unconditionally here silently ignored a requested past monthKey whenever the caller (the
  // normal case — every dashboard/checkin request echoes resolvedContext) happened to already
  // have a handle for the current month, defeating the whole point of point-in-time reporting.
  var monthInfo = (handle && handle.monthKey && (payload.monthKey || String(payload.dateISO || '').slice(0, 7)) === handle.monthKey)
    ? monthInfoFromHandle_(handle)
    : null;
  if (!monthInfo && payload.monthKey) {
    monthInfo = resolveDashboardMonth_(parseIsoDateLocal_(payload.monthKey + '-01'), templateSpreadsheet);
  }
  if (!monthInfo) monthInfo = resolveDashboardMonth_(viewDate, templateSpreadsheet);
  if (!monthInfo) return { ok: false, error: 'no_tracker_for_date' };

  var monthKey = payload.monthKey || _dashboardIsoDate_(monthInfo.startDate).slice(0, 7);

  if (getPaxGoalsForMonth_dw_) {
    var scopeId = paxHistoryScopeId_dw_(templateSpreadsheet);
    var cachedGoals = getPaxGoalsForMonth_dw_(scopeId, targetName, monthKey);
    if (cachedGoals) {
      GasLogger.log('checkinWebapp.paxDetail', { f3Name: targetName, viewerF3Name: handle && handle.f3Name, monthKey: monthKey, source: 'paxGoalsRecord' });
      return { ok: true, f3Name: targetName, goals: cachedGoals };
    }
  }

  var identity = resolveCheckinIdentityLean_(monthInfo, targetName, null, {}, true);
  if (!identity.matched) return { ok: false, error: 'not_found' };

  // Viewer identity comes only from the echoed resolvedContext handle (never re-resolved here) —
  // a stale/missing handle just means "viewer unknown" in the log, not a hard failure, since this
  // action's whole job is fetching the *target* pax's goals, not re-authenticating the viewer.
  GasLogger.log('checkinWebapp.paxDetail', { f3Name: targetName, viewerF3Name: handle && handle.f3Name, monthKey: monthKey, source: 'responses' });

  return { ok: true, f3Name: targetName, goals: identity.goals };
}

/**
 * cmd=checkin `monthGrid` action (F3Go30-k5fn.1): the whole-month calendar for an arbitrary
 * month, keyed by either an explicit monthKey ("YYYY-MM") or a date falling within it — the
 * static calendar's month-to-month navigation arrows use this to fetch a month identify's own
 * monthGrid didn't already cover, without re-running full identify.
 *
 * Delegates month resolution to resolveDashboardMonth_ (TrackerDB scan for whatever month the
 * target date/monthKey falls in), the PAX's row offset to resolvePaxRowIndex_ (PaxCache.js —
 * same roster-index cache every other Tracker row lookup in this file uses), and the day-by-day
 * payload to buildMonthGridEntries_ (F3Go30-th22) — no reimplementation of any of the three.
 *
 * A month with no TrackerDB entry is a hard error (no_tracker_for_date); a month that DOES have a
 * tracker but where this PAX has no row is not — it's a normal, expected state for date-nav into
 * a month before this PAX signed up (registered:false, empty monthGrid), not an error response.
 */
function handleMonthGrid_(templateSpreadsheet, payload) {
  var t0 = Date.now();
  var f3Name = payload.f3Name;
  var targetDate;
  if (payload.monthKey) {
    targetDate = parseIsoDateLocal_(payload.monthKey + '-01');
  } else if (payload.date) {
    targetDate = parseIsoDateLocal_(payload.date);
  } else {
    targetDate = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  }
  if (isNaN(targetDate.getTime())) return { ok: false, error: 'invalid_date' };

  var monthInfo = resolveDashboardMonth_(targetDate, templateSpreadsheet);
  if (!monthInfo) return { ok: false, error: 'no_tracker_for_date' };

  var monthKey = _dashboardIsoDate_(monthInfo.startDate).slice(0, 7);
  var monthLabel = monthInfo.label;

  var trackerSheet = SpreadsheetApp.openById(monthInfo.sheetId).getSheetByName('Tracker');
  if (!trackerSheet || trackerSheet.getLastRow() < 4) return { ok: false, error: 'no_tracker_for_date' };

  var layout = getTrackerLayout_(trackerSheet, monthInfo.sheetId);
  var classified = classifyTrackerColumns_(layout.row2, layout.row3);

  var rowIndex = resolvePaxRowIndex_dw_('tracker', monthInfo.sheetId, f3Name, function() {
    var lastRow = trackerSheet.getLastRow();
    return trackerSheet.getRange(4, 1, lastRow - 3, 1).getValues().map(function(r) { return r[0]; });
  });

  var notRegistered = {
    ok: true, monthKey: monthKey, monthLabel: monthLabel,
    monthGrid: [], registered: false, trackerUrl: monthInfo.trackerUrl,
  };
  if (rowIndex === -1) {
    GasLogger.log('checkinWebapp.monthGrid.result', { registered: false, monthKey: monthKey, durationMs: Date.now() - t0 });
    return notRegistered;
  }

  // "Registered" mirrors resolveCheckinIdentityLean_'s definition — a live (non-DELETED)
  // Responses row, not merely a Tracker row — so a PAX whose signup was deleted (ADR-008
  // email-change convention) can't get registered:true / a full monthGrid here just because a
  // stale Tracker row hasn't been cleaned up yet (Copilot review, F3Go30-9jsa PR#4 follow-up).
  var responsesLayoutForGrid = getCachedResponsesLayoutOnly_(monthInfo.sheetId);
  var responsesSheetForGrid = null;
  function responsesSheetForGrid_() {
    if (!responsesSheetForGrid) responsesSheetForGrid = SpreadsheetApp.openById(monthInfo.sheetId).getSheetByName('Responses');
    return responsesSheetForGrid;
  }
  if (!responsesLayoutForGrid) {
    var rsForGrid = responsesSheetForGrid_();
    if (!rsForGrid) {
      // F3Go30-ilqx: this success (ok:true, notRegistered) return previously logged nothing at
      // all — no Responses sheet for the month is the same "not registered" outcome the two
      // rowIndex===-1 branches above already log, just reached by a different path.
      GasLogger.log('checkinWebapp.monthGrid.result', { registered: false, monthKey: monthKey, durationMs: Date.now() - t0 });
      return notRegistered;
    }
    responsesLayoutForGrid = getResponsesLayout_(rsForGrid, monthInfo.sheetId);
  }
  var responsesColumnsForGrid = responsesLayoutForGrid.columns;
  var responsesRowIndex = resolvePaxRowIndex_dw_('responses', monthInfo.sheetId, f3Name, function() {
    var rs = responsesSheetForGrid_();
    if (!rs) return [];
    var lastRow = rs.getLastRow();
    if (lastRow < 2) return [];
    var rows = rs.getRange(2, 1, lastRow - 1, rs.getLastColumn()).getValues();
    return rows.map(function(row) {
      return String(row[responsesColumnsForGrid.PARTICIPATION] || '').trim().toLowerCase() === 'deleted' ? '' : row[responsesColumnsForGrid.F3_NAME];
    });
  });
  if (responsesRowIndex === -1) {
    GasLogger.log('checkinWebapp.monthGrid.result', { registered: false, monthKey: monthKey, durationMs: Date.now() - t0 });
    return notRegistered;
  }

  var trackerRow = getPaxCacheRow_dw_('tracker', monthInfo.sheetId, f3Name);
  var freshRead = !trackerRow;
  if (freshRead) {
    trackerRow = trackerSheet.getRange(rowIndex + 4, 1, 1, trackerSheet.getLastColumn()).getValues()[0];
  }
  // Same stale-roster-index guard as every other rowIndex-derived Tracker read in this file
  // (F3Go30-a2hq) — a mismatch here means the cached index no longer agrees with the sheet, so
  // treat it exactly like "no row" rather than risk handing back (and caching) a different PAX's
  // month. Only cache once the row is confirmed to belong to f3Name (mirrors
  // resolveCheckinIdentityLean_).
  if (!trackerRowBelongsToPax_dw_(trackerRow, f3Name)) {
    purgeStaleTrackerBind_dw_(monthInfo.sheetId, f3Name);
    GasLogger.log('checkinWebapp.monthGrid.staleBind', { sheetId: monthInfo.sheetId, requested: f3Name });
    // F3Go30-ilqx: staleBind is a diagnostic for the stale-index case specifically — also emit
    // the generic outcome event every other success path gets, so a query for "how did monthGrid
    // resolve" never has to special-case this branch.
    GasLogger.log('checkinWebapp.monthGrid.result', { registered: false, monthKey: monthKey, durationMs: Date.now() - t0 });
    return notRegistered;
  }
  if (freshRead) {
    setPaxCacheRow_dw_('tracker', monthInfo.sheetId, f3Name, trackerRow);
  }

  GasLogger.log('checkinWebapp.monthGrid.result', { registered: true, monthKey: monthKey, durationMs: Date.now() - t0 });
  return {
    ok: true,
    monthKey: monthKey,
    monthLabel: monthLabel,
    monthGrid: buildMonthGridEntries_(classified.dayCols, trackerRow),
    registered: true,
    trackerUrl: monthInfo.trackerUrl,
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
    firstActiveDayIndex_: firstActiveDayIndex_,
    computeRawScoreFromDayValues_: computeRawScoreFromDayValues_,
    sumBonusPillValues_: sumBonusPillValues_,
    buildDashboardPaxRow_: buildDashboardPaxRow_,
    getPaxHistoryWindowValues_: getPaxHistoryWindowValues_,
    buildRosterFromTrackerValues_: buildRosterFromTrackerValues_,
    reloadPaxCacheForCurrentAndPriorMonth_: reloadPaxCacheForCurrentAndPriorMonth_,
    buildDaySegments_: buildDaySegments_,
    buildRollingAverage_: buildRollingAverage_,
    lastReportedDayCount_: lastReportedDayCount_,
    resolveCheckinDayTarget_: resolveCheckinDayTarget_,
    getCachedTrackerLayoutOnly_: getCachedTrackerLayoutOnly_,
    trackerLayoutCacheKey_: trackerLayoutCacheKey_,
    makeLazySpreadsheet_dw_: makeLazySpreadsheet_dw_,
    responsesLayoutCacheKey_: responsesLayoutCacheKey_,
    getCachedResponsesLayoutOnly_: getCachedResponsesLayoutOnly_,
    getResponsesLayout_: getResponsesLayout_,
    resolveCheckinIdentityLean_: resolveCheckinIdentityLean_,
    serializeRow3ForCache_: serializeRow3ForCache_,
    serializeSheetValuesForCache_: serializeSheetValuesForCache_,
    deserializeSheetValuesFromCache_: deserializeSheetValuesFromCache_,
    getCachedSheetValuesOnly_: getCachedSheetValuesOnly_,
    setCachedSheetValues_: setCachedSheetValues_,
    trackerValuesCacheKey_: trackerValuesCacheKey_,
    responsesValuesCacheKey_: responsesValuesCacheKey_,
    invalidateFullRosterCache_: invalidateFullRosterCache_,
    buildTrackerValuesFromPaxCache_: buildTrackerValuesFromPaxCache_,
    handleCheckinIdentify_: handleCheckinIdentify_,
    checkinClientConfig_dw_: checkinClientConfig_dw_,
    resolveActiveAnnouncement_dw_: resolveActiveAnnouncement_dw_,
    checkNextMonthRegistration_: checkNextMonthRegistration_,
    resolveNextMonthRegistrationStatus_dw_: resolveNextMonthRegistrationStatus_dw_,
    resetNextMonthRegistrationStatusMemo_: resetNextMonthRegistrationStatusMemo_,
    resolveSignupReminder_dw_: resolveSignupReminder_dw_,
    buildMonthGridEntries_: buildMonthGridEntries_,
    isStrictlyPastCalendarDate_: isStrictlyPastCalendarDate_,
    validateCheckinSubmitDayValue_: validateCheckinSubmitDayValue_,
    handleCheckinSubmit_: handleCheckinSubmit_,
    handleCheckinDashboard_: handleCheckinDashboard_,
    handleMonthGrid_: handleMonthGrid_,
    handlePaxGoals_: handlePaxGoals_,
    paxHistoryScopeId_dw_: paxHistoryScopeId_dw_,
    handleBonusAdd_: handleBonusAdd_,
    handleBonusEdit_: handleBonusEdit_,
    handleBonusList_: handleBonusList_,
    handleSiteFeedback_: handleSiteFeedback_,
    handleCheckinLogout_: handleCheckinLogout_,
    buildMonthNavigationPayload_dw_: buildMonthNavigationPayload_dw_,
    buildResolvedContextHandle_: buildResolvedContextHandle_,
    monthInfoFromHandle_: monthInfoFromHandle_,
    resolveLeanIdentityFromHandle_: resolveLeanIdentityFromHandle_,
    resolveFullIdentityFromHandle_: resolveFullIdentityFromHandle_,
    renderCheckinPage_: renderCheckinPage_,
  };
}
