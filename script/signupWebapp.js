/*
 * signupWebapp.js
 *
 * Backend for the web-based HC signup form (doGet/doPost ?cmd=signup), per
 * docs/signup-webapp-requirements.md. Independent implementation from the Google Form's
 * onFormSubmit path (script/addResponseOnSubmit.js) — does not call into it — but must produce
 * the same net effect on the Responses/Tracker sheets (see requirements doc §8, §11).
 */

var signupWebappResponseUtilsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./response_utils.js')
  : null;
var getResponseEmailValue_ = (signupWebappResponseUtilsModule_ && signupWebappResponseUtilsModule_.getResponseEmailValue_)
  || (typeof globalThis !== 'undefined' && globalThis.getResponseEmailValue_);

var signupWebappAddResponseModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./addResponseOnSubmit.js')
  : null;
var formatRegistrationMonth_ = (signupWebappAddResponseModule_ && signupWebappAddResponseModule_.formatRegistrationMonth_)
  || (typeof globalThis !== 'undefined' && globalThis.formatRegistrationMonth_);

var resolveResponseColumns = (signupWebappResponseUtilsModule_ && signupWebappResponseUtilsModule_.resolveResponseColumns)
  || (typeof globalThis !== 'undefined' && globalThis.resolveResponseColumns);

function normalizeTeamValue_(value) {
  return String(value || '').trim();
}

function normalizeIdentityValue_(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Finds a Responses row matching BOTH F3 Name and Email (case-insensitive/trimmed) — requirements
 * doc §6.1: this is a deliberate access-control check, not dedup convenience. F3 Name alone is
 * publicly visible on the Tracker; Email is not shown anywhere a PAX could see another
 * participant's address. A Name-only or Email-only match returns null — callers must not
 * distinguish "no record" from "partial match" in any user-facing response (anti-enumeration).
 *
 * rows: array of row arrays (same shape as Sheet getValues() rows).
 * responseColumns: column-index map as returned by resolveResponseColumns (response_utils.js).
 * responseHeaders: optional header row — when provided, email extraction uses
 *   getResponseEmailValue_ (handles "Email Address 2/3" aliases); otherwise falls back to a
 *   direct EMAIL column lookup, which is sufficient for tests/simple shapes.
 */
function findSignupMatch_(rows, f3Name, email, responseColumns, responseHeaders) {
  var normName = normalizeIdentityValue_(f3Name);
  var normEmail = normalizeIdentityValue_(email);
  if (!normName || !normEmail) return null;
  if (!responseColumns || typeof responseColumns.F3_NAME !== 'number' || typeof responseColumns.EMAIL !== 'number') {
    throw new Error('responseColumns required for findSignupMatch_');
  }

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    if (!row) continue;
    var rowName = normalizeIdentityValue_(row[responseColumns.F3_NAME]);
    var rowEmail = normalizeIdentityValue_(
      responseHeaders && typeof getResponseEmailValue_ === 'function'
        ? getResponseEmailValue_(row, responseColumns, responseHeaders)
        : row[responseColumns.EMAIL]
    );
    if (rowName === normName && rowEmail === normEmail) {
      return { rowIndex: i, row: row };
    }
  }

  return null;
}

/**
 * Reclassifies a stored Team value against the current AO list and goal list (requirements doc
 * §6.4): AO match -> ao, else goal match -> goal, else other (stored value preserved verbatim).
 * Matching is case-insensitive/trimmed; the canonical casing from the matched list entry is
 * returned for ao/goal, but the Other branch returns the original stored value unmodified.
 */
function classifyTeam_(storedTeamValue, aoList, goalList) {
  var normalized = normalizeTeamValue_(storedTeamValue);
  if (!normalized) return { teamType: '', team: '' };

  var normLower = normalized.toLowerCase();

  var aoMatch = (aoList || []).find(function(entry) {
    return normalizeTeamValue_(entry).toLowerCase() === normLower;
  });
  if (aoMatch) return { teamType: 'ao', team: normalizeTeamValue_(aoMatch) };

  var goalMatch = (goalList || []).find(function(entry) {
    return normalizeTeamValue_(entry).toLowerCase() === normLower;
  });
  if (goalMatch) return { teamType: 'goal', team: normalizeTeamValue_(goalMatch) };

  return { teamType: 'other', team: storedTeamValue };
}

/**
 * Parses ListDB rows (header row + data rows, column A = AO Teams, column B = Goal Team) into
 * the two flat lists classifyTeam_ needs. Blank cells are skipped. Read literally — sentinel-
 * looking entries like "Goal Based*" or "SOLO (no team)" are not filtered (requirements doc §6.4).
 */
