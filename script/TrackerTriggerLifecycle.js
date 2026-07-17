/**
 * Tracker trigger lifecycle hardening (F3Go30-440b.5) — an on-demand admin action (WebApp.js's
 * `syncTrackerTriggers`) that combines:
 *
 *  1. Backfill — registers the onEdit trigger (setupTrackerEditTrigger_, F3Go30-440b.4) on any
 *     currently-active TrackerDB row that doesn't have one yet. Needed because F3Go30-440b.4/
 *     o39s.5 only wire new trackers going forward (CreateNewTracker.js/CopyTemplate.js) —
 *     trackers that existed before that landed have no edit trigger at all.
 *  2. Cleanup — clears both per-tracker trigger types (form-submit + edit) for any TrackerDB
 *     row whose spreadsheet is trashed in Drive, or whose StartDate has aged out (older than
 *     the previous month) — bounding trigger growth against the 20-triggers/user/script Apps
 *     Script quota long-term (see docs/staging/tracker-edit-cache-invalidation.md "Trigger
 *     lifecycle"). Deliberately on-demand, not a nightly trigger, per 2026-07-17 developer
 *     decision — can be wired to a nightly cadence later once proven.
 *
 * planTrackerTriggerSync_ is the pure decision function (unit-tested); syncTrackerTriggers_
 * is the GAS orchestration wrapper that reads TrackerDB, calls ScriptApp/DriveApp/
 * SpreadsheetApp, and applies the plan.
 */

var trackerTriggerLifecycleEditModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./TrackerEditTrigger.js')
  : null;
var ttlSetupTrackerEditTrigger_ = (trackerTriggerLifecycleEditModule_ && trackerTriggerLifecycleEditModule_.setupTrackerEditTrigger_)
  || (typeof globalThis !== 'undefined' && globalThis.setupTrackerEditTrigger_);
var TTL_TRACKER_EDIT_HANDLER_ = 'handleTrackerEdit_';
var TTL_FORM_SUBMIT_HANDLER_ = (typeof globalThis !== 'undefined' && globalThis.FORM_SUBMIT_HANDLER_) || 'handleFormSubmit_';
var TTL_LEGACY_FORM_SUBMIT_HANDLER_ = (typeof globalThis !== 'undefined' && globalThis.LEGACY_FORM_SUBMIT_HANDLER_) || 'onFormSubmit';

// Every per-tracker installable trigger handler this sweep cleans up on trash/aging-out.
var TTL_PER_TRACKER_HANDLERS_ = [TTL_TRACKER_EDIT_HANDLER_, TTL_FORM_SUBMIT_HANDLER_, TTL_LEGACY_FORM_SUBMIT_HANDLER_];

/** Same YYYY-MM/YYYY-MM-DD-tolerant parse as go30tools.js's _parseDateish_ (duplicated to avoid
 * a circular require — see PaxCache.js's own comment on this convention). */
function ttlParseDateish_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  var text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}$/.test(text)) text += '-01';
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** First-of-month Date, `monthsOffset` calendar months before/after `date`'s month. */
function ttlMonthStart_(date, monthsOffset) {
  return new Date(date.getFullYear(), date.getMonth() + (monthsOffset || 0), 1);
}

/**
 * Pure decision function: given TrackerDB rows, the set of sheetIds that already have an
 * edit trigger registered, today's date, and a trashed-lookup callback, decides which
 * sheetIds need a trigger backfilled vs. cleaned up. No GAS API calls — fully unit-testable.
 * @param {Array<{sheetId:string, startDate:*}>} trackerRows
 * @param {Array<string>} existingEditTriggerSourceIds sheetIds that already have TTL_TRACKER_EDIT_HANDLER_ registered.
 * @param {Date} today
 * @param {function(string):boolean} isTrashedFn Returns true if the given sheetId's spreadsheet is trashed/gone.
 * @returns {{backfill:Array<string>, cleanup:Array<{sheetId:string, reason:string}>}}
 */
function planTrackerTriggerSync_(trackerRows, existingEditTriggerSourceIds, today, isTrashedFn) {
  var cutoff = ttlMonthStart_(today, -1); // start of the previous month — the "no longer active" boundary
  var editTriggerSet = {};
  (existingEditTriggerSourceIds || []).forEach(function(id) { editTriggerSet[id] = true; });

  var backfill = [];
  var cleanup = [];

  (trackerRows || []).forEach(function(row) {
    var sheetId = row && row.sheetId;
    if (!sheetId) return;

    var trashed = !!isTrashedFn(sheetId);
    if (trashed) {
      cleanup.push({ sheetId: sheetId, reason: 'trashed' });
      return;
    }

    var startDate = ttlParseDateish_(row.startDate);
    var agedOut = startDate ? startDate.getTime() < cutoff.getTime() : false;
    if (agedOut) {
      cleanup.push({ sheetId: sheetId, reason: 'aged_out' });
      return;
    }

    if (!editTriggerSet[sheetId]) {
      backfill.push(sheetId);
    }
  });

  return { backfill: backfill, cleanup: cleanup };
}

