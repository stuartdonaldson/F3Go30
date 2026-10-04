/*
 * teamDbEditTrigger.js — reconcile team names by editing the Template's TeamDB sheet
 * (F3Go30-qeuu.7, ADR-023).
 *
 * An installable onEdit trigger on the Template (handleTeamDbEdit_, installed by
 * syncTrackerTriggers_ via ensureTeamDbEditTrigger_). When an admin changes a TeamDB Team cell
 * from OLD to NEW, the row is renamed — or, when NEW is already a roster team, merged into it — and
 * every PAX on OLD in the current and next month's trackers (Responses + PaxDB) is moved to NEW
 * (teamRoster.js renameTeamFromEdit_). Sheets fires onEdit only when an edit is committed, never per
 * keystroke. Also holds buildTeamRenameDeps_, the one place that knows which trackers a rename
 * touches and what to do to a tracker after it changes — shared with the renameTeam admin action.
 */
var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
// Functions only at load time: GAS evaluates files in name order and only function declarations are
// hoisted across files, so a teamRoster.js VAR imported here at load would still be undefined
// (teamDbEditTrigger.js sorts first). TEAM_DB_SHEET_NAME_ is resolved at call time instead.
var teamDbEditRosterModule_ = gasRequire_('./teamRoster.js', ['renameTeamFromEdit_', 'refreshTeamDbDuplicates_']);
var teamDbEditSignupModule_ = gasRequire_('./signupWebapp.js', ['getCurrentAndNextMonths_']);
var teamDbEditTrackerSheetModule_ = gasRequire_('./trackerSheet.js', ['sortTrackerSheet_']);
var teamDbEditPaxCacheModule_ = gasRequire_('./PaxCache.js', ['wipePaxCacheAndRelatedCachesForSheet_']);

var TEAM_DB_EDIT_HANDLER_ = 'handleTeamDbEdit_';
var TEAM_DB_TOAST_TITLE_ = 'Go30 teams';

/**
 * The trackers a team rename rewrites (current + next month, when they exist) and what happens to
 * each one that changed: flush (Tracker column B is a VLOOKUP into Responses), re-sort, wipe caches.
 * @returns {{trackerSheetIds: Array<string>, openById: function(string): Spreadsheet, onTrackerChanged: function(string)}}
 */
function buildTeamRenameDeps_(templateSpreadsheet, contextDate) {
  var months = teamDbEditSignupModule_.getCurrentAndNextMonths_(templateSpreadsheet, undefined, contextDate);
  var opened = {};
  function openById(sheetId) {
    return opened[sheetId] || (opened[sheetId] = SpreadsheetApp.openById(sheetId));
  }
  return {
    trackerSheetIds: [months.current, months.next]
      .filter(function(m) { return m && m.sheetId; })
      .map(function(m) { return m.sheetId; }),
    openById: openById,
    onTrackerChanged: function(sheetId) {
      SpreadsheetApp.flush();
      var trackerSheet = openById(sheetId).getSheetByName('Tracker');
      if (trackerSheet) teamDbEditTrackerSheetModule_.sortTrackerSheet_(trackerSheet);
      teamDbEditPaxCacheModule_.wipePaxCacheAndRelatedCachesForSheet_(sheetId);
    }
  };
}

function teamDbToast_(e, message) {
  try { e.source.toast(message, TEAM_DB_TOAST_TITLE_, 10); } catch (err) { /* toast is best-effort */ }
}

/**
 * Decides and applies what a TeamDB edit means. Collaborators are injected so the decision is
 * node-tested: {renameFromEdit, buildDeps, refreshDuplicates}.
 * @returns {{action: 'ignored'|'added'|'restored'|'reconciled'|'failed', result: (Object|undefined)}}
 */
function processTeamDbEdit_(e, collab) {
  var range = e && e.range;
  var teamDbSheetName = gasRequire_('./teamRoster.js', ['TEAM_DB_SHEET_NAME_']).TEAM_DB_SHEET_NAME_;
  if (!range || range.getSheet().getName() !== teamDbSheetName) return { action: 'ignored' };
  var touchesTeamColumn = range.getColumn() === 1 && range.getRow() + range.getNumRows() - 1 >= 2;
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
    if (touchesTeamColumn) {
      teamDbToast_(e, 'Team names are reconciled one Team cell at a time — this multi-cell edit was not applied to trackers. Edit each Team cell on its own.');
    }
    return { action: 'ignored' };
  }
  if (range.getColumn() !== 1 || range.getRow() < 2) return { action: 'ignored' };

  var oldName = String(e.oldValue == null ? '' : e.oldValue).trim();
  var newName = String(e.value == null ? '' : e.value).trim();
  if (!oldName) {
    if (newName) collab.refreshDuplicates();
    return { action: newName ? 'added' : 'ignored' };
  }
  if (!newName) {
    range.setValue(e.oldValue);
    teamDbToast_(e, 'A team can\'t be deleted by clearing its name — set its Status to "hidden" instead. Restored "' + oldName + '".');
    return { action: 'restored' };
  }
  if (newName === oldName) return { action: 'ignored' };

  var result = collab.renameFromEdit(e.source, range.getRow(), e.oldValue, e.value, collab.buildDeps(e.source));
  if (!result || !result.ok) {
    teamDbToast_(e, 'Could not update trackers for "' + newName + '": ' + ((result && result.error) || 'unknown error'));
    return { action: 'failed', result: result };
  }
  teamDbToast_(e, result.merged
    ? 'Merged "' + oldName + '" into "' + result.team + '" — ' + result.responsesUpdated + ' PAX moved.'
    : 'Renamed "' + oldName + '" to "' + result.team + '" — ' + result.responsesUpdated + ' PAX updated.');
  return { action: 'reconciled', result: result };
}

/** Installable onEdit handler on the Template (see file header). */
function handleTeamDbEdit_(e) {
  return GasLogger.run(TEAM_DB_EDIT_HANDLER_, function() {
    return processTeamDbEdit_(e, {
      renameFromEdit: teamDbEditRosterModule_.renameTeamFromEdit_,
      buildDeps: function(templateSpreadsheet) { return buildTeamRenameDeps_(templateSpreadsheet); },
      refreshDuplicates: function() {
        teamDbEditRosterModule_.refreshTeamDbDuplicates_(e.range.getSheet());
      }
    });
  });
}

/** Installs the Template's TeamDB edit trigger if it is missing. Idempotent. */
function ensureTeamDbEditTrigger_(templateSpreadsheet) {
  var templateId = templateSpreadsheet.getId();
  var exists = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === TEAM_DB_EDIT_HANDLER_ && t.getTriggerSourceId() === templateId;
  });
  if (exists) return { installed: false };
  ScriptApp.newTrigger(TEAM_DB_EDIT_HANDLER_).forSpreadsheet(templateSpreadsheet).onEdit().create();
  return { installed: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TEAM_DB_EDIT_HANDLER_: TEAM_DB_EDIT_HANDLER_,
    buildTeamRenameDeps_: buildTeamRenameDeps_,
    processTeamDbEdit_: processTeamDbEdit_,
    handleTeamDbEdit_: handleTeamDbEdit_,
    ensureTeamDbEditTrigger_: ensureTeamDbEditTrigger_,
  };
}
