/**
 * TrackerEditTrigger — proactive PaxCache invalidation for manual Tracker/Responses/Bonus
 * Tracker edits (F3Go30-440b.4; extended to Responses + Bonus Tracker by F3Go30-o39s.2).
 *
 * Narrow complement to ADR-013 (which rejected onEdit for the checkin/dashboard round trip,
 * since script-driven SpreadsheetApp writes never fire onEdit): this only ever needs to catch
 * a human editing a Tracker/Responses/Bonus Tracker cell directly in the Sheets UI, which is
 * exactly the case onEdit *does* fire for. Every webapp-driven write already self-invalidates
 * via write-through
 * (setPaxCacheRow_dw_, PaxCache.js), so this trigger has nothing to do
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
var getPaxCacheRow_te_ = (trackerEditTriggerPaxCacheModule_ && trackerEditTriggerPaxCacheModule_.getPaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxCacheRow_);
var setPaxCacheRow_te_ = (trackerEditTriggerPaxCacheModule_ && trackerEditTriggerPaxCacheModule_.setPaxCacheRow_)
  || (typeof globalThis !== 'undefined' && globalThis.setPaxCacheRow_);
var getPaxRosterIndex_te_ = (trackerEditTriggerPaxCacheModule_ && trackerEditTriggerPaxCacheModule_.getPaxRosterIndex_)
  || (typeof globalThis !== 'undefined' && globalThis.getPaxRosterIndex_);
var paxCacheNormalizeName_te_ = (trackerEditTriggerPaxCacheModule_ && trackerEditTriggerPaxCacheModule_.paxCacheNormalizeName_)
  || (typeof globalThis !== 'undefined' && globalThis.paxCacheNormalizeName_);

// Named with trailing underscore so GAS does not auto-register it as a simple trigger.
var TRACKER_EDIT_HANDLER_ = 'handleTrackerEdit_';

// Sheets whose manual edits invalidate PaxCache (F3Go30-o39s.2) — Tracker, Responses, and
// Bonus Tracker all feed PaxCache/CacheService state; other sheets (Config, Links, Activity,
// etc.) don't, so wiping on those would just be wasted work.
var TRACKER_EDIT_INVALIDATING_SHEETS_ = { 'Tracker': true, 'Responses': true, 'Bonus Tracker': true };

// C10 (F3Go30-o39s.11) — per-row patch instead of a whole-sheet wipe, for the two sheets whose
// PaxCache rows are keyed per-PAX (kind: 'tracker' | 'responses'). Bonus Tracker deliberately has
// no entry here — its caches are whole-sheet arrays (C5-shaped work to patch), so it always falls
// through to the wipe below, exactly as before this issue.
var TRACKER_EDIT_KIND_BY_SHEET_ = { 'Tracker': 'tracker', 'Responses': 'responses' };

// First data row for each sheet (rows before this are headers and always fall back to a wipe).
var TRACKER_EDIT_HEADER_ROWS_ = { 'Tracker': 4, 'Responses': 2 };

// Tracker's F3 Name column is fixed (column A) — mirrors dashboardWebapp.js's TRACKER_NAME_COL_.
var TRACKER_EDIT_NAME_COL_ZERO_BASED_ = 0;

// Duplicated cache-key strings/TTL for dashboardWebapp.js's Responses layout + full-roster
// CacheService blobs (responsesLayoutCacheKey_/responsesValuesCacheKey_, FULL_ROSTER_CACHE_TTL_
// SECONDS_) — same convention PaxCache.js's wipePaxCacheAndRelatedCachesForSheet_ already uses
// (see its comment) to avoid a circular dependency between this file and dashboardWebapp.js.
// Keep in sync if either changes.
var RESPONSES_LAYOUT_CACHE_PREFIX_TE_ = 'go30dash:responsesLayout:';
var RESPONSES_VALUES_CACHE_PREFIX_TE_ = 'go30dash:responsesValues:';
var FULL_ROSTER_CACHE_TTL_SECONDS_TE_ = 21600; // CacheService's max.

/**
 * Reads the Responses sheet's F3 Name column index (zero-based) from dashboardWebapp.js's own
 * long-TTL layout cache, without resolving it live — a cache-only read keeps this patch cheap; a
 * cache miss just means "not cheap right now" and falls back to the whole-sheet wipe below rather
 * than duplicating resolveResponseColumns_'s header-matching logic here.
 * @returns {?number} zero-based column index, or null on a miss/corrupt entry.
 */
function resolveResponsesNameColFromCachedLayout_te_(sheetId) {
  try {
    var raw = CacheService.getScriptCache().get(RESPONSES_LAYOUT_CACHE_PREFIX_TE_ + sheetId);
    if (!raw) return null;
    var layout = JSON.parse(raw);
    var col = layout && layout.columns && layout.columns.F3_NAME;
    return (typeof col === 'number') ? col : null;
  } catch (e) {
    return null;
  }
}

/** Dates aren't JSON-safe — same marker-object convention as dashboardWebapp.js's serializeSheetValuesForCache_. */
function serializeDateMarker_te_(v) {
  return v instanceof Date ? { __d: v.toISOString() } : v;
}

/**
 * Patches one cell of the Responses full-roster CacheService blob (dashboardWebapp.js's
 * responsesValuesCacheKey_) in place, if it's currently cached — a direct JSON patch of the one
 * touched cell rather than a full deserialize/reserialize round trip of every row.
 */