function parseTeamListsFromListDbRows_(rows) {
  var aoList = [];
  var goalList = [];

  for (var i = 1; i < (rows || []).length; i++) {
    var row = rows[i] || [];
    var ao = normalizeTeamValue_(row[0]);
    var goal = normalizeTeamValue_(row[1]);
    if (ao) aoList.push(ao);
    if (goal) goalList.push(goal);
  }

  return { aoList: aoList, goalList: goalList };
}

/** Thin GAS wrapper — reads ListDB live from the given spreadsheet. Not unit-tested. */
function readTeamLists_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('ListDB');
  if (!sheet) return { aoList: [], goalList: [] };
  var rows = sheet.getDataRange().getValues();
  return parseTeamListsFromListDbRows_(rows);
}

/**
 * Mirrors handleFormSubmit_'s Tracker dedup check exactly (addResponseOnSubmit.js Phase 4:
 * `dataValues.some(row => row[0] === f3Name)`) — exact match, no trim/case-fold — so the webapp's
 * independent save path produces the same net effect (requirements doc §8, §11).
 */
function trackerHasF3Name_(trackerNameColumnRows, f3Name) {
  return (trackerNameColumnRows || []).some(function(row) {
    return row && row[0] === f3Name;
  });
}

var TEAM_TYPE_LABELS_ = { ao: 'AO-based', goal: 'Goal-based', other: 'Other' };

function maxColumnIndex_(responseColumns) {
  var max = -1;
  Object.keys(responseColumns || {}).forEach(function(key) {
    var idx = responseColumns[key];
    if (typeof idx === 'number' && idx > max) max = idx;
  });
  return max;
}

/**
 * Maps webapp signup form fields into a Responses row array — independent of
 * onFormSubmitLocked_'s Form-driven row shape, but targeting the same RESPONSE_COLUMN_MAP
 * columns so downstream sheets (Goals by HIM, Tracker VLOOKUP) see identical data.
 *
 * existingRow: the matched row to update in place (array), or null/undefined to build a new row.
 * responseColumns: column-index map from resolveResponseColumns — FEEDBACK_RATING/FEEDBACK_COMMENT
 *   may be absent (undefined index) on sheets that don't have those columns yet; both are skipped
 *   gracefully rather than erroring or resizing the row.
 * formData: { f3Name, email, teamType ('ao'|'goal'|'other'), team, who, what, how, phone, nag,
 *   feedbackRating, feedbackComment }
 */
function buildResponseRowFromForm_(existingRow, responseColumns, formData) {
  var row = existingRow ? existingRow.slice() : new Array(maxColumnIndex_(responseColumns) + 1).fill('');

  // Fields absent from formData (undefined) are left untouched — required for partial updates
  // like handleSignupFeedback_, which only ever sends {feedbackRating, feedbackComment}.
  function setIfMapped(key, value) {
    if (value === undefined) return;
    var idx = responseColumns[key];
    if (typeof idx === 'number') row[idx] = value;
  }

  setIfMapped('F3_NAME', formData.f3Name);
  setIfMapped('EMAIL', formData.email);
  if (formData.teamType !== undefined) {
    setIfMapped('TEAM_TYPE', TEAM_TYPE_LABELS_[formData.teamType] || '');
    setIfMapped('TEAM', formData.teamType === 'other' ? '' : (formData.team || ''));
    setIfMapped('OTHER_TEAM', formData.teamType === 'other' ? (formData.team || '') : '');
  }
  setIfMapped('WHO', formData.who);
  setIfMapped('WHAT', formData.what);
  setIfMapped('HOW', formData.how);
  setIfMapped('PHONE', formData.phone);
  if (formData.nag !== undefined) setIfMapped('NAG_EMAIL', formData.nag ? 'Yes' : 'No');

  if (formData.feedbackRating !== undefined) setIfMapped('FEEDBACK_RATING', formData.feedbackRating);
  if (formData.feedbackComment !== undefined) setIfMapped('FEEDBACK_COMMENT', formData.feedbackComment);

  return row;
}

function monthKey_(date) {
  var d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function addOneMonthKey_(key) {
  var parts = key.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10); // 1-based
  month += 1;
  if (month > 12) { month = 1; year += 1; }
  return year + '-' + String(month).padStart(2, '0');
}

/**
 * Parses the Template's TrackerDB sheet (header row + data rows) into row objects — case-insensitive
 * header lookup, same convention as signupReuse.js's resolveTrackerReferenceFromLinks_. Rows
 * without a StartDate are skipped (incomplete/in-progress rows).
 */
