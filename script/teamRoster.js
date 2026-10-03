/*
 * teamRoster.js — the Template-resident TeamDB team roster (ADR-023, F3Go30-qeuu).
 *
 * TeamDB replaces ListDB's hand-kept AO/goal lists with one self-growing roster:
 *   Team | Aliases | Status | LastUsed | UseCount
 * Every team save goes through recordTeamUse_, which snaps the typed name to the roster's
 * canonical spelling (name or alias, case- and whitespace-insensitive) and records the use, or
 * appends a new active row. Sign-up suggestions are the active teams used within
 * TeamSuggestWindowDays (Config, default 90) plus the pinned Solo entry. Admins edit TeamDB
 * directly to fix spelling (add the old spelling as an alias), hide a team, or merge.
 *
 * Pure planning helpers are split from the thin sheet wrappers so the decisions are node-tested.
 */
var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
var teamRosterUtilitiesModule_ = gasRequire_('./Utilities.js', ['getConfigValue_']);
var getConfigValue_tr_ = teamRosterUtilitiesModule_.getConfigValue_;
var teamRosterGo30ToolsModule_ = gasRequire_('./go30tools.js', ['_readPaxDbRowsBySheetId_']);
var readPaxDbRowsBySheetId_tr_ = teamRosterGo30ToolsModule_._readPaxDbRowsBySheetId_;
var teamRosterResponseUtilsModule_ = gasRequire_('./response_utils.js', ['resolveResponseColumns']);
var resolveResponseColumns_tr_ = teamRosterResponseUtilsModule_.resolveResponseColumns;

var TEAM_DB_SHEET_NAME_ = 'TeamDB';
var TEAM_DB_HEADERS_ = ['Team', 'Aliases', 'Status', 'LastUsed', 'UseCount'];
var TEAM_DB_COL_ = { TEAM: 0, ALIASES: 1, STATUS: 2, LAST_USED: 3, USE_COUNT: 4 };
var SOLO_TEAM_LABEL_ = 'SOLO (no team)';
var TEAM_SUGGEST_WINDOW_DAYS_DEFAULT_ = 90;
var TEAM_SUGGEST_WINDOW_CONFIG_KEY_ = 'TeamSuggestWindowDays';
var TEAM_DB_LOCK_WAIT_MS_ = 10000;
var DAY_MS_TR_ = 86400000;

/** Matching key: lower-case with all whitespace removed ("Shield Lock" === "shieldlock"). */
function teamMatchKey_(name) {
  return String(name == null ? '' : name).replace(/\s+/g, '').toLowerCase();
}

/** ListDB sentinel entries ("Goal Based*") are headings, not teams. */
function isTeamSentinel_(name) {
  return /\*\s*$/.test(String(name || ''));
}

function toDateOrNull_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value === '' || value == null) return null;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parses TeamDB values (header row + data rows) into entries. Rows with a blank Team are
 * skipped. rowNumber is the 1-based sheet row; raw keeps the original cells so writes preserve
 * an admin's own Aliases/Status text.
 */
function parseTeamDbRows_(values) {
  var entries = [];
  for (var i = 1; i < (values || []).length; i++) {
    var row = values[i] || [];
    var team = String(row[TEAM_DB_COL_.TEAM] || '').trim();
    if (!team) continue;
    entries.push({
      team: team,
      aliases: String(row[TEAM_DB_COL_.ALIASES] || '').split(/[;,]/)
        .map(function(a) { return a.trim(); })
        .filter(function(a) { return a; }),
      status: String(row[TEAM_DB_COL_.STATUS] || '').trim().toLowerCase() || 'active',
      lastUsed: toDateOrNull_(row[TEAM_DB_COL_.LAST_USED]),
      useCount: Number(row[TEAM_DB_COL_.USE_COUNT]) || 0,
      rowNumber: i + 1,
      raw: TEAM_DB_HEADERS_.map(function(_, c) { return row[c] === undefined ? '' : row[c]; })
    });
  }
  return entries;
}

