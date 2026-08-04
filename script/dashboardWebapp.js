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

var dashboardWebappUtilitiesModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./Utilities.js')
  : null;
var getConfigValue_dw_ = (dashboardWebappUtilitiesModule_ && dashboardWebappUtilitiesModule_.getConfigValue_)
  || (typeof globalThis !== 'undefined' && globalThis.getConfigValue_);

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
var getPaxCacheRowsBulk_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.getPaxCacheRowsBulk_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxCacheRowsBulk_);
var setPaxCacheRow_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.setPaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxCacheRow_);
var setPaxCacheRowsBulk_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.setPaxCacheRowsBulk_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxCacheRowsBulk_);
var resolvePaxRowIndex_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.resolvePaxRowIndex_)
  || (typeof globalThis !== 'undefined' && globalThis.resolvePaxRowIndex_);
var getPaxRosterIndex_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.getPaxRosterIndex_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxRosterIndex_);
var deletePaxRosterIndex_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.deletePaxRosterIndex_)
  || (typeof globalThis !== 'undefined' && globalThis.deletePaxRosterIndex_);
var refreshPaxCacheRowFromSheet_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.refreshPaxCacheRowFromSheet_)
  || (typeof globalThis !== 'undefined' && globalThis.refreshPaxCacheRowFromSheet_);
var deletePaxCacheRow_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.deletePaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.deletePaxCacheRow_);
var paxCacheNormalizeName_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.paxCacheNormalizeName_)
  || (typeof globalThis !== 'undefined' && globalThis.paxCacheNormalizeName_);
var getPaxCacheRequestStats_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.getPaxCacheRequestStats_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxCacheRequestStats_);
// f3Name-keyed rolling history window (F3Go30-5uk2) — see PaxCache.js file header.
var getPaxHistoryEntry_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.getPaxHistoryEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxHistoryEntry_);
var setPaxHistoryEntry_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.setPaxHistoryEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxHistoryEntry_);
var paxHistoryDaysToValues_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.paxHistoryDaysToValues_)
  || (typeof globalThis !== 'undefined' && globalThis.paxHistoryDaysToValues_);
// F3Go30-uz9e.2 — read-side anchoring + the roster-wide batched entry read.
var anchorPaxHistoryValues_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.anchorPaxHistoryValues_)
  || (typeof globalThis !== 'undefined' && globalThis.anchorPaxHistoryValues_);
var getPaxHistoryEntriesBulk_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.getPaxHistoryEntriesBulk_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxHistoryEntriesBulk_);
var paxHistoryDayDiff_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.paxHistoryDayDiff_)
  || (typeof globalThis !== 'undefined' && globalThis.paxHistoryDayDiff_);
var paxHistoryEncodeValue_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.paxHistoryEncodeValue_)
  || (typeof globalThis !== 'undefined' && globalThis.paxHistoryEncodeValue_);
var setPaxHistoryEntriesBulk_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.setPaxHistoryEntriesBulk_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxHistoryEntriesBulk_);
var PAX_HISTORY_BACKFILL_DAYS_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.PAX_HISTORY_BACKFILL_DAYS_)
  || (typeof globalThis !== 'undefined' && globalThis.PAX_HISTORY_BACKFILL_DAYS_);
var advancePaxHistoryDay_dw_ = (dashboardWebappPaxCacheModule_ && dashboardWebappPaxCacheModule_.advancePaxHistoryDay_)
  || (typeof globalThis !== 'undefined' && globalThis.advancePaxHistoryDay_);

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
var getCachedBonusEntriesOnly_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.getCachedBonusEntriesOnly_)
  || (typeof globalThis !== 'undefined' && globalThis.getCachedBonusEntriesOnly_);

var dashboardWebappGo30ToolsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./go30tools.js')
  : null;
var readTrackerDbRowsBySheetId_dw_ = (dashboardWebappGo30ToolsModule_ && dashboardWebappGo30ToolsModule_._readTrackerDbRowsBySheetId_)
  || (typeof globalThis !== 'undefined' && globalThis._readTrackerDbRowsBySheetId_);
var readPaxDbRowsBySheetId_dw_ = (dashboardWebappGo30ToolsModule_ && dashboardWebappGo30ToolsModule_._readPaxDbRowsBySheetId_)
  || (typeof globalThis !== 'undefined' && globalThis._readPaxDbRowsBySheetId_);

var dashboardWebappAddResponseModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./addResponseOnSubmit.js')
  : null;