function parseLinksRows_(values) {
  if (!values || values.length < 2) return [];

  var headers = values[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
  var dateIdx = headers.indexOf('date modified');
  if (dateIdx === -1) dateIdx = headers.indexOf('date');
  var startDateIdx = headers.indexOf('startdate');
  var nameIdx = headers.indexOf('spreadsheetname');
  var sheetIdIdx = headers.indexOf('sheetid');
  var trackerUrlIdx = headers.indexOf('trackerurl');

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || startDateIdx === -1 || !row[startDateIdx]) continue;
    rows.push({
      date: dateIdx >= 0 ? row[dateIdx] : null,
      startDate: row[startDateIdx],
      spreadsheetName: nameIdx >= 0 ? row[nameIdx] : '',
      sheetId: sheetIdIdx >= 0 ? row[sheetIdIdx] : '',
      trackerUrl: trackerUrlIdx >= 0 ? row[trackerUrlIdx] : '',
    });
  }
  return rows;
}

/**
 * Resolves "current month" and "next month" tracker targets from parsed Links rows (requirements
 * doc §6.3). Current = the most recent StartDate not in the future, relative to `today`. Next =
 * the Links entry one calendar month after current's StartDate, if any. When multiple rows share
 * the same StartDate (a tracker was re-created), the row with the latest `date` wins.
 */