/** Finds the entry whose Team or any Alias matches name (teamMatchKey_), else null. */
function findTeamEntry_(entries, name) {
  var key = teamMatchKey_(name);
  if (!key) return null;
  for (var i = 0; i < (entries || []).length; i++) {
    var entry = entries[i];
    if (teamMatchKey_(entry.team) === key) return entry;
    for (var a = 0; a < entry.aliases.length; a++) {
      if (teamMatchKey_(entry.aliases[a]) === key) return entry;
    }
  }
  return null;
}

/**
 * Sign-up suggestions: active entries with LastUsed within windowDays of now, sorted
 * case-insensitively, with SOLO_TEAM_LABEL_ pinned first exactly once.
 */
function buildTeamSuggestions_(entries, now, windowDays) {
  var cutoff = now.getTime() - windowDays * DAY_MS_TR_;
  var soloKey = teamMatchKey_(SOLO_TEAM_LABEL_);
  var recent = (entries || []).filter(function(e) {
    return e.status !== 'hidden' && e.lastUsed && e.lastUsed.getTime() >= cutoff &&
      teamMatchKey_(e.team) !== soloKey;
  }).map(function(e) { return e.team; });
  recent.sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  return [SOLO_TEAM_LABEL_].concat(recent);
}

/**
 * Parses ListDB rows (header row + data rows, column A = AO Teams, column B = Goal Team) into
 * two flat lists. Blank cells are skipped; read literally (sentinels are not filtered here).
 */
function parseTeamListsFromListDbRows_(rows) {
  var aoList = [];
  var goalList = [];
  for (var i = 1; i < (rows || []).length; i++) {
    var row = rows[i] || [];
    var ao = String(row[0] || '').trim();
    var goal = String(row[1] || '').trim();
    if (ao) aoList.push(ao);
    if (goal) goalList.push(goal);
  }
  return { aoList: aoList, goalList: goalList };
}

/**
 * Plans a TeamDB seed from ListDB rows and PaxDB {team, date} records against the existing
 * entries. Idempotent: an existing entry (matched by name/alias) only ever has LastUsed raised
 * to the latest PaxDB date and UseCount raised to the PaxDB count — never lowered, renamed, or
 * re-statused. New teams append as active; ListDB spelling wins, else the most frequent PaxDB
 * spelling (ties -> most recent). ListDB-only teams get a blank LastUsed, so they are not
 * suggested until someone actually uses them. Appends are sorted by match key.
 * @returns {{appends: Array<Array>, updates: Array<{rowNumber: number, values: Array}>}}
 */
function planTeamSeed_(existingEntries, listDbRows, paxRecords) {
  var candidates = {};
  var order = [];

  function candidateFor(name) {
    var key = teamMatchKey_(name);
    if (!key || isTeamSentinel_(name)) return null;
    if (!candidates[key]) {
      candidates[key] = { key: key, listDbName: null, spellings: {}, lastUsed: null, count: 0 };
      order.push(key);
    }
    return candidates[key];
  }

  var lists = parseTeamListsFromListDbRows_(listDbRows);
  lists.aoList.concat(lists.goalList).forEach(function(name) {
    var c = candidateFor(name);
    if (c && !c.listDbName) c.listDbName = name;
  });

  (paxRecords || []).forEach(function(rec) {
    var name = String((rec && rec.team) || '').trim();
    var c = candidateFor(name);
    if (!c) return;
    var date = toDateOrNull_(rec.date);
    c.count++;
    if (date && (!c.lastUsed || date.getTime() > c.lastUsed.getTime())) c.lastUsed = date;
    var s = c.spellings[name] || (c.spellings[name] = { count: 0, latest: 0 });
    s.count++;
    if (date && date.getTime() > s.latest) s.latest = date.getTime();
  });

  var appends = [];
  var updates = [];
  order.sort();
  order.forEach(function(key) {
    var c = candidates[key];
    var name = c.listDbName || Object.keys(c.spellings).sort(function(a, b) {
      var sa = c.spellings[a];
      var sb = c.spellings[b];
      return (sb.count - sa.count) || (sb.latest - sa.latest);
    })[0];
    var existing = findTeamEntry_(existingEntries, name);
    if (!existing) {
      appends.push([name, '', 'active', c.lastUsed || '', c.count]);
      return;
    }
    var lastUsed = existing.lastUsed;
    if (c.lastUsed && (!lastUsed || c.lastUsed.getTime() > lastUsed.getTime())) lastUsed = c.lastUsed;
    var useCount = Math.max(existing.useCount, c.count);
    if (lastUsed === existing.lastUsed && useCount === existing.useCount) return;
    var values = existing.raw.slice();
    values[TEAM_DB_COL_.LAST_USED] = lastUsed || '';
    values[TEAM_DB_COL_.USE_COUNT] = useCount;
    updates.push({ rowNumber: existing.rowNumber, values: values });
  });

  return { appends: appends, updates: updates };
}