/**
 * Removes every per-tracker installable trigger (form-submit + edit, current and legacy
 * handler names) whose source matches sheetId — direct ScriptApp filtering, same pattern as
 * WebApp.js's deleteOrphanedTriggers, deliberately not routed through
 * clearTrackerEditTrigger_/clearFormSubmitTrigger (which both require opening the spreadsheet
 * by id first — unnecessary here, and can't be relied on for a spreadsheet that's trashed or
 * gone).
 * @param {string} sheetId
 * @returns {number} count of triggers removed.
 */
function clearAllPerTrackerTriggersBySheetId_(sheetId) {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (TTL_PER_TRACKER_HANDLERS_.indexOf(trigger.getHandlerFunction()) === -1) return;
    if (trigger.getTriggerSourceId() !== sheetId) return;
    ScriptApp.deleteTrigger(trigger);
    removed++;
  });
  return removed;
}

/**
 * GAS orchestration: reads TrackerDB from `spreadsheet`, computes the plan
 * (planTrackerTriggerSync_), and applies it — backfilling setupTrackerEditTrigger_ on active
 * rows missing one, and clearing every per-tracker trigger for trashed/aged-out rows. Returns
 * a summary matching the shape of WebApp.js's other admin actions (listTriggers,
 * deleteOrphanedTriggers): counts plus per-tracker detail.
 * @param {Spreadsheet} spreadsheet The Template spreadsheet (holds TrackerDB).
 * @param {Date=} today Defaults to `new Date()` — override for deterministic tests/backfills.
 * @returns {{ok:true, backfilledCount:number, cleanedCount:number, detail:Array<Object>}}
 */
function syncTrackerTriggers_(spreadsheet, today) {
  var trackerState = _readTrackerDbRowsBySheetId_(spreadsheet);
  var trackerRows = Object.keys(trackerState.bySheetId).map(function(id) { return trackerState.bySheetId[id]; });

  var existingEditTriggerSourceIds = ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return trigger.getHandlerFunction() === TTL_TRACKER_EDIT_HANDLER_; })
    .map(function(trigger) { return trigger.getTriggerSourceId(); });

  var isTrashedFn = function(sheetId) {
    try {
      return DriveApp.getFileById(sheetId).isTrashed();
    } catch (e) {
      return true; // file gone entirely — treat the same as trashed
    }
  };

  var plan = planTrackerTriggerSync_(trackerRows, existingEditTriggerSourceIds, today || new Date(), isTrashedFn);

  var detail = [];
  var backfilledCount = 0;
  plan.backfill.forEach(function(sheetId) {
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      ttlSetupTrackerEditTrigger_(ss);
      backfilledCount++;
      detail.push({ sheetId: sheetId, action: 'backfilled' });
    } catch (err) {
      detail.push({ sheetId: sheetId, action: 'backfill_failed', error: err.message });
    }
  });

  var cleanedCount = 0;
  plan.cleanup.forEach(function(item) {
    try {
      var removed = clearAllPerTrackerTriggersBySheetId_(item.sheetId);
      if (removed > 0) cleanedCount++;
      detail.push({ sheetId: item.sheetId, action: 'cleaned', reason: item.reason, triggersRemoved: removed });
    } catch (err) {
      detail.push({ sheetId: item.sheetId, action: 'cleanup_failed', reason: item.reason, error: err.message });
    }
  });

  GasLogger.log('syncTrackerTriggers_', { backfilledCount: backfilledCount, cleanedCount: cleanedCount });
  return { ok: true, backfilledCount: backfilledCount, cleanedCount: cleanedCount, detail: detail };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    planTrackerTriggerSync_: planTrackerTriggerSync_,
    clearAllPerTrackerTriggersBySheetId_: clearAllPerTrackerTriggersBySheetId_,
    syncTrackerTriggers_: syncTrackerTriggers_,
    ttlParseDateish_: ttlParseDateish_,
    ttlMonthStart_: ttlMonthStart_
  };
}