var formatRegistrationMonth_dw_ = (dashboardWebappAddResponseModule_ && dashboardWebappAddResponseModule_.formatRegistrationMonth_)
  || (typeof globalThis !== 'undefined' && globalThis.formatRegistrationMonth_);

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

/**
 * Lazily opens a tracker spreadsheet — SpreadsheetApp.openById() is the openMs cost in every
 * identify/dashboard timing log; once every piece a caller needs (Responses/Tracker layout,
 * roster index, per-PAX row, bonus entries) is already warm in cache, nothing about serving
 * cached data requires a live Sheet handle. Callers reach the spreadsheet only through .get(),
 * at the point they actually need to read (or write) something live — a fully warm cache never
 * calls .get() at all, so openById() is never called and getOpenMs() stays 0 (F3Go30-440b.6).
 */
function makeLazySpreadsheet_dw_(sheetId) {
  var ss = null;
  var openMs = 0;
  return {
    get: function() {
      if (!ss) {
        var t = Date.now();
        ss = SpreadsheetApp.openById(sheetId);
        openMs = Date.now() - t;
      }
      return ss;
    },
    getOpenMs: function() { return openMs; },
  };
}

function responsesLayoutCacheKey_(sheetId) {
  return 'go30dash:responsesLayout:' + sheetId;
}

/**
 * Cache-only half of getResponsesLayout_ — same split as getCachedTrackerLayoutOnly_/
 * getTrackerLayout_, so a caller can find out whether it can skip opening the spreadsheet
 * entirely before paying for that open.
 * @returns {{headers:Array, columns:Object}|null} null on a miss or corrupt entry.
 */
function getCachedResponsesLayoutOnly_(sheetId) {
  var cache = CacheService.getScriptCache();
  var cached;
  try { cached = cache.get(responsesLayoutCacheKey_(sheetId)); } catch (e) { cached = null; }
  if (!cached) return null;
  try { return JSON.parse(cached); } catch (e) { return null; }
}

/**
 * Sheet-level cache of the Responses header row + its resolved column map — a cheap 1-row read,
 * cached separately from per-PAX data because it's shared by every PAX and rarely changes (only
 * tracker-creation/restructuring touches it, never a normal signup/check-in), so a long
 * CacheService TTL is safe without any write-through — mirrors getTrackerLayout_ exactly
 * (F3Go30-440b.6: previously re-read live on every single lean identify call regardless of
 * whether the PAX's own row was already cached).
 */