/** Opens the TeamDB sheet, creating it with headers if missing. */
function openOrCreateTeamDbSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(TEAM_DB_SHEET_NAME_);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(TEAM_DB_SHEET_NAME_);
    sheet.getRange(1, 1, 1, TEAM_DB_HEADERS_.length).setValues([TEAM_DB_HEADERS_]).setFontWeight('bold');
  }
  return sheet;
}

function readTeamDbEntries_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return parseTeamDbRows_(sheet.getRange(1, 1, sheet.getLastRow(), TEAM_DB_HEADERS_.length).getValues());
}

function withTeamDbLock_(label, fn, fallback) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(TEAM_DB_LOCK_WAIT_MS_);
  } catch (e) {
    GasLogger.log(label + '.lockFailed', { error: e.message });
    return fallback();
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * THE save path for a team name (ADR-023 Decision 4): returns the canonical spelling and
 * records the use — bumps LastUsed/UseCount on a name/alias match (Status untouched, so an
 * admin-hidden team stays hidden), else appends a new active row with the trimmed name.
 * A blank name writes nothing. On lock timeout the canonical name is still resolved from an
 * unlocked read so a sign-up never fails on roster bookkeeping.
 * @param {Spreadsheet} spreadsheet The Template (TeamDB lives only there).
 * @returns {{team: string, created: boolean}}
 */
function recordTeamUse_(spreadsheet, name, now) {
  var trimmed = String(name == null ? '' : name).trim();
  if (!trimmed) return { team: '', created: false };
  var sheet = openOrCreateTeamDbSheet_(spreadsheet);

  return withTeamDbLock_('recordTeamUse_', function() {
    var existing = findTeamEntry_(readTeamDbEntries_(sheet), trimmed);
    if (existing) {
      sheet.getRange(existing.rowNumber, TEAM_DB_COL_.LAST_USED + 1, 1, 2)
        .setValues([[now, existing.useCount + 1]]);
      return { team: existing.team, created: false };
    }
    sheet.appendRow([trimmed, '', 'active', now, 1]);
    GasLogger.log('recordTeamUse_.created', { team: trimmed });
    return { team: trimmed, created: true };
  }, function() {
    var match = findTeamEntry_(readTeamDbEntries_(sheet), trimmed);
    return { team: match ? match.team : trimmed, created: false };
  });
}

/** Reads Config TeamSuggestWindowDays (positive number) or the default. */
function resolveTeamSuggestWindowDays_(spreadsheet, configLookup) {
  var lookup = configLookup || function(key) { return getConfigValue_tr_(spreadsheet, key); };
  var pair = lookup(TEAM_SUGGEST_WINDOW_CONFIG_KEY_);
  var days = pair ? Number(pair.primary) : NaN;
  return days > 0 ? days : TEAM_SUGGEST_WINDOW_DAYS_DEFAULT_;
}

/** The roster's canonical spelling for name (name/alias match), else the trimmed input. */
function canonicalTeamName_(entries, name) {
  var match = findTeamEntry_(entries, name);
  return match ? match.team : String(name == null ? '' : name).trim();
}

/**
 * Read-only roster view for sign-up identify, from one TeamDB read (never creates TeamDB):
 * suggestions (the time-windowed list), knownTeams (every non-hidden name regardless of age —
 * the client's "Did you mean …?" check compares against these), and the parsed entries (for
 * canonicalTeamName_ on a stored team).
 * @param {function(string): ?{primary: *}=} configLookup Test seam; defaults to getConfigValue_.
 * @returns {{suggestions: Array<string>, knownTeams: Array<string>, entries: Array<Object>}}
 */
function readTeamRosterView_(spreadsheet, now, configLookup) {
  var entries = readTeamDbEntries_(spreadsheet.getSheetByName(TEAM_DB_SHEET_NAME_));
  var knownTeams = entries.filter(function(e) { return e.status !== 'hidden'; })
    .map(function(e) { return e.team; })
    .sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  return {
    suggestions: buildTeamSuggestions_(entries, now, resolveTeamSuggestWindowDays_(spreadsheet, configLookup)),
    knownTeams: knownTeams,
    entries: entries
  };
}

/**
 * Seeds/refreshes TeamDB from the Template's ListDB plus the given PaxDB {team, date} records.
 * Idempotent (see planTeamSeed_).
 * @returns {{added: number, updated: number, total: number}}
 */
function seedTeamDb_(spreadsheet, paxRecords) {
  var listDbSheet = spreadsheet.getSheetByName('ListDB');
  var listDbRows = listDbSheet ? listDbSheet.getDataRange().getValues() : [];
  var sheet = openOrCreateTeamDbSheet_(spreadsheet);

  return withTeamDbLock_('seedTeamDb_', function() {
    var entries = readTeamDbEntries_(sheet);
    var plan = planTeamSeed_(entries, listDbRows, paxRecords);
    plan.updates.forEach(function(u) {
      sheet.getRange(u.rowNumber, 1, 1, u.values.length).setValues([u.values]);
    });
    if (plan.appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, plan.appends.length, TEAM_DB_HEADERS_.length)
        .setValues(plan.appends);
    }
    var result = { added: plan.appends.length, updated: plan.updates.length, total: entries.length + plan.appends.length };
    // Logged under already-registered Axiom field names (test/fixtures/axiomFieldRegistry.json).
    GasLogger.log('seedTeamDb_', { created: result.added, updated: result.updated, count: result.total });
    return result;
  }, function() {
    throw new Error('seedTeamDb_: could not acquire script lock');
  });
}

