/*
 * dashboardCache.js
 *
 * The dashboard's CacheService layer, extracted out of dashboardWebapp.js (REVIEW-260910's
 * split-cache finding — see docs/staging/review-260910.md). Gives the three
 * previously-duplicated CacheService key-string literals (dashboardWebapp.js's own copies,
 * TrackerEditTrigger.js's RESPONSES_LAYOUT_CACHE_PREFIX_TE_/RESPONSES_VALUES_CACHE_PREFIX_TE_,
 * and addResponseOnSubmit.js's FULL_ROSTER_CACHE_PREFIX_TRACKER_ARS_/RESPONSES_ARS_) one home:
 * both of those files now require this module's key-builder functions instead of hand-copying
 * the prefix strings. Pure structural move — no cache key string or TTL changed; this file's
 * contents are the original dashboardWebapp.js block verbatim.
 *
 * Two cache families:
 *  - Sheet-level layout caches (Tracker row2/row3, Responses header+column-map): long-TTL,
 *    read-mostly, no write-through — only tracker-creation/restructuring invalidates them.
 *  - Whole-sheet value caches (Tracker/Responses full range): long-TTL, explicitly
 *    write-through-invalidated by invalidateFullRosterCache_ on every check-in/signup write, and
 *    patched in place by TrackerEditTrigger.js's onEdit-driven invalidation.
 */

var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
var dashboardCacheResponseUtilsModule_ = gasRequire_('./response_utils.js', ['resolveResponseColumns']);
var resolveResponseColumns_dc_ = dashboardCacheResponseUtilsModule_.resolveResponseColumns;

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
  var layout = { headers: headers, columns: resolveResponseColumns_dc_(headers) };

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRACKER_LAYOUT_CACHE_TTL_SECONDS_: TRACKER_LAYOUT_CACHE_TTL_SECONDS_,
    trackerLayoutCacheKey_: trackerLayoutCacheKey_,
    makeLazySpreadsheet_dw_: makeLazySpreadsheet_dw_,
    responsesLayoutCacheKey_: responsesLayoutCacheKey_,
    getCachedResponsesLayoutOnly_: getCachedResponsesLayoutOnly_,
    getResponsesLayout_: getResponsesLayout_,
    serializeRow3ForCache_: serializeRow3ForCache_,
    deserializeRow3FromCache_: deserializeRow3FromCache_,
    getCachedTrackerLayoutOnly_: getCachedTrackerLayoutOnly_,
    getTrackerLayout_: getTrackerLayout_,
    FULL_ROSTER_CACHE_TTL_SECONDS_: FULL_ROSTER_CACHE_TTL_SECONDS_,
    trackerValuesCacheKey_: trackerValuesCacheKey_,
    responsesValuesCacheKey_: responsesValuesCacheKey_,
    serializeSheetValuesForCache_: serializeSheetValuesForCache_,
    deserializeSheetValuesFromCache_: deserializeSheetValuesFromCache_,
    getCachedSheetValuesOnly_: getCachedSheetValuesOnly_,
    setCachedSheetValues_: setCachedSheetValues_,
    invalidateFullRosterCache_: invalidateFullRosterCache_,
  };
}
