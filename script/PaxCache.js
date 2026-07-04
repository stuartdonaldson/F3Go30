/*
 * PaxCache.js
 *
 * Per-PAX read cache for the check-in/dashboard web app (dashboardWebapp.js) and the signup
 * webapp's write paths (signupWebapp.js). Backed by PropertiesService rather than CacheService:
 * CacheService caps expiration at 6 hours, which is shorter than the gap between a PAX's daily
 * check-ins, so a TTL-based cache would be a guaranteed miss every single day. PropertiesService
 * has no built-in expiry — freshness here comes from write-through invalidation (the webapp's
 * own writes) plus the Drive-modtime staleness gate below (manual spreadsheet edits, and
 * anything else this webapp didn't itself write through).
 *
 * Manual edits were originally meant to be caught by an onEdit simple trigger, but a monthly
 * Tracker spreadsheet is a Drive copy (CreateNewTracker.js's makeCopy) and a copy carries its
 * own independent bound script + PropertiesService store. onEdit installed as a simple trigger
 * runs in *that* copy's script context, which has no way to reach the PropertiesService store
 * this deployed webapp actually reads from — so it could never invalidate anything. See
 * ensurePaxCacheFresh_ below for the replacement.
 *
 * Two kinds of entry, both namespaced by {kind, sheetId}:
 *   - Roster index: name (normalized) -> zero-based data-row offset, one JSON blob per sheet.
 *     Lets a cache miss jump straight to the right row (single-row read) instead of scanning
 *     every PAX's name column.
 *   - Per-PAX row cache: this PAX's full row of values, one property per PAX.
 *
 * Deliberately never caches a miss/"not found" result — see F3Go30 project discussion: caching
 * a negative lookup risks masking a brand-new signup (e.g. one that arrived via the Form-submit
 * fallback path, which this module has no visibility into) for as long as the entry would live.
 * A miss always re-reads live and is not stored.
 */

var PAX_CACHE_PREFIX_ = 'go30pax:';
var PAX_CACHE_ROSTER_PREFIX_ = 'go30idx:';
var PAX_CACHE_ASOF_PREFIX_ = 'go30asof:';

// Per-execution memo of {kind, sheetId} pairs already freshness-checked this request, so a
// request that looks up several PAX on the same sheet pays for one DriveApp call, not one per
// lookup. Apps Script re-evaluates top-level script state on every execution, so this is
// naturally empty at the start of each request — nothing to reset between requests.
var paxCacheFreshnessMemo_ = {};

function paxCacheNormalizeName_(name) {
  return String(name || '').trim().toLowerCase();
}

function paxCacheRowKey_(kind, sheetId, name) {
  return PAX_CACHE_PREFIX_ + kind + ':' + sheetId + ':' + paxCacheNormalizeName_(name);
}

function paxCacheRowPrefix_(kind, sheetId) {
  return PAX_CACHE_PREFIX_ + kind + ':' + sheetId + ':';
}

function paxCacheRosterKey_(kind, sheetId) {
  return PAX_CACHE_ROSTER_PREFIX_ + kind + ':' + sheetId;
}

function paxCacheAsOfKey_(sheetId) {
  return PAX_CACHE_ASOF_PREFIX_ + sheetId;
}

/** Dates aren't JSON-safe — round-trip any Date cell through a plain marker object. */
function paxCacheSerializeRow_(row) {
  return (row || []).map(function(v) { return v instanceof Date ? { __d: v.toISOString() } : v; });
}

function paxCacheDeserializeRow_(row) {
  return (row || []).map(function(v) { return (v && typeof v === 'object' && v.__d) ? new Date(v.__d) : v; });
}

/** Returns the cached row for {kind, sheetId, name}, or null on a miss (never throws). */
function getPaxCacheRow_(kind, sheetId, name) {
  ensurePaxCacheFresh_(sheetId);
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(paxCacheRowKey_(kind, sheetId, name));
    if (!raw) return null;
    return paxCacheDeserializeRow_(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function setPaxCacheRow_(kind, sheetId, name, rowValues) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      paxCacheRowKey_(kind, sheetId, name), JSON.stringify(paxCacheSerializeRow_(rowValues))
    );
  } catch (e) { /* payload too large or Properties unavailable — caller still has the live read */ }
}

function deletePaxCacheRow_(kind, sheetId, name) {
  try { PropertiesService.getScriptProperties().deleteProperty(paxCacheRowKey_(kind, sheetId, name)); } catch (e) { /* best-effort */ }
}

/**
 * Bulk write-through for a full-roster reload — collapses what would otherwise be one
 * PropertiesService.setProperty call per PAX plus one for the roster index (N+1 script-execution
 * ops) into a single setProperties call. The only caller (resolveCheckinIdentityFull_ in
 * dashboardWebapp.js) already has every row in memory from one full-range Sheet read, so there's
 * no reason to write it back one row at a time. setProperties merges into the existing store
 * (does not delete keys outside rowsByName/rosterIndex), so unrelated properties — other sheets'
 * cache entries, the asOf marker, WEBAPP_URL, etc. — are untouched.
 * @param {string} kind
 * @param {string} sheetId
 * @param {Object<string, Array>} rowsByName Map of raw (non-normalized) name -> row values.
 * @param {Object<string, number>} rosterIndex Already-built {normalizedName: rowIndex} map.
 */