/**
 * Plans an admin rename/merge (ADR-023 Decision 6). `from` must match a roster row by name or
 * alias. If `to` matches a DIFFERENT row, from merges into it: from's name and aliases become
 * aliases of to, LastUsed is the later of the two, UseCount is summed, to's Status stands, and
 * from's row is deleted. Otherwise from's row is renamed in place and its old name joins its
 * aliases. Aliases the new name's match key already covers are dropped as redundant.
 * matchKeys are every spelling that resolved to `from` — the cells a tracker rewrite targets.
 * @returns {{ok: boolean, error: (string|undefined), merged: boolean, team: string,
 *   updates: Array<{rowNumber: number, values: Array}>, deleteRowNumber: ?number,
 *   matchKeys: Array<string>}}
 */
function planTeamRename_(entries, from, to) {
  var newName = String(to == null ? '' : to).trim();
  if (!newName) return { ok: false, error: 'to is required' };
  var fromEntry = findTeamEntry_(entries, from);
  if (!fromEntry) return { ok: false, error: 'unknown_team' };
  var toEntry = findTeamEntry_(entries, newName);
  var merged = !!toEntry && toEntry !== fromEntry;
  var target = merged ? toEntry : fromEntry;
  var canonical = merged ? toEntry.team : newName;

  var fromSpellings = fromEntry.aliases.concat([fromEntry.team]);
  var seen = {};
  seen[teamMatchKey_(canonical)] = true;
  var aliases = [];
  (merged ? toEntry.aliases : []).concat(fromSpellings).forEach(function(a) {
    var key = teamMatchKey_(a);
    if (!key || seen[key]) return;
    seen[key] = true;
    aliases.push(a);
  });

  var values = target.raw.slice();
  values[TEAM_DB_COL_.TEAM] = canonical;
  values[TEAM_DB_COL_.ALIASES] = aliases.join(', ');
  if (merged) {
    var lastUsed = toEntry.lastUsed;
    if (fromEntry.lastUsed && (!lastUsed || fromEntry.lastUsed.getTime() > lastUsed.getTime())) lastUsed = fromEntry.lastUsed;
    values[TEAM_DB_COL_.LAST_USED] = lastUsed || '';
    values[TEAM_DB_COL_.USE_COUNT] = toEntry.useCount + fromEntry.useCount;
  }

  var matchKeys = [];
  fromSpellings.forEach(function(a) {
    var key = teamMatchKey_(a);
    if (key && matchKeys.indexOf(key) === -1) matchKeys.push(key);
  });

  return {
    ok: true,
    merged: merged,
    team: canonical,
    updates: [{ rowNumber: target.rowNumber, values: values }],
    deleteRowNumber: merged ? fromEntry.rowNumber : null,
    matchKeys: matchKeys
  };
}

