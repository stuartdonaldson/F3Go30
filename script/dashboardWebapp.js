/*
 * dashboardWebapp.js
 *
 * Backend for the PAX-facing dashboard + daily check-in web app (doGet/doPost ?cmd=checkin).
 * Identity is F3 Name + Email — the same pair the signup webapp uses (no password concept
 * exists anywhere in this codebase) — verified against the current month's Responses sheet
 * via signupWebapp.js's findSignupMatch_ (same anti-enumeration behavior: a non-match and a
 * match must be visually indistinguishable to the caller except for the presence of data).
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
var findSignupMatch_dw_ = (dashboardWebappSignupModule_ && dashboardWebappSignupModule_.findSignupMatch_)
  || (typeof globalThis !== 'undefined' && globalThis.findSignupMatch_);

var dashboardWebappResponseUtilsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./response_utils.js')
  : null;
var resolveResponseColumns_dw_ = (dashboardWebappResponseUtilsModule_ && dashboardWebappResponseUtilsModule_.resolveResponseColumns)
  || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns);

// ─────────────────────────────────────────────────────────────────────────
// Pure functions (unit-tested — test/test_dashboard_webapp.js)
// ─────────────────────────────────────────────────────────────────────────

/** First fixed (non-day, non-bonus) Tracker column: A F3 Name .. H Score. Day/Bonus columns start at index 8 (column I). */
var TRACKER_FIXED_COLUMN_COUNT_ = 8;
var TRACKER_NAME_COL_ = 0;
var TRACKER_TEAM_COL_ = 1;
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
  // last day of the month for a trailing bonus column) — used by buildWeeklyBonuses_ to decide
  // whether that week's bonus period has been reached yet.
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
 * Builds the weekly-bonus display list: one entry per bonus column, labeled by its period
 * number, with the PAX's bonus point value for that column and a status — 'earned' once the
 * bonus column's preceding date (the Saturday it closes out, or month-end) has been reached,
 * 'upcoming' otherwise.
 * @param {Array<{col:number,period:*,precedingDate:(Date|null)}>} bonusCols
 * @param {Array<number>} bonusValues Same order/length as bonusCols — the PAX's value per column.
 * @param {Date} today
 */
function buildWeeklyBonuses_(bonusCols, bonusValues, today) {
  return (bonusCols || []).map(function(bonusCol, i) {
    var reached = bonusCol.precedingDate instanceof Date && bonusCol.precedingDate <= today;
    return {
      label: 'WK ' + bonusCol.period,
      value: bonusValues ? (bonusValues[i] || 0) : 0,
      status: reached ? 'earned' : 'upcoming',
    };
  });
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
  return template.evaluate().setTitle('Go30 Dashboard');
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
    return jsonOutput_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    GasLogger.log('handleCheckinPost_.error', { error: err && err.message, action: payload.action });
    return jsonOutput_({ ok: false, error: 'server_error' });
  }
}

/**
 * Verifies {f3Name, email} against the current month's Responses sheet (same anti-enumeration
 * check the signup webapp uses) and, on a match, locates their Tracker row. Throws a
 * descriptive error the caller turns into an {ok:false} response — never used to distinguish
 * "no such PAX" from "wrong email" to the client.
 * @returns {{months:Object, targetSs:Spreadsheet, trackerSheet:Sheet, rowIndex:number, columns:Object}|null}
 *   null when there's no signup match at all (current month).
 */
function resolveCheckinIdentity_(templateSpreadsheet, f3Name, email) {
  var months = getCurrentAndNextMonths_dw_(templateSpreadsheet);
  if (!months.current) return { matched: false, months: months };

  var targetSs = SpreadsheetApp.openById(months.current.sheetId);
  var responsesSheet = targetSs.getSheetByName('Responses');
  if (!responsesSheet) return { matched: false, months: months };

  var headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns_dw_(headers);
  var dataRows = responsesSheet.getLastRow() > 1
    ? responsesSheet.getRange(2, 1, responsesSheet.getLastRow() - 1, responsesSheet.getLastColumn()).getValues()
    : [];
  var match = findSignupMatch_dw_(dataRows, f3Name, email, columns, headers);
  if (!match) return { matched: false, months: months };

  var trackerSheet = targetSs.getSheetByName('Tracker');
  if (!trackerSheet || trackerSheet.getLastRow() < 4) return { matched: false, months: months };

  var trackerValues = trackerSheet.getRange(4, 1, trackerSheet.getLastRow() - 3, trackerSheet.getLastColumn()).getValues();
  var nameColumn = trackerValues.map(function(row) { return row[TRACKER_NAME_COL_]; });
  var rowIndex = findTrackerRowIndexByName_(nameColumn, f3Name);
  if (rowIndex === -1) return { matched: false, months: months };

  return {
    matched: true,
    months: months,
    targetSs: targetSs,
    trackerSheet: trackerSheet,
    trackerValues: trackerValues,
    rowIndex: rowIndex,
  };
}

