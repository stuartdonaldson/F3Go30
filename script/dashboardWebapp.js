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

var dashboardWebappBonusModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./bonusWebapp.js')
  : null;
var listBonusEntriesForPax_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.listBonusEntriesForPax_)
  || (typeof globalThis !== 'undefined' && globalThis.listBonusEntriesForPax_);
var addBonusEntry_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.addBonusEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.addBonusEntry_);
var editBonusEntry_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.editBonusEntry_)
  || (typeof globalThis !== 'undefined' && globalThis.editBonusEntry_);
var BONUS_TYPE_RULES_dw_ = (dashboardWebappBonusModule_ && dashboardWebappBonusModule_.BONUS_TYPE_RULES_)
  || (typeof globalThis !== 'undefined' && globalThis.BONUS_TYPE_RULES_);

// ─────────────────────────────────────────────────────────────────────────
// Pure functions (unit-tested — test/test_dashboard_webapp.js)
// ─────────────────────────────────────────────────────────────────────────

/** First fixed (non-day, non-bonus) Tracker column: A F3 Name .. H Score. Day/Bonus columns start at index 8 (column I). */
var TRACKER_FIXED_COLUMN_COUNT_ = 8;
var TRACKER_NAME_COL_ = 0;
var TRACKER_TEAM_COL_ = 1;
// Columns C-F: per-type month-to-date bonus totals (docs/sheet-reference.md "Tracker" §Column
// layout) — distinct from the per-week Bonus columns (classifyTrackerColumns_'s bonusCols),
// which sum every type together and so can't be broken out by type after the fact.
var TRACKER_BONUS_FELLOWSHIP_COL_ = 2;
var TRACKER_BONUS_QPOINT_COL_ = 3;
var TRACKER_BONUS_INSPIRE_COL_ = 4;
var TRACKER_BONUS_EHING_FNG_COL_ = 5;
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
 * Reads the PAX's per-type month-to-date bonus totals straight off their Tracker row (columns
 * C-F) — see TRACKER_BONUS_*_COL_. Short codes (fe/q/ins/eh) match the client's color-coded
 * pills (CheckinApp.html), sized to fit beside the score number rather than below it.
 */