/**
 * Rewrites, in place, every cell of a single-column values array whose match key is in matchKeys.
 * @returns {Array<number>} the 0-based indexes that changed.
 */
function rewriteTeamColumn_(values, matchKeys, newName) {
  var changed = [];
  for (var i = 0; i < values.length; i++) {
    var key = teamMatchKey_(values[i][0]);
    if (key && matchKeys.indexOf(key) !== -1 && values[i][0] !== newName) {
      values[i][0] = newName;
      changed.push(i);
    }
  }
  return changed;
}

/** Rewrites one sheet column (1-based col, data rows 2+) via rewriteTeamColumn_; returns changed indexes. */
function rewriteSheetTeamColumn_(sheet, col, matchKeys, newName, rowFilter) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || col < 1) return [];
  var range = sheet.getRange(2, col, lastRow - 1, 1);
  var values = range.getValues();
  var candidates = values.map(function(r, i) { return rowFilter && !rowFilter(i) ? [''] : [r[0]]; });
  var changed = rewriteTeamColumn_(candidates, matchKeys, newName);
  if (!changed.length) return [];
  changed.forEach(function(i) { values[i][0] = newName; });
  range.setValues(values);
  return changed;
}

/**
 * Admin rename/merge (ADR-023 Decision 6): applies planTeamRename_ to TeamDB, then rewrites the
 * Team (and Other team) cells of each given tracker's Responses sheet and that tracker's PaxDB
 * rows. Other months keep their historical spelling. All under the TeamDB lock.
 * @param {{trackerSheetIds: Array<string>, openById: function(string): Spreadsheet,
 *   onTrackerChanged: function(string)}} deps onTrackerChanged runs for each tracker whose
 *   Responses changed (the caller wipes its caches and re-sorts it).
 */