function setPaxCacheRowsBulk_(kind, sheetId, rowsByName, rosterIndex) {
  try {
    var batch = {};
    Object.keys(rowsByName || {}).forEach(function(name) {
      batch[paxCacheRowKey_(kind, sheetId, name)] = JSON.stringify(paxCacheSerializeRow_(rowsByName[name]));
    });
    batch[paxCacheRosterKey_(kind, sheetId)] = JSON.stringify(rosterIndex || {});
    PropertiesService.getScriptProperties().setProperties(batch);
  } catch (e) { /* payload too large or Properties unavailable — caller still has the live read */ }
}

/** Returns the {name: rowIndex} roster index for {kind, sheetId}, or null if not cached. */
function getPaxRosterIndex_(kind, sheetId) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(paxCacheRosterKey_(kind, sheetId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setPaxRosterIndex_(kind, sheetId, indexObj) {
  try {
    PropertiesService.getScriptProperties().setProperty(paxCacheRosterKey_(kind, sheetId), JSON.stringify(indexObj || {}));
  } catch (e) { /* payload too large or Properties unavailable */ }
}

function deletePaxRosterIndex_(kind, sheetId) {
  try { PropertiesService.getScriptProperties().deleteProperty(paxCacheRosterKey_(kind, sheetId)); } catch (e) { /* best-effort */ }
}

/**
 * Adds/updates a single name's entry in an already-cached roster index without a full rebuild.
 * Lock-guarded (same convention as signupWebapp.js's ensureResponseColumn_): this is a
 * read-modify-write on a single shared property, and two concurrent signups patching the same
 * roster index would otherwise race — both read the pre-patch index, each add their own entry,
 * and whichever writes last overwrites (silently drops) the other's patch.
 */
function patchPaxRosterIndex_(kind, sheetId, name, rowIndex) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('patchPaxRosterIndex_.lockFailed', { kind: kind, sheetId: sheetId, error: e.message });
    return; // best-effort — next full reader rebuilds the index from live data anyway
  }
  try {
    var index = getPaxRosterIndex_(kind, sheetId);
    if (!index) return; // no cached index to patch — next reader will build it fresh anyway
    index[paxCacheNormalizeName_(name)] = rowIndex;
    setPaxRosterIndex_(kind, sheetId, index);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Wipes every cached entry (roster index + all per-PAX rows) for {kind, sheetId} — the fallback
 * used for edits too broad to invalidate precisely (header-row edits, bulk pastes, row
 * insert/delete). PropertiesService has no prefix-delete, so this enumerates all keys once;
 * fine for a rare, human-triggered event, not meant for the hot request path.
 */
function wipePaxCacheForSheet_(kind, sheetId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var prefix = paxCacheRowPrefix_(kind, sheetId);
    props.getKeys().forEach(function(key) {
      if (key.indexOf(prefix) === 0) props.deleteProperty(key);
    });
    props.deleteProperty(paxCacheRosterKey_(kind, sheetId));
  } catch (e) { /* best-effort */ }
}

/**
 * Wipes every PaxCache entry this script project has ever written — all kinds, all sheetIds —
 * in one pass. Unlike wipePaxCacheForSheet_ (one sheet), this is the "start over" hatch behind
 * handleAdminPost_'s invalidateAllCache admin action (WebApp.js): the only PropertiesService
 * store that matters is the one the *deployed web app* reads from, since PaxCache entries are
 * written exclusively by dashboardWebapp.js/signupWebapp.js running in that one script project.
 * A monthly Tracker spreadsheet is a Drive copy (CreateNewTracker.js's makeCopy) and therefore
 * carries its own independent bound script + PropertiesService store — running this function
 * from inside a Tracker copy's own project would silently wipe an empty, irrelevant store, not
 * the shared one. That's why the "Invalidate Cache" menu item (onOpen.js) calls the admin
 * action over HTTP instead of invoking this function locally.
 * @returns {number} how many properties were deleted.
 */
function wipeAllPaxCache_() {
  var wiped = 0;
  try {
    var props = PropertiesService.getScriptProperties();
    props.getKeys().forEach(function(key) {
      if (key.indexOf(PAX_CACHE_PREFIX_) === 0 || key.indexOf(PAX_CACHE_ROSTER_PREFIX_) === 0) {
        props.deleteProperty(key);
        wiped++;
      }
    });
  } catch (e) { /* best-effort */ }
  return wiped;
}

/**
 * Gates every PaxCache read on the Tracker/Responses spreadsheet's Drive-level modification
 * time — the replacement for the onEdit trigger that can't reach this store (see file header).
 * DriveApp.getFileById().getLastUpdated() is readable from any script project regardless of
 * which one owns the file, so unlike PropertiesService/CacheService it isn't split per Drive
 * copy. Any edit — human, via the Sheets UI, or programmatic, from any script — bumps it.
 *
 * Coarser than the old per-row onEdit invalidation: any edit wipes the whole sheet's cache
 * (both kinds, since tracker + responses tabs live in one file and share one modtime), rather
 * than just the touched row. Also means the request right after a write-through pays for one
 * avoidable rebuild (this webapp's own write bumps the live modtime; the next read's stored
 * asOf is still the pre-write value, so it looks stale even though the write already kept the
 * cache correct) — that's a self-healing performance cost, not a correctness bug: the rebuild
 * reads live data and immediately re-marks asOf, so no request ever serves stale data.
 *
 * Memoized per sheetId for this execution (paxCacheFreshnessMemo_) so a request touching many
 * PAX on the same sheet pays for one DriveApp call, not one per lookup. Fails open on any Drive
 * error (quota, transient failure, or — in tests — no DriveApp global at all): trusts whatever
 * is already cached rather than blocking the request.
 */
function ensurePaxCacheFresh_(sheetId) {
  if (Object.prototype.hasOwnProperty.call(paxCacheFreshnessMemo_, sheetId)) return;
  paxCacheFreshnessMemo_[sheetId] = true;
  try {
    var liveModTime = DriveApp.getFileById(sheetId).getLastUpdated().getTime();
    var props = PropertiesService.getScriptProperties();
    var key = paxCacheAsOfKey_(sheetId);
    var storedAsOf = Number(props.getProperty(key)) || 0;
    if (liveModTime > storedAsOf) {
      wipePaxCacheForSheet_('tracker', sheetId);
      wipePaxCacheForSheet_('responses', sheetId);
      // Also clears dashboardWebapp.js's full-roster CacheService cache (trackerValuesCacheKey_/
      // responsesValuesCacheKey_) for the same sheet — CacheService has no key-enumeration or
      // prefix-delete (unlike PropertiesService.getKeys() above), so the exact key strings are
      // duplicated here rather than referencing those functions directly, to avoid a circular
      // dependency between PaxCache.js and dashboardWebapp.js. Keep in sync if either changes.
      try {
        var cache = CacheService.getScriptCache();
        cache.remove('go30dash:trackerValues:' + sheetId);
        cache.remove('go30dash:responsesValues:' + sheetId);
      } catch (e2) { /* best-effort — write-through invalidation at the point of write is the primary path */ }
    }
    props.setProperty(key, String(liveModTime));
  } catch (e) { /* Drive lookup unavailable — trust existing cache rather than block the request */ }
}

/** Resets the per-execution freshness memo — test-only; production never needs to since Apps
 *  Script re-evaluates top-level script state fresh on every execution. */
function resetPaxCacheFreshnessMemo_() {
  paxCacheFreshnessMemo_ = {};
}

/**
 * Resolves the zero-based data-row offset for f3Name within {kind, sheetId}'s roster index,
 * rebuilding the index from readNameColumn_() on a miss. Never caches a name that isn't found.
 * @param {function(): Array<string>} readNameColumn_ Lazily reads the full name column (only
 *   called on an index miss) — kind-specific (Tracker vs Responses) row/column layout lives in
 *   the caller, not here.
 * @returns {number} rowIndex, or -1 if not found.
 */
function resolvePaxRowIndex_(kind, sheetId, f3Name, readNameColumn_) {
  var norm = paxCacheNormalizeName_(f3Name);
  if (!norm) return -1;

  ensurePaxCacheFresh_(sheetId);
  var index = getPaxRosterIndex_(kind, sheetId);
  if (index && Object.prototype.hasOwnProperty.call(index, norm)) return index[norm];

  var names = readNameColumn_() || [];
  var rebuilt = {};
  for (var i = 0; i < names.length; i++) {
    var n = paxCacheNormalizeName_(names[i]);
    if (n && !Object.prototype.hasOwnProperty.call(rebuilt, n)) rebuilt[n] = i;
  }
  setPaxRosterIndex_(kind, sheetId, rebuilt);
  return Object.prototype.hasOwnProperty.call(rebuilt, norm) ? rebuilt[norm] : -1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    paxCacheNormalizeName_: paxCacheNormalizeName_,
    getPaxCacheRow_: getPaxCacheRow_,
    setPaxCacheRow_: setPaxCacheRow_,
    setPaxCacheRowsBulk_: setPaxCacheRowsBulk_,
    deletePaxCacheRow_: deletePaxCacheRow_,
    getPaxRosterIndex_: getPaxRosterIndex_,
    setPaxRosterIndex_: setPaxRosterIndex_,
    deletePaxRosterIndex_: deletePaxRosterIndex_,
    patchPaxRosterIndex_: patchPaxRosterIndex_,
    wipePaxCacheForSheet_: wipePaxCacheForSheet_,
    wipeAllPaxCache_: wipeAllPaxCache_,
    resolvePaxRowIndex_: resolvePaxRowIndex_,
    ensurePaxCacheFresh_: ensurePaxCacheFresh_,
    resetPaxCacheFreshnessMemo_: resetPaxCacheFreshnessMemo_,
  };
}