function patchResponsesFullRosterCache_te_(sheetId, sheetRow, sheetCol, newValue) {
  var cacheKey = RESPONSES_VALUES_CACHE_PREFIX_TE_ + sheetId;
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(cacheKey);
    if (!raw) return; // no cached blob to patch — the next fresh read builds one anyway
    var rows = JSON.parse(raw);
    var rowIndex = sheetRow - 2; // Responses data starts at sheet row 2 (row 1 is the header)
    var colIndex = sheetCol - 1;
    var row = rows[rowIndex];
    if (rowIndex < 0 || !row || colIndex < 0 || colIndex >= row.length) return;
    row[colIndex] = serializeDateMarker_te_(newValue);
    cache.put(cacheKey, JSON.stringify(rows), FULL_ROSTER_CACHE_TTL_SECONDS_TE_);
  } catch (e) { /* best-effort — leaves the pre-existing cached entry as-is */ }
}

/**
 * C10 (F3Go30-o39s.11): attempts to patch just the edited PAX's cached row instead of wiping the
 * whole sheet's cache. Returns false (caller falls back to the existing whole-sheet wipe) for
 * every edit this can't safely narrow down to one known PAX row: Bonus Tracker (whole-sheet array
 * caches, out of scope here), a multi-row/multi-column edit (paste, header row), a header row
 * itself, a Responses edit whose column layout isn't cheaply available, or — the key safety
 * guard — a row whose live name doesn't match what the cached roster index expects at that row
 * offset. That last check is what catches a row insert/delete: GAS's onEdit event doesn't
 * reliably distinguish a structural shift from a plain cell edit, so without it a shifted row
 * could silently patch a DIFFERENT pax's cached data under the touched row's now-stale identity.
 * @returns {boolean} true if the edit was fully handled (patched, or correctly a no-op).
 */
function tryPatchSinglePaxRow_te_(e, sheet, sheetName, sheetId) {
  try {
    var kind = TRACKER_EDIT_KIND_BY_SHEET_[sheetName];
    if (!kind) return false;

    var range = e.range;
    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return false;

    var row = range.getRow();
    var headerRows = TRACKER_EDIT_HEADER_ROWS_[sheetName];
    if (row < headerRows) return false;

    var col = range.getColumn();
    var nameCol; // 1-based sheet column holding the PAX's F3 Name
    if (kind === 'tracker') {
      nameCol = TRACKER_EDIT_NAME_COL_ZERO_BASED_ + 1;
    } else {
      var f3NameColZeroBased = resolveResponsesNameColFromCachedLayout_te_(sheetId);
      if (f3NameColZeroBased === null) return false;
      nameCol = f3NameColZeroBased + 1;
    }

    var name = sheet.getRange(row, nameCol).getValue();
    if (!name) return false;

    var normName = paxCacheNormalizeName_te_(name);
    var rosterIndex = getPaxRosterIndex_te_(kind, sheetId);
    var expectedRowIndex = row - headerRows;
    if (!rosterIndex || rosterIndex[normName] !== expectedRowIndex) return false;

    var newValue = range.getValue();
    var cachedRow = getPaxCacheRow_te_(kind, sheetId, name);
    if (cachedRow) {
      var colIndex = col - 1;
      if (colIndex >= 0 && colIndex < cachedRow.length) {
        var patchedRow = cachedRow.slice();
        patchedRow[colIndex] = newValue;
        setPaxCacheRow_te_(kind, sheetId, name, patchedRow);
      }
    }

    if (kind === 'responses') {
      patchResponsesFullRosterCache_te_(sheetId, row, col, newValue);
    }

    return true;
  } catch (err) {
    return false; // any unexpected failure here just falls back to the whole-sheet wipe
  }
}

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
 * Edit-trigger entry point. Filters to the sheets PaxCache actually caches — Tracker,
 * Responses, and Bonus Tracker; edits to Config, Links, Activity, etc. don't touch anything
 * PaxCache caches, so wiping on those would just be wasted work. Tries a narrow per-PAX-row
 * patch first (C10, F3Go30-o39s.11 — tryPatchSinglePaxRow_te_) and only falls back to a
 * whole-sheet wipe when the edit can't be safely narrowed to one known PAX row.
 * @param {Object} e Edit event object.
 */
function handleTrackerEdit_(e) {
  return GasLogger.run('handleTrackerEdit_', function() {
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    if (!TRACKER_EDIT_INVALIDATING_SHEETS_[sheetName]) return;

    var sheetId = resolveTrackerEditSpreadsheet_(e).getId();

    // C10 (F3Go30-o39s.11): try a narrow per-PAX-row patch first — cheaper than a whole-sheet
    // wipe + cold rebuild for the common case (a single manual cell edit). Falls through to the
    // wipe below for anything it can't safely narrow down (see tryPatchSinglePaxRow_te_).
    if (tryPatchSinglePaxRow_te_(e, sheet, sheetName, sheetId)) {
      GasLogger.log('handleTrackerEdit_.patched', { sheetId: sheetId, sheetName: sheetName });
      return;
    }

    // Deliberately logged here, not just inside the shared wipe helper — this is the Axiom
    // signal that this onEdit trigger itself fired a whole-sheet wipe (as opposed to the narrow
    // per-row patch above). GasLogger.run (not a bare GasLogger.log) is required here — log()
    // only queues the entry in memory; flush() is what actually POSTs to Axiom, and only .run()
    // calls flush() automatically.
    GasLogger.log('handleTrackerEdit_.invalidated', { sheetId: sheetId, sheetName: sheetName });
    wipePaxCacheAndRelatedCachesForSheet_te_(sheetId);
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