function handleCheckinIdentify_(templateSpreadsheet, payload) {
  GasLogger.log('checkinWebapp.identify', { f3Name: payload.f3Name });
  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email);
  if (!identity.matched) {
    GasLogger.log('checkinWebapp.identify.result', { matched: false });
    return { ok: true, matched: false };
  }

  var row2 = identity.trackerSheet.getRange(2, 1, 1, identity.trackerSheet.getLastColumn()).getValues()[0];
  var row3 = identity.trackerSheet.getRange(3, 1, 1, identity.trackerSheet.getLastColumn()).getValues()[0];
  var classified = classifyTrackerColumns_(row2, row3);
  var trackerRow = identity.trackerValues[identity.rowIndex];
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  var yesterdayCol = findDateColumnIndex_(classified.dayCols, yesterday);
  var yesterdayValue = yesterdayCol === -1 ? null : trackerRow[yesterdayCol];

  GasLogger.log('checkinWebapp.identify.result', { matched: true, f3Name: trackerRow[TRACKER_NAME_COL_] });
  return {
    ok: true,
    matched: true,
    f3Name: trackerRow[TRACKER_NAME_COL_],
    team: trackerRow[TRACKER_TEAM_COL_],
    monthLabel: identity.months.current.label,
    needsYesterday: yesterdayCol !== -1 && needsYesterdayCheckin_(yesterdayValue),
  };
}

function handleCheckinSubmit_(templateSpreadsheet, payload) {
  if (payload.day !== 'today' && payload.day !== 'yesterday') {
    return { ok: false, error: 'invalid_day' };
  }
  if (payload.value !== 0 && payload.value !== 1) {
    return { ok: false, error: 'invalid_value' };
  }

  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email);
  if (!identity.matched) return { ok: false, error: 'not_found' };

  var row3 = identity.trackerSheet.getRange(3, 1, 1, identity.trackerSheet.getLastColumn()).getValues()[0];
  var row2 = identity.trackerSheet.getRange(2, 1, 1, identity.trackerSheet.getLastColumn()).getValues()[0];
  var classified = classifyTrackerColumns_(row2, row3);

  var targetDate = new Date();
  if (payload.day === 'yesterday') targetDate.setDate(targetDate.getDate() - 1);
  var col = findDateColumnIndex_(classified.dayCols, targetDate);
  if (col === -1) return { ok: false, error: 'day_column_not_found' };

  var sheetRow = identity.rowIndex + 4;
  var sheetCol = col + 1;
  var cell = identity.trackerSheet.getRange(sheetRow, sheetCol);
  if (cell.getFormula()) return { ok: false, error: 'cell_is_formula' };

  cell.setValue(payload.value);
  GasLogger.log('checkinWebapp.checkin', { f3Name: payload.f3Name, day: payload.day, value: payload.value });
  return { ok: true };
}

function buildDashboardPaxRow_(name, team, score, rawScore, streak) {
  return { name: name, team: team, score: score, rawScore: rawScore, streak: streak };
}

function handleCheckinDashboard_(templateSpreadsheet, payload) {
  var identity = resolveCheckinIdentity_(templateSpreadsheet, payload.f3Name, payload.email);
  if (!identity.matched) return { ok: false, error: 'not_found' };

  var row2 = identity.trackerSheet.getRange(2, 1, 1, identity.trackerSheet.getLastColumn()).getValues()[0];
  var row3 = identity.trackerSheet.getRange(3, 1, 1, identity.trackerSheet.getLastColumn()).getValues()[0];
  var classified = classifyTrackerColumns_(row2, row3);
  var today = new Date();

  var currentDayCols = classified.dayCols.filter(function(d) { return d.date <= today; });
  var totalDays = classified.dayCols.length;

  var allPaxRows = [];
  var userRow = null;
  identity.trackerValues.forEach(function(row, idx) {
    var name = row[TRACKER_NAME_COL_];
    if (!String(name || '').trim()) return;
    var dayValues = currentDayCols.map(function(d) { return row[d.col]; });
    var paxRow = buildDashboardPaxRow_(
      name,
      row[TRACKER_TEAM_COL_],
      row[TRACKER_SCORE_COL_],
      row[TRACKER_RAW_SCORE_COL_],
      computeStreak_(dayValues)
    );
    allPaxRows.push(paxRow);
    if (idx === identity.rowIndex) userRow = paxRow;
  });

  var userDayValues = currentDayCols.map(function(d) { return identity.trackerValues[identity.rowIndex][d.col]; });
  var outcomes = countOutcomes_(userDayValues);
  var bonusValues = classified.bonusCols.map(function(b) { return identity.trackerValues[identity.rowIndex][b.col]; });
  var weeklyBonuses = buildWeeklyBonuses_(classified.bonusCols, bonusValues, today);

  var userTeam = String(identity.trackerValues[identity.rowIndex][TRACKER_TEAM_COL_] || '').trim().toLowerCase();
  var myTeamMembers = allPaxRows.filter(function(r) { return String(r.team || '').trim().toLowerCase() === userTeam; })
    .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

  var paxBoard = groupByTeam_(allPaxRows);

  GasLogger.log('checkinWebapp.dashboard', { f3Name: payload.f3Name, currentDay: currentDayCols.length, totalDays: totalDays });

  return {
    ok: true,
    f3Name: userRow.name,
    team: userRow.team,
    monthLabel: identity.months.current.label,
    trackerUrl: identity.months.current.trackerUrl,
    currentDay: currentDayCols.length,
    totalDays: totalDays,
    streak: userRow.streak,
    score: userRow.score,
    rawScore: userRow.rawScore,
    done: outcomes.done,
    missed: outcomes.missed,
    absent: outcomes.absent,
    weeklyBonuses: weeklyBonuses,
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
    countOutcomes_: countOutcomes_,
    needsYesterdayCheckin_: needsYesterdayCheckin_,
    groupByTeam_: groupByTeam_,
    buildWeeklyBonuses_: buildWeeklyBonuses_,
  };
}