function getResponsesLayout_(responsesSheet, sheetId) {
  var fromCache = getCachedResponsesLayoutOnly_(sheetId);
  if (fromCache) return fromCache;

  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var layout = { headers: headers, columns: resolveResponseColumns_dw_(headers) };

  try {
    CacheService.getScriptCache().put(responsesLayoutCacheKey_(sheetId), JSON.stringify(layout), TRACKER_LAYOUT_CACHE_TTL_SECONDS_);
  } catch (e) { /* payload too large or cache unavailable — the read above still succeeded */ }

  return layout;
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
 * any write to a month's Tracker (day check-ins, -1 marking) or Responses (signups) sheet.
 * Manual edits that don't go through this webapp's own code are caught instead by
 * TrackerEditTrigger.js's onEdit-driven invalidation (F3Go30-o39s epic).
 */
function invalidateFullRosterCache_(sheetId) {
  try { CacheService.getScriptCache().remove(trackerValuesCacheKey_(sheetId)); } catch (e) { /* best-effort */ }
  try { CacheService.getScriptCache().remove(responsesValuesCacheKey_(sheetId)); } catch (e) { /* best-effort */ }
}

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
  var bySheetId = (readTrackerDbRowsBySheetId_dw_ ? readTrackerDbRowsBySheetId_dw_(spreadsheet) : { bySheetId: {} }).bySheetId || {};
  var monthKeyBySheetId = {};
  var availableMonths = Object.keys(bySheetId).map(function(sheetId) {
    var row = bySheetId[sheetId];
    var startDate = row.startDate instanceof Date ? row.startDate : new Date(row.startDate);
    var monthKey = _dashboardIsoDate_(startDate).slice(0, 7);
    monthKeyBySheetId[sheetId] = monthKey;
    return { monthKey: monthKey, label: formatRegistrationMonth_dw_(startDate), startDateIso: _dashboardIsoDate_(startDate) };
  }).sort(function(a, b) { return a.startDateIso < b.startDateIso ? -1 : a.startDateIso > b.startDateIso ? 1 : 0; });

  var norm = f3Name ? paxCacheNormalizeName_dw_(f3Name) : '';
  var registeredMonthKeys = [];
  if (norm) {
    var paxRowsBySheetId = (readPaxDbRowsBySheetId_dw_ ? readPaxDbRowsBySheetId_dw_(spreadsheet) : { bySheetId: {} }).bySheetId || {};
    var registered = {};
    Object.keys(paxRowsBySheetId).forEach(function(sheetId) {
      var monthKey = monthKeyBySheetId[sheetId];
      if (!monthKey) return;
      var hasRow = paxRowsBySheetId[sheetId].some(function(r) { return paxCacheNormalizeName_dw_(r.f3Name) === norm; });
      if (hasRow) registered[monthKey] = true;
    });
    registeredMonthKeys = Object.keys(registered);
  }

  return { availableMonths: availableMonths, registeredMonthKeys: registeredMonthKeys };
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
  if (!monthInfo) return null;
  try {
    var sheet = SpreadsheetApp.openById(monthInfo.sheetId).getSheetByName('Tracker');
    if (!sheet || sheet.getLastRow() < 4) return null;
    var layout = getTrackerLayout_(sheet, monthInfo.sheetId);
    var classified = classifyTrackerColumns_(layout.row2, layout.row3);
    var trackerValues = sheet.getRange(4, 1, sheet.getLastRow() - 3, sheet.getLastColumn()).getValues();
    var roster = buildRosterFromTrackerValues_(trackerValues);
    setPaxCacheRowsBulk_dw_('tracker', monthInfo.sheetId, roster.rowsByName, roster.rosterIndex);
    // Only days that have actually happened count as reported — the same rule the dashboard's own
    // reportedDayCols applies. Including future columns would stamp a historyEndDate ahead of
    // today and pad real history off the front, exactly what advancePaxHistoryDay_ refuses to do.
    var dayCols = classified.dayCols.filter(function(d) { return d.date.getTime() <= contextDate.getTime(); });
    return { sheetId: monthInfo.sheetId, dayCols: dayCols, rowsByName: roster.rowsByName, trackerValues: trackerValues };
  } catch (e) {
    GasLogger.log('reloadPaxCache.monthWarmFailed', { sheetId: monthInfo.sheetId, error: e.message });
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
  if (!match) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', Object.assign({ matched: false, lean: false, openMs: openMs, responsesMs: responsesMs, totalMs: Date.now() - t0 }, paxCacheStatsForLog_dw_()));
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
  var trackerFromCache = !!trackerValues;
  if (!trackerValues) {
    var lastRow = trackerSheet.getLastRow();
    var lastCol = trackerSheet.getLastColumn();
    trackerValues = trackerSheet.getRange(4, 1, lastRow - 3, lastCol).getValues();
  }
  var trackerMs = Date.now() - t2;

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
  if (rowIndex === undefined) return { matched: false, months: months };

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
    if (!trackerFromCache) return { matched: false, months: months };
    var freshLastRow = trackerSheet.getLastRow();
    var freshLastCol = trackerSheet.getLastColumn();
    trackerValues = trackerSheet.getRange(4, 1, freshLastRow - 3, freshLastCol).getValues();
    rowIndex = -1;
    for (var fi = 0; fi < trackerValues.length; fi++) {
      if (trackerRowBelongsToPax_dw_(trackerValues[fi], f3Name)) { rowIndex = fi; break; }
    }
    if (rowIndex === -1) return { matched: false, months: months };
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
 * Site-config payload for the check-in front end: bonus type rules/labels, Site Q contact, the
 * namespace label, and the current app version. Attached to every handleCheckinIdentify_
 * response (F3Go30-5nfj.2: static-pages/src/index.html has no server-render step to bake these
 * into — unlike the removed GAS-hosted CheckinApp.html template (DR-04, 2026-08-04) — so it
 * reads them from here instead).
 */
function checkinClientConfig_dw_(spreadsheet) {
  // Best-effort: a Config-sheet lookup hiccup must never break identify itself (the config
  // payload only feeds cosmetic/secondary UI — error-banner contact info, bonus type labels —
  // nothing on the critical identify/checkin path depends on it).
  var siteQConfig = {}, nameSpaceConfig = {};
  try {
    siteQConfig = getConfigValue_dw_(spreadsheet, 'Site Q', null) || {};
    nameSpaceConfig = getConfigValue_dw_(spreadsheet, 'NameSpace', null) || {};
  } catch (e) {
    // fall through with the {} defaults below
  }
  return {
    appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
    bonusTypeRules: bonusTypeClientRules_dw_(),
    bonusTypeCodes: bonusTypeDisplayList_dw_(),
    siteQName: siteQConfig.primary || 'Site Q',
    siteQEmail: siteQConfig.secondary || '',
    nameSpace: nameSpaceConfig.primary || 'F3 Go30',
  };
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
    // f3Name/email are unverified here (the token itself failed to resolve), so registeredMonthKeys
    // must stay empty rather than risk a PaxDB lookup on untrusted input (see the PaxDB-fallback
    // comment below) — availableMonths is PAX-agnostic (every TrackerDB month) so it's safe either way.
    return {
      ok: true, matched: false, tokenInvalid: true, config: checkinClientConfig_dw_(templateSpreadsheet),
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
        config: checkinClientConfig_dw_(templateSpreadsheet),
        availableMonths: knownPaxNav.availableMonths,
        registeredMonthKeys: knownPaxNav.registeredMonthKeys,
      };
    }
    GasLogger.log('checkinWebapp.identify.result', { matched: false, durationMs: Date.now() - t0 });
    // No PaxDB match either — this f3Name isn't a confirmed identity, so registeredMonthKeys stays
    // empty rather than running an unverified-name PaxDB lookup (same anti-enumeration boundary
    // as the branch above).
    return {
      ok: true, matched: false, tokenInvalid: !!payload.token, config: checkinClientConfig_dw_(templateSpreadsheet),
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

  // Yesterday may belong to a different month's tracker than today's (e.g. today is the 1st) —
  // resolveCheckinDayTarget_ falls back to that prior tracker rather than reporting unavailable.
  var yesterdayTarget = resolveCheckinDayTarget_(identity, f3Name, yesterday, templateSpreadsheet);
  var yesterdayAvailable = !!yesterdayTarget;
  var yesterdayStatus = yesterdayAvailable ? dayValueStatus_(yesterdayTarget.value) : null;

  var nextMonth = checkNextMonthRegistration_(identity.months, f3Name);
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
  if (sessionGuid) createOrTouchCheckinSession_dw_(templateSpreadsheet, sessionGuid, trackerRow[TRACKER_NAME_COL_], email, legacyTokenMintedAtIso);

  GasLogger.log('checkinWebapp.identify.result', {
    matched: true, f3Name: trackerRow[TRACKER_NAME_COL_], emailMismatch: identity.emailMismatch,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null, durationMs: Date.now() - t0,
  });
  return {
    ok: true,
    matched: true,
    config: checkinClientConfig_dw_(templateSpreadsheet),
    emailMismatch: !!identity.emailMismatch,
    f3Name: trackerRow[TRACKER_NAME_COL_],
    email: email,
    team: trackerRow[TRACKER_TEAM_COL_],
    monthLabel: identity.monthInfo.label,
    goals: identity.goals,
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
  if (cell.getFormula()) return { ok: false, error: 'cell_is_formula' };

  if (payload.value === null) cell.clearContent(); else cell.setValue(payload.value);
  // Write-through (F3Go30-5nfj.3) — still a single-row, single-PAX refresh, so every OTHER pax's
  // PaxCache row (and the dashboard's PaxCache-assembled full-board read,
  // resolveCheckinIdentityFull_/resolveFullIdentityFromHandle_) stays untouched and correct. But
  // the row is re-read from the sheet rather than derived from target.row, this request's
  // PRE-write snapshot: that snapshot loses a concurrent check-in's day (F3Go30-xg8f) and carries
  // stale formula-computed score columns (F3Go30-s1a5). See refreshPaxCacheRowFromSheet_.
  refreshPaxCacheRowFromSheet_dw_('tracker', target.sheetId, payload.f3Name, target.trackerSheet, sheetRow);
  // F3Go30-5uk2: write-through into the f3Name-keyed rolling history window, so team-tile
  // streak/maxStreak30 (buildDashboardPaxRow_, via getPaxHistoryWindowValues_) reflect this
  // check-in immediately, the same way the PaxCache tracker-row write-through above does.
  // The context date is passed explicitly (F3Go30-uz9e.2) so the future-day clamp inside judges
  // "future" against the same day this request resolved, not the script's raw clock.
  if (advancePaxHistoryDay_dw_) advancePaxHistoryDay_dw_(paxHistoryScopeId_dw_(templateSpreadsheet), payload.f3Name, targetDate, payload.value, _dashboardIsoDate_(today));
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
  if (result.ok) {
    refreshTrackerRowAfterBonusWrite_(resolved);
    GasLogger.log('checkinWebapp.bonusAdd', { f3Name: resolved.canonicalName, type: payload.type });
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
    GasLogger.log('checkinWebapp.bonusEdit', {
      f3Name: resolved.canonicalName, rowIndex: addResult.rowIndex, movedMonths: true,
    });
    return addResult;
  }

  // Same month: exactly one identity resolution, same as before the cross-month fix existed.
  var resolvedSame = resolveBonusSheet_(templateSpreadsheet, payload, payload.whenIso);
  if (resolvedSame.error) return { ok: false, error: resolvedSame.error };

  var result = editBonusEntry_dw_(resolvedSame.bonusSheet, resolvedSame.canonicalName, payload.rowIndex, payload, originalSnapshot);
  if (result.ok) {
    refreshTrackerRowAfterBonusWrite_(resolvedSame);
    GasLogger.log('checkinWebapp.bonusEdit', { f3Name: resolvedSame.canonicalName, rowIndex: result.rowIndex });
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
 * @returns {Array} Trailing day values (up to the stored window's length, or fewer early in the
 *   program), ending on anchorIso.
 */
function getPaxHistoryWindowValues_(f3Name, currentMonthDayValues, monthInfo, templateSpreadsheet, anchorIso, entriesByNormName) {
  var scopeId = paxHistoryScopeId_dw_(templateSpreadsheet);
  var entry = entriesByNormName
    ? (entriesByNormName[paxCacheNormalizeName_dw_(f3Name)] || null)
    : (getPaxHistoryEntry_dw_ ? getPaxHistoryEntry_dw_(scopeId, f3Name) : null);
  var anchored = anchorPaxHistoryValues_dw_ ? anchorPaxHistoryValues_dw_(entry, anchorIso) : null;
  // F3Go30-uz9e.3: the WHOLE stored window is returned, not a 30-day slice of it. Its leading
  // (prior-month) portion is what rollingAverage and priorMonthDayValues are built from; the
  // 30-day streak cap is applied by computeStreak_/computeMaxStreak_ at the point of use.
  if (anchored && paxHistoryWindowMatchesTracker_(anchored, currentMonthDayValues)) {
    return anchored;
  }

  var tail = getPriorMonthTailValues_(monthInfo, f3Name, PAX_HISTORY_BACKFILL_DAYS_dw_, templateSpreadsheet);
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
  // Cache-first (F3Go30-440b.6): only opens the spreadsheet to fetch the Bonus Tracker sheet on
  // a genuine cache miss — a fully warm dashboard load (identity + tracker roster + bonus
  // entries all cached) never calls SpreadsheetApp.openById at all.
  var bonusEntries = getCachedBonusEntriesOnly_dw_ ? getCachedBonusEntriesOnly_dw_(monthInfo.sheetId) : null;
  if (bonusEntries === null) {
    var bonusSheet = identity.targetSs.get().getSheetByName('Bonus Tracker');
    bonusEntries = bonusSheet ? getAllBonusEntriesCached_dw_(bonusSheet, monthInfo.sheetId) : [];
  }
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
  var historyEntries = getPaxHistoryEntriesBulk_dw_
    ? getPaxHistoryEntriesBulk_dw_(paxHistoryScopeId_dw_(templateSpreadsheet), identity.trackerValues.map(function(row) { return row[TRACKER_NAME_COL_]; }))
    : null;
  var allPaxRows = [];
  var userRow = null;
  identity.trackerValues.forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    if (!String(name || '').trim()) return;
    var dayValues = reportedDayCols.map(function(d) { return row[d.col]; });
    // F3Go30-5uk2/uz9e.1: cross-month streak/maxStreak30/rollingAverage for EVERY row
    // (myTeam/paxBoard), not just the logged-in viewer — see getPaxHistoryWindowValues_.
    var historyValues = getPaxHistoryWindowValues_(name, dayValues, monthInfo, templateSpreadsheet, historyAnchorIso, historyEntries);
    var bonusSeries = computeBonusSeriesForPax_dw_(bonusEntries, paxCacheNormalizeName_dw_(name), reportedDayDates, monthInfo.startDate);
    var paxRow = buildDashboardPaxRow_(
      name,
      row[TRACKER_TEAM_COL_],
      row[TRACKER_SCORE_COL_],
      row[TRACKER_RAW_SCORE_COL_],
      computeStreak_(historyValues, MAX_STREAK_WINDOW_DAYS_),
      dayValues,
      totalDays,
      currentDay,
      bonusSeries[bonusSeries.length - 1],
      historyValues
    );
    paxRow.bonusByTypeSeries = bonusSeries;
    allPaxRows.push(paxRow);
    if (idx === identity.rowIndex) { userRow = paxRow; }
  });

  var userDayValues = reportedDayCols.map(function(d) { return identity.trackerValues[identity.rowIndex][d.col]; });
  var outcomes = countOutcomes_(userDayValues);
  var bonusByType = userRow.bonusByType;
  var userBonusByTypeSeries = userRow.bonusByTypeSeries;

  // F3Go30-uz9e.1: userRow's rollingAverage and priorMonthDayValues (built inside the roster loop
  // above, from the same historyValues-sourced computation every other row now gets too) already
  // span the month boundary — no separate override/getPriorMonthTailValues_ call needed here
  // anymore (that used to run a second, potentially cache-missing lookup for the viewer alone).
  var userRollingAverage = userRow.rollingAverage;
  var priorMonthTail = userRow.priorMonthDayValues;

  // F3Go30-5uk2: userRow (built inside the roster loop above) already carries a cross-month
  // streak/maxStreak30 via getPaxHistoryWindowValues_ — the same PaxCache history window used
  // for every other board row, so the viewer no longer needs a separate override computation.
  var userStreak = userRow.streak;
  var userMaxStreak30 = userRow.maxStreak30;

  var userTeam = String(identity.trackerValues[identity.rowIndex][TRACKER_TEAM_COL_] || '').trim().toLowerCase();
  var myTeamMembers = allPaxRows.filter(function(r) { return String(r.team || '').trim().toLowerCase() === userTeam; })
    .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

  var paxBoard = groupByTeam_(allPaxRows);

  GasLogger.log('checkinWebapp.dashboard', Object.assign({
    f3Name: payload.f3Name, currentDay: currentDay, totalDays: totalDays, viewDayIndex: viewDayIndex,
    paxRows: allPaxRows.length, resolveMonthMs: resolveMonthMs, resolveIdentityMs: resolveIdentityMs,
    totalMs: Date.now() - t0,
  }, paxCacheStatsForLog_dw_()));

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
 */
function handlePaxGoals_(templateSpreadsheet, payload) {
  var targetName = payload.f3Name;
  if (!targetName) return { ok: false, error: 'missing_f3Name' };

  var realToday = resolveContextDate_(templateSpreadsheet, payload.contextDate);
  var viewDate = payload.dateISO ? parseIsoDateLocal_(payload.dateISO) : new Date(realToday);
  if (isNaN(viewDate.getTime())) viewDate = new Date(realToday);

  var handle = payload.resolvedContext;
  var monthInfo = (handle && handle.monthKey && String(payload.dateISO || '').slice(0, 7) === handle.monthKey)
    ? monthInfoFromHandle_(handle)
    : null;
  if (!monthInfo) monthInfo = resolveDashboardMonth_(viewDate, templateSpreadsheet);
  if (!monthInfo) return { ok: false, error: 'no_tracker_for_date' };

  var identity = resolveCheckinIdentityLean_(monthInfo, targetName, null, {}, true);
  if (!identity.matched) return { ok: false, error: 'not_found' };

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
    if (!rsForGrid) return notRegistered;
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
    checkNextMonthRegistration_: checkNextMonthRegistration_,
    buildMonthGridEntries_: buildMonthGridEntries_,
    isStrictlyPastCalendarDate_: isStrictlyPastCalendarDate_,
    validateCheckinSubmitDayValue_: validateCheckinSubmitDayValue_,
    handleCheckinSubmit_: handleCheckinSubmit_,
    handleCheckinDashboard_: handleCheckinDashboard_,
    handleMonthGrid_: handleMonthGrid_,
    handleBonusAdd_: handleBonusAdd_,
    handleBonusEdit_: handleBonusEdit_,
    buildMonthNavigationPayload_dw_: buildMonthNavigationPayload_dw_,
    buildResolvedContextHandle_: buildResolvedContextHandle_,
    monthInfoFromHandle_: monthInfoFromHandle_,
    resolveLeanIdentityFromHandle_: resolveLeanIdentityFromHandle_,
    resolveFullIdentityFromHandle_: resolveFullIdentityFromHandle_,
    renderCheckinPage_: renderCheckinPage_,
  };
}