function renameTeam_(spreadsheet, from, to, deps) {
  var sheet = openOrCreateTeamDbSheet_(spreadsheet);
  return withTeamDbLock_('renameTeam_', function() {
    var plan = planTeamRename_(readTeamDbEntries_(sheet), from, to);
    if (!plan.ok) return { ok: false, error: plan.error };

    plan.updates.forEach(function(u) {
      sheet.getRange(u.rowNumber, 1, 1, u.values.length).setValues([u.values]);
    });
    if (plan.deleteRowNumber) sheet.deleteRow(plan.deleteRowNumber);

    var responsesUpdated = 0;
    var trackersChanged = [];
    (deps.trackerSheetIds || []).forEach(function(sheetId) {
      var responses = deps.openById(sheetId).getSheetByName('Responses');
      if (!responses || responses.getLastColumn() < 1) return;
      var columns = resolveResponseColumns_tr_(responses.getRange(1, 1, 1, responses.getLastColumn()).getValues()[0]);
      var changed = rewriteSheetTeamColumn_(responses, columns.TEAM + 1, plan.matchKeys, plan.team);
      if (typeof columns.OTHER_TEAM === 'number') {
        changed = changed.concat(rewriteSheetTeamColumn_(responses, columns.OTHER_TEAM + 1, plan.matchKeys, plan.team));
      }
      if (!changed.length) return;
      responsesUpdated += changed.filter(function(v, i, a) { return a.indexOf(v) === i; }).length;
      trackersChanged.push(sheetId);
      deps.onTrackerChanged(sheetId);
    });

    var paxDbUpdated = 0;
    var paxDb = spreadsheet.getSheetByName('PaxDB');
    if (paxDb && paxDb.getLastRow() > 1 && (deps.trackerSheetIds || []).length) {
      var headers = paxDb.getRange(1, 1, 1, paxDb.getLastColumn()).getValues()[0];
      var sheetIdCol = headers.indexOf('SheetId');
      var teamCol = headers.indexOf('Team');
      if (sheetIdCol !== -1 && teamCol !== -1) {
        var sheetIds = paxDb.getRange(2, sheetIdCol + 1, paxDb.getLastRow() - 1, 1).getValues();
        paxDbUpdated = rewriteSheetTeamColumn_(paxDb, teamCol + 1, plan.matchKeys, plan.team, function(i) {
          return deps.trackerSheetIds.indexOf(String(sheetIds[i][0])) !== -1;
        }).length;
      }
    }

    var result = { ok: true, merged: plan.merged, team: plan.team, responsesUpdated: responsesUpdated, paxDbUpdated: paxDbUpdated, trackersChanged: trackersChanged };
    // Logged under already-registered Axiom field names (test/fixtures/axiomFieldRegistry.json).
    GasLogger.log('renameTeam_', { alias: String(from), team: plan.team, mode: plan.merged ? 'merge' : 'rename', updated: responsesUpdated, rows: paxDbUpdated });
    return result;
  }, function() {
    return { ok: false, error: 'lock_timeout' };
  });
}

/** Flattens the Template's PaxDB into {team, date} records for seedTeamDb_. */
function collectPaxTeamRecords_(spreadsheet) {
  var bySheetId = readPaxDbRowsBySheetId_tr_(spreadsheet).bySheetId;
  var records = [];
  Object.keys(bySheetId).forEach(function(sheetId) {
    bySheetId[sheetId].forEach(function(row) { records.push({ team: row.team, date: row.date }); });
  });
  return records;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TEAM_DB_SHEET_NAME_: TEAM_DB_SHEET_NAME_,
    TEAM_DB_HEADERS_: TEAM_DB_HEADERS_,
    SOLO_TEAM_LABEL_: SOLO_TEAM_LABEL_,
    TEAM_SUGGEST_WINDOW_DAYS_DEFAULT_: TEAM_SUGGEST_WINDOW_DAYS_DEFAULT_,
    teamMatchKey_: teamMatchKey_,
    isTeamSentinel_: isTeamSentinel_,
    parseTeamDbRows_: parseTeamDbRows_,
    findTeamEntry_: findTeamEntry_,
    buildTeamSuggestions_: buildTeamSuggestions_,
    parseTeamListsFromListDbRows_: parseTeamListsFromListDbRows_,
    planTeamSeed_: planTeamSeed_,
    openOrCreateTeamDbSheet_: openOrCreateTeamDbSheet_,
    recordTeamUse_: recordTeamUse_,
    resolveTeamSuggestWindowDays_: resolveTeamSuggestWindowDays_,
    canonicalTeamName_: canonicalTeamName_,
    readTeamRosterView_: readTeamRosterView_,
    seedTeamDb_: seedTeamDb_,
    collectPaxTeamRecords_: collectPaxTeamRecords_,
    planTeamRename_: planTeamRename_,
    rewriteTeamColumn_: rewriteTeamColumn_,
    renameTeam_: renameTeam_,
  };
}