function resolveSignupMonths_(parsedLinksRows, today) {
  var now = today instanceof Date ? today : new Date(today);
  var nowKey = monthKey_(now);

  var byMonth = {};
  (parsedLinksRows || []).forEach(function(row) {
    var key = monthKey_(row.startDate);
    var existing = byMonth[key];
    if (!existing || new Date(row.date || 0) >= new Date(existing.date || 0)) {
      byMonth[key] = row;
    }
  });

  var currentKey = Object.keys(byMonth)
    .filter(function(key) { return key <= nowKey; })
    .sort()
    .pop();

  if (!currentKey) return { current: null, next: null };

  var current = byMonth[currentKey];
  var nextKey = addOneMonthKey_(currentKey);
  var nextRow = byMonth[nextKey] || null;

  return {
    current: { sheetId: current.sheetId, trackerUrl: current.trackerUrl, label: formatRegistrationMonth_(current.startDate) },
    next: nextRow ? { sheetId: nextRow.sheetId, trackerUrl: nextRow.trackerUrl, label: formatRegistrationMonth_(nextRow.startDate) } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GAS orchestration (not unit-tested — composes the pure functions above;
// verified against the live TEST_APP deployment, same boundary as signupReuse.js's
// sheet-mutating functions).
// ─────────────────────────────────────────────────────────────────────────

/** Reads the Template's TrackerDB sheet and resolves current/next month targets (§6.3). */
function getCurrentAndNextMonths_(templateSpreadsheet) {
  var linksSheet = templateSpreadsheet.getSheetByName('TrackerDB');
  var values = linksSheet ? linksSheet.getDataRange().getValues() : [];
  return resolveSignupMonths_(parseLinksRows_(values), new Date());
}

function readResponsesSheetState_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Responses');
  if (!sheet) throw new Error('Responses sheet not found in spreadsheet ' + spreadsheet.getId());
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var columns = resolveResponseColumns(headers);
  var dataRows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues() : [];
  return { sheet: sheet, headers: headers, columns: columns, dataRows: dataRows };
}

/**
 * cmd=signup identify action: looks up an existing signup in the CURRENT month's Responses sheet
 * by F3 Name + Email (§6.1). Returns prefill data (with Team reclassified per §6.4) when matched,
 * or a blank-state response when not — callers must render both identically except for the
 * prefilled values (anti-enumeration, §6.1/§5 Step 2).
 */
function handleSignupIdentify_(templateSpreadsheet, payload) {
  var months = getCurrentAndNextMonths_(templateSpreadsheet);
  if (!months.current) return { ok: false, error: 'no_current_month' };

  var currentSs = SpreadsheetApp.openById(months.current.sheetId);
  var state = readResponsesSheetState_(currentSs);
  var match = findSignupMatch_(state.dataRows, payload.f3Name, payload.email, state.columns, state.headers);
  var lists = readTeamLists_(templateSpreadsheet);

  if (!match) {
    GasLogger.log('signupWebapp.identify', { matched: false });
    return { ok: true, matched: false, months: months, aoList: lists.aoList, goalList: lists.goalList };
  }

  var row = match.row;
  var storedTeam = (row[state.columns.TEAM] || row[state.columns.OTHER_TEAM] || '');
  var classified = classifyTeam_(storedTeam, lists.aoList, lists.goalList);

  GasLogger.log('signupWebapp.identify', { matched: true });
  return {
    ok: true,
    matched: true,
    months: months,
    aoList: lists.aoList,
    goalList: lists.goalList,
    data: {
      f3Name: row[state.columns.F3_NAME] || '',
      email: row[state.columns.EMAIL] || '',
      teamType: classified.teamType,
      team: classified.team,
      who: row[state.columns.WHO] || '',
      what: row[state.columns.WHAT] || '',
      how: row[state.columns.HOW] || '',
      phone: row[state.columns.PHONE] || '',
      nag: String(row[state.columns.NAG_EMAIL] || '').trim().toLowerCase() === 'yes',
    },
  };
}

/**
 * cmd=signup save action: writes the signup to the chosen target month's Responses sheet
 * (update in place if a match exists there, else a new row), then ensures a Tracker row exists
 * for that F3 Name — independent implementation, but the same net effect as handleFormSubmit_
 * (requirements doc §8, §11): same exact-match Tracker uniqueness check (trackerHasF3Name_),
 * same formula-row-copy mechanics.
 */
function handleSignupSave_(templateSpreadsheet, payload) {
  var months = getCurrentAndNextMonths_(templateSpreadsheet);
  var targetMonth = payload.targetMonth === 'next' ? months.next : months.current;
  if (!targetMonth) return { ok: false, error: 'invalid_target_month' };

  var targetSs = SpreadsheetApp.openById(targetMonth.sheetId);
  var state = readResponsesSheetState_(targetSs);
  var match = findSignupMatch_(state.dataRows, payload.f3Name, payload.email, state.columns, state.headers);

  var formData = {
    f3Name: payload.f3Name,
    email: payload.email,
    teamType: payload.teamType,
    team: payload.team,
    who: payload.who,
    what: payload.what,
    how: payload.how,
    phone: payload.phone,
    nag: !!payload.nag,
  };
  if (payload.feedbackRating !== undefined && payload.feedbackRating !== null) formData.feedbackRating = payload.feedbackRating;
  if (payload.feedbackComment) formData.feedbackComment = payload.feedbackComment;

  if (match) {
    var updatedRow = buildResponseRowFromForm_(match.row, state.columns, formData);
    state.sheet.getRange(match.rowIndex + 2, 1, 1, updatedRow.length).setValues([updatedRow]);
    GasLogger.log('signupWebapp.save', { mode: 'update', row: match.rowIndex + 2 });
  } else {
    var newRow = buildResponseRowFromForm_(null, state.columns, formData);
    state.sheet.appendRow(newRow);
    GasLogger.log('signupWebapp.save', { mode: 'insert' });
  }

  var trackerSheet = targetSs.getSheetByName('Tracker');
  var trackerLastRow = trackerSheet ? trackerSheet.getLastRow() : 0;
  if (trackerSheet && trackerLastRow >= 4) {
    var lastColumn = trackerSheet.getLastColumn();
    var nameColumnRows = trackerSheet.getRange(4, 1, trackerLastRow - 3, 1).getValues();
    if (!trackerHasF3Name_(nameColumnRows, payload.f3Name)) {
      var nextRow = trackerLastRow + 1;
      trackerSheet.getRange(nextRow, 1).setValue(payload.f3Name);
      if (nextRow > 4) {
        trackerSheet.getRange(nextRow - 1, 2, 1, lastColumn - 1)
          .copyTo(trackerSheet.getRange(nextRow, 2, 1, lastColumn - 1));
      }
      GasLogger.log('signupWebapp.save', { trackerRowAdded: nextRow });
    }
  }

  return { ok: true, savedMonth: targetMonth.label, trackerUrl: targetMonth.trackerUrl };
}

/**
 * cmd=signup feedback action: writes only the rating/comment onto the row just saved, leaving
 * every other field untouched (relies on buildResponseRowFromForm_'s undefined-skip behavior).
 * Skipping feedback client-side is valid (§5 Step 5) — this handler is simply never called then.
 */
function handleSignupFeedback_(templateSpreadsheet, payload) {
  var months = getCurrentAndNextMonths_(templateSpreadsheet);
  var targetMonth = payload.targetMonth === 'next' ? months.next : months.current;
  if (!targetMonth) return { ok: false, error: 'invalid_target_month' };

  var targetSs = SpreadsheetApp.openById(targetMonth.sheetId);
  var state = readResponsesSheetState_(targetSs);
  var match = findSignupMatch_(state.dataRows, payload.f3Name, payload.email, state.columns, state.headers);
  if (!match) return { ok: false, error: 'signup_not_found' };

  var updatedRow = buildResponseRowFromForm_(match.row, state.columns, {
    feedbackRating: payload.feedbackRating,
    feedbackComment: payload.feedbackComment,
  });
  state.sheet.getRange(match.rowIndex + 2, 1, 1, updatedRow.length).setValues([updatedRow]);
  GasLogger.log('signupWebapp.feedback', { row: match.rowIndex + 2 });

  return { ok: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    classifyTeam_,
    findSignupMatch_,
    parseTeamListsFromListDbRows_,
    readTeamLists_,
    trackerHasF3Name_,
    buildResponseRowFromForm_,
    parseLinksRows_,
    resolveSignupMonths_,
    getCurrentAndNextMonths_,
    handleSignupIdentify_,
    handleSignupSave_,
    handleSignupFeedback_,
  };
}
