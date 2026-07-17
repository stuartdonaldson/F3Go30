/**
 * TrackerEditTrigger — proactive PaxCache invalidation for manual Tracker edits (F3Go30-440b.4).
 *
 * Narrow complement to ADR-013 (which rejected onEdit for the checkin/dashboard round trip,
 * since script-driven SpreadsheetApp writes never fire onEdit): this only ever needs to catch
 * a human editing a Tracker cell directly in the Sheets UI, which is exactly the case onEdit
 * *does* fire for. Every webapp-driven write already self-invalidates via write-through
 * (setPaxCacheRow_dw_/markPaxCacheFreshNow_, PaxCache.js), so this trigger has nothing to do
 * with any user-facing round trip's latency — see docs/staging/tracker-edit-cache-invalidation.md.
 *
 * Registered centrally (ADR-010 pattern, mirrors addResponseOnSubmit.js's setupFormSubmitTrigger/
 * clearFormSubmitTrigger exactly): installable triggers run using the code of the project that
 * creates them, not the project bound to the watched spreadsheet, so an edit trigger created
 * here from the Template's script project can reach the shared PaxCache PropertiesService store
 * that a Tracker copy's own (unused) bound script never could.
 *
 * Trigger-count lifecycle (auto-clear on trash / nightly sweep for aged-out trackers) is
 * out of scope here — tracked separately as F3Go30-440b.5.
 */

var trackerEditTriggerPaxCacheModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./PaxCache.js')
  : null;
var wipePaxCacheAndRelatedCachesForSheet_te_ = (trackerEditTriggerPaxCacheModule_ && trackerEditTriggerPaxCacheModule_.wipePaxCacheAndRelatedCachesForSheet_)
  || (typeof globalThis !== 'undefined' && globalThis.wipePaxCacheAndRelatedCachesForSheet_);
var markPaxCacheFreshNow_te_ = (trackerEditTriggerPaxCacheModule_ && trackerEditTriggerPaxCacheModule_.markPaxCacheFreshNow_)
  || (typeof globalThis !== 'undefined' && globalThis.markPaxCacheFreshNow_);

// Named with trailing underscore so GAS does not auto-register it as a simple trigger.
var TRACKER_EDIT_HANDLER_ = 'handleTrackerEdit_';

/**
 * Installs the edit trigger for a specific tracker spreadsheet. Callable from any script
 * project with access to `spreadsheet` (e.g. the Template, for a tracker it just created) —
 * same centralization rationale as setupFormSubmitTrigger.
 * @param {Spreadsheet} spreadsheet Target tracker spreadsheet.
 */
function setupTrackerEditTrigger_(spreadsheet) {
  clearTrackerEditTrigger_(spreadsheet);

  ScriptApp.newTrigger(TRACKER_EDIT_HANDLER_)
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

/**
 * Removes any existing edit trigger for a specific tracker spreadsheet only. Scoped by
 * getTriggerSourceId() so clearing one tracker's trigger never touches another's.
 * @param {Spreadsheet} spreadsheet Target tracker spreadsheet.
 */
function clearTrackerEditTrigger_(spreadsheet) {
  var ssId = spreadsheet.getId();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === TRACKER_EDIT_HANDLER_ && trigger.getTriggerSourceId() === ssId) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Resolves the spreadsheet an edit event landed in directly from the event's own range, rather
 * than assuming the handler runs bound to the target spreadsheet (ADR-010) — same pattern as
 * resolveFormSubmitSpreadsheet_ (addResponseOnSubmit.js).
 * @param {Object} e Edit event object (forSpreadsheet().onEdit()).
 * @returns {Spreadsheet}
 */
function resolveTrackerEditSpreadsheet_(e) {
  return e.range.getSheet().getParent();
}

/**
 * Edit-trigger entry point. Filters to the Tracker sheet only — edits to Config, Responses,
 * Bonus Tracker, etc. don't touch anything PaxCache caches, so wiping on those would just be
 * wasted work. Whole-sheet wipe (not per-row) — matches ensurePaxCacheFresh_'s existing
 * coarseness, so behavior doesn't get more or less correct, just proactive instead of polled.
 * @param {Object} e Edit event object.
 */
function handleTrackerEdit_(e) {
  return GasLogger.run('handleTrackerEdit_', function() {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== 'Tracker') return;

    var sheetId = resolveTrackerEditSpreadsheet_(e).getId();
    // Deliberately logged here, not just inside the shared wipe helper — this is the one
    // signal that distinguishes "the onEdit trigger itself fired" from ensurePaxCacheFresh_'s
    // own Drive-modtime poll also catching the same human edit on the next request (both would
    // see an updated modtime, so a wipe alone doesn't prove which path caught it). GasLogger.run
    // (not a bare GasLogger.log) is required here — log() only queues the entry in memory;
    // flush() is what actually POSTs to Axiom, and only .run() calls flush() automatically.
    GasLogger.log('handleTrackerEdit_.invalidated', { sheetId: sheetId });
    wipePaxCacheAndRelatedCachesForSheet_te_(sheetId);
    markPaxCacheFreshNow_te_(sheetId);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setupTrackerEditTrigger_: setupTrackerEditTrigger_,
    clearTrackerEditTrigger_: clearTrackerEditTrigger_,
    resolveTrackerEditSpreadsheet_: resolveTrackerEditSpreadsheet_,
    handleTrackerEdit_: handleTrackerEdit_
  };
}