function buildBonusByType_(trackerRow) {
  return {
    fe: trackerRow[TRACKER_BONUS_FELLOWSHIP_COL_] || 0,
    q: trackerRow[TRACKER_BONUS_QPOINT_COL_] || 0,
    ins: trackerRow[TRACKER_BONUS_INSPIRE_COL_] || 0,
    eh: trackerRow[TRACKER_BONUS_EHING_FNG_COL_] || 0,
  };
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

// ─────────────────────────────────────────────────────────────────────────
// GAS orchestration (not unit-tested — composes the pure functions above,
// verified against the live TEST_APP deployment, same boundary as signupWebapp.js).
// ─────────────────────────────────────────────────────────────────────────

/** Renders the cmd=checkin HTML page. */
function renderCheckinPage_() {
  var template = HtmlService.createTemplateFromFile('CheckinApp');
  template.webAppUrl = JSON.stringify(ScriptApp.getService().getUrl());
  template.appVersion = APP_VERSION;
  template.bonusTypesJson = JSON.stringify(BONUS_TYPE_RULES_dw_);
  // HtmlService serves this inside an IFRAME-sandboxed wrapper that does not honor a
  // <meta name="viewport"> tag written in the template's own <head> — it must be set via
  // addMetaTag, or mobile browsers render the desktop layout zoomed out instead of fitting
  // the device width.
  return template.evaluate().setTitle('Go30 Dashboard').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Dispatches a cmd=checkin doPost JSON body ({action, ...}) to the matching handler. */
function handleCheckinPost_(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'invalid_json' });
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
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
 * @param {string=} targetMonth 'current' (default) | 'next' | 'smoke' — same selectTargetMonth_
 *   enum signup's targetMonth already uses (signupWebapp.js), so a smoke-test caller can
 *   explicitly address the smoke tracker here too rather than relying on it happening to be
 *   "current" by date (see resolveSignupMonths_'s docstring for why that can't be trusted).
 */
function resolveCheckinIdentity_(templateSpreadsheet, f3Name, email, targetMonth) {
  var t0 = Date.now();
  var months = getCurrentAndNextMonths_dw_(templateSpreadsheet);
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
function resolveDashboardMonth_(targetDate) {
  try {
    var row = resolveTrackerForContextDate(targetDate);
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
function getPriorMonthTailValues_(monthInfo, f3Name, windowSize) {
  var t0 = Date.now();
  try {
    var dayBeforeMonth = new Date(monthInfo.startDate);
    dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);
    var priorMonth = resolveDashboardMonth_(dayBeforeMonth);
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
 * only ever need one PAX's own row). There's no way to avoid a full-range read here — but
 * since every row is already in memory, this opportunistically writes each one into PaxCache's
 * per-PAX row cache and rebuilds the roster index as a side effect, so the very next
 * identify/checkin for any of these PAX (same day) hits the lean per-PAX path instead of
 * another scan.
 */
function resolveCheckinIdentityFull_(monthInfo, f3Name, email, months) {
  var t0 = Date.now();
  var targetSs = SpreadsheetApp.openById(monthInfo.sheetId);
  var openMs = Date.now() - t0;

  var responsesSheet = targetSs.getSheetByName('Responses');
  if (!responsesSheet) return { matched: false, months: months };

  var t1 = Date.now();
  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns_dw_(headers);
  var dataRows = responsesSheet.getLastRow() > 1
    ? responsesSheet.getRange(2, 1, responsesSheet.getLastRow() - 1, responsesSheet.getLastColumn()).getValues()
    : [];
  var match = findSignupMatchByF3NameOnly_dw_(dataRows, f3Name, columns);
  var responsesMs = Date.now() - t1;
  if (!match) {
    GasLogger.log('checkinWebapp.resolveIdentity.timing', { matched: false, lean: false, openMs: openMs, responsesMs: responsesMs, totalMs: Date.now() - t0 });
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
  var lastRow = trackerSheet.getLastRow();
  var lastCol = trackerSheet.getLastColumn();
  var trackerValues = trackerSheet.getRange(4, 1, lastRow - 3, lastCol).getValues();
  var trackerMs = Date.now() - t2;

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

  var rowIndex = rosterIndex[paxCacheNormalizeName_dw_(f3Name)];
  if (rowIndex === undefined) return { matched: false, months: months };

  GasLogger.log('checkinWebapp.resolveIdentity.timing', {
    matched: true, lean: false, emailMismatch: emailMismatch,
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
    trackerValues: trackerValues,
    rowIndex: rowIndex,
  };
}

/**
 * Checks whether f3Name has a live (non-DELETED) Responses row for months.next — surfaced to a
 * PAX who's actively checking in for the current month as a nudge that they haven't signed up
 * for the month coming next, with a link into the signup flow. Returns null when there's no
 * next-month tracker yet at all (nothing to register for), so the caller skips the nudge.
 * Deliberately called from handleCheckinIdentify_, not the dashboard: identify() already pays
 * for months.next via getCurrentAndNextMonths_dw_ (resolveCheckinIdentityLean_), so this adds
 * one Responses lookup rather than a second TrackerDB read on every dashboard load.
 */
function checkNextMonthRegistration_(months, f3Name) {
  if (!months || !months.next) return null;
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
function resolveCheckinDayTarget_(identity, f3Name, targetDate) {
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
    var otherMonth = resolveDashboardMonth_(targetDate);
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

function handleCheckinIdentify_(templateSpreadsheet, payload) {
  var t0 = Date.now();
  GasLogger.log('checkinWebapp.identify', { f3Name: payload.f3Name });
  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email, payload.targetMonth);
  if (!identity.matched) {
    GasLogger.log('checkinWebapp.identify.result', { matched: false, durationMs: Date.now() - t0 });
    return { ok: true, matched: false };
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
  var yesterdayTarget = resolveCheckinDayTarget_(identity, payload.f3Name, yesterday);
  var yesterdayAvailable = !!yesterdayTarget;
  var yesterdayStatus = yesterdayAvailable ? dayValueStatus_(yesterdayTarget.value) : null;

  var nextMonth = checkNextMonthRegistration_(identity.months, payload.f3Name);

  GasLogger.log('checkinWebapp.identify.result', {
    matched: true, f3Name: trackerRow[TRACKER_NAME_COL_], emailMismatch: identity.emailMismatch,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null, durationMs: Date.now() - t0,
  });
  return {
    ok: true,
    matched: true,
    emailMismatch: !!identity.emailMismatch,
    f3Name: trackerRow[TRACKER_NAME_COL_],
    team: trackerRow[TRACKER_TEAM_COL_],
    monthLabel: identity.monthInfo.label,
    goals: identity.goals,
    todayStatus: todayStatus,
    yesterdayAvailable: yesterdayAvailable,
    yesterdayStatus: yesterdayStatus,
    nextMonthLabel: nextMonth ? nextMonth.monthLabel : null,
    nextMonthRegistered: nextMonth ? nextMonth.registered : null,
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

  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email, payload.targetMonth);
  if (!identity.matched) return { ok: false, error: 'not_found' };

  var targetDate = new Date();
  if (payload.day === 'yesterday') targetDate.setDate(targetDate.getDate() - 1);

  // Yesterday's edit target may live in the previous month's tracker (e.g. today is the 1st) —
  // resolveCheckinDayTarget_ falls back to that prior tracker rather than failing the write.
  var target = resolveCheckinDayTarget_(identity, payload.f3Name, targetDate);
  if (!target) return { ok: false, error: 'day_column_not_found' };

  var sheetRow = target.rowIndex + 4;
  var sheetCol = target.col + 1;
  var cell = target.trackerSheet.getRange(sheetRow, sheetCol);
  if (cell.getFormula()) return { ok: false, error: 'cell_is_formula' };

  if (payload.value === null) cell.clearContent(); else cell.setValue(payload.value);
  // Write-through: this PAX's own row changed, so drop just their cached copy rather than the
  // whole sheet's — the next read (identify/checkin/dashboard) repopulates it with one row read.
  deletePaxCacheRow_dw_('tracker', target.sheetId, payload.f3Name);
  GasLogger.log('checkinWebapp.checkin', { f3Name: payload.f3Name, day: payload.day, value: payload.value });
  return { ok: true };
}

/**
 * Bonus Tracker section of the check-in page — bonusList/bonusAdd/bonusEdit all resolve
 * identity the same way checkin does (name-only match, see resolveCheckinIdentity_) rather than
 * trusting a client-supplied name, then delegate to bonusWebapp.js for the actual sheet work.
 * Writes always use the canonical Tracker name (identity.trackerRow), not whatever variant the
 * client sent, so Bonus Tracker rows always "match Tracker exactly" per the sheet's own rule.
 */
function resolveBonusSheet_(templateSpreadsheet, payload) {
  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email, payload.targetMonth);
  if (!identity.matched) return { error: 'not_found' };
  var bonusSheet = identity.targetSs.getSheetByName('Bonus Tracker');
  if (!bonusSheet) return { error: 'bonus_sheet_not_found' };
  return { bonusSheet: bonusSheet, canonicalName: identity.trackerRow[TRACKER_NAME_COL_] };
}

function handleBonusList_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload);
  if (resolved.error) return { ok: false, error: resolved.error };
  return {
    ok: true,
    entries: listBonusEntriesForPax_dw_(resolved.bonusSheet, resolved.canonicalName),
    bonusTypes: BONUS_TYPE_RULES_dw_,
  };
}

function handleBonusAdd_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload);
  if (resolved.error) return { ok: false, error: resolved.error };
  var result = addBonusEntry_dw_(resolved.bonusSheet, resolved.canonicalName, payload);
  if (result.ok) GasLogger.log('checkinWebapp.bonusAdd', { f3Name: resolved.canonicalName, type: payload.type });
  return result;
}

function handleBonusEdit_(templateSpreadsheet, payload) {
  var resolved = resolveBonusSheet_(templateSpreadsheet, payload);
  if (resolved.error) return { ok: false, error: resolved.error };
  var result = editBonusEntry_dw_(resolved.bonusSheet, resolved.canonicalName, payload.rowIndex, payload);
  if (result.ok) GasLogger.log('checkinWebapp.bonusEdit', { f3Name: resolved.canonicalName, rowIndex: payload.rowIndex });
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
    // not just the logged-in PAX's own stat area (buildBonusByType_'s own blank-cell default
    // covers a caller that omits this, e.g. a row with no Tracker data at all).
    bonusByType: bonusByType || { fe: 0, q: 0, ins: 0, eh: 0 },
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
  var monthInfo = resolveDashboardMonth_(viewDate);
  var resolveMonthMs = Date.now() - t1;
  if (!monthInfo) return { ok: false, error: 'no_tracker_for_date' };

  var t2 = Date.now();
  var identity = resolveCheckinIdentityFull_(monthInfo, payload.f3Name, payload.email, null);
  var resolveIdentityMs = Date.now() - t2;
  if (!identity.matched) return { ok: false, error: 'not_found' };

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

  var allPaxRows = [];
  var userRow = null;
  identity.trackerValues.forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    if (!String(name || '').trim()) return;
    var dayValues = reportedDayCols.map(function(d) { return row[d.col]; });
    var paxRow = buildDashboardPaxRow_(
      name,
      row[TRACKER_TEAM_COL_],
      row[TRACKER_SCORE_COL_],
      row[TRACKER_RAW_SCORE_COL_],
      computeStreak_(dayValues),
      dayValues,
      totalDays,
      currentDay,
      buildBonusByType_(row)
    );
    allPaxRows.push(paxRow);
    if (idx === identity.rowIndex) userRow = paxRow;
  });

  var userDayValues = reportedDayCols.map(function(d) { return identity.trackerValues[identity.rowIndex][d.col]; });
  var outcomes = countOutcomes_(userDayValues);
  var bonusByType = buildBonusByType_(identity.trackerValues[identity.rowIndex]);

  // Early-month days would otherwise show an artificially short rolling-average window (e.g.
  // day 2 of July only has 2 days to average) — reach into the previous month's tracker so the
  // window is always a true ROLLING_AVERAGE_WINDOW_DAYS_ trailing mean. Fetched at the largest
  // of the three window sizes so the same tail also covers the chart's display-window padding
  // (see priorMonthDayValues below) and the 30-day max-streak lookback below —
  // getPriorMonthTailValues_ trims to whatever each caller actually needs.
  var priorMonthTail = getPriorMonthTailValues_(
    monthInfo, payload.f3Name,
    Math.max(ROLLING_AVERAGE_WINDOW_DAYS_, DASHBOARD_DISPLAY_WINDOW_DAYS_, MAX_STREAK_WINDOW_DAYS_)
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
    buildBonusByType_: buildBonusByType_,
    buildDashboardPaxRow_: buildDashboardPaxRow_,
    buildDaySegments_: buildDaySegments_,
    buildRollingAverage_: buildRollingAverage_,
    buildRollingAverageWithLookback_: buildRollingAverageWithLookback_,
    resolveCheckinDayTarget_: resolveCheckinDayTarget_,
    getCachedTrackerLayoutOnly_: getCachedTrackerLayoutOnly_,
    trackerLayoutCacheKey_: trackerLayoutCacheKey_,
    serializeRow3ForCache_: serializeRow3ForCache_,
  };
}
