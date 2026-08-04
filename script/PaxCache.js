/*
 * PaxCache.js
 *
 * Per-PAX read cache for the check-in/dashboard web app (dashboardWebapp.js) and the signup
 * webapp's write paths (signupWebapp.js). Backed by PropertiesService rather than CacheService:
 * CacheService caps expiration at 6 hours, which is shorter than the gap between a PAX's daily
 * check-ins, so a TTL-based cache would be a guaranteed miss every single day. PropertiesService
 * has no built-in expiry — freshness here comes solely from write-through invalidation (the
 * webapp's own writes, see PaxCache read/write pairs below) plus TrackerEditTrigger.js's
 * onEdit-driven invalidation for manual spreadsheet edits (F3Go30-o39s epic).
 *
 * Manual edits were originally meant to be caught by an onEdit simple trigger, but a monthly
 * Tracker spreadsheet is a Drive copy (CreateNewTracker.js's makeCopy) and a copy carries its
 * own independent bound script + PropertiesService store. onEdit installed as a simple trigger
 * runs in *that* copy's script context, which has no way to reach the PropertiesService store
 * this deployed webapp actually reads from. TrackerEditTrigger.js solves this by installing the
 * onEdit trigger from the Template's own script project (installable triggers run using the
 * creating project's code, not the bound spreadsheet's), so it can reach the shared store.
 * An earlier per-request Drive-modtime poll (ensurePaxCacheFresh_) backstopped this before every
 * write path had write-through coverage and onEdit was provisioned on every live tracker;
 * retired once both landed (F3Go30-o39s.7) since it was pure per-request latency with nothing
 * left to catch.
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

// Nightly purge threshold (F3Go30-440b.2) — go30pax:/go30idx: entries are keyed per
// sheetId and nothing ever deleted them once a tracker month aged out, accumulating forever
// against PropertiesService's hard caps (500KB total store, 9KB/value, ~500 keys — the capacity
// risk flagged and deferred in F3Go30-5nfj.3). ~2 months mirrors CheckinSessions.js's
// CHECKIN_SESSION_STALE_DAYS_ magnitude, and is comfortably longer than any cross-month lookback
// this webapp performs (getPriorMonthTailValues_ in dashboardWebapp.js only ever reaches back
// one month), so nothing still in active use is ever purged.
var PAX_CACHE_PURGE_RETENTION_DAYS_ = 60;

var paxCacheGo30ToolsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./go30tools.js')
  : null;
var readTrackerDbRowsBySheetId_pc_ = (paxCacheGo30ToolsModule_ && paxCacheGo30ToolsModule_._readTrackerDbRowsBySheetId_)
  || (typeof globalThis !== 'undefined' && globalThis._readTrackerDbRowsBySheetId_);
var listNamespaceRegistryRows_pc_ = (paxCacheGo30ToolsModule_ && paxCacheGo30ToolsModule_._listNamespaceRegistryRows_)
  || (typeof globalThis !== 'undefined' && globalThis._listNamespaceRegistryRows_);

var paxCacheCheckinSessionsModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./CheckinSessions.js')
  : null;
var listActiveCheckinSessionF3Names_pc_ = (paxCacheCheckinSessionsModule_ && paxCacheCheckinSessionsModule_.listActiveCheckinSessionF3Names_)
  || (typeof globalThis !== 'undefined' && globalThis.listActiveCheckinSessionF3Names_);

// Per-execution hit/miss/wipe counters (F3Go30-440b.1) — folded into the caller's own
// per-request GasLogger event (dashboardWebapp.js's checkinWebapp.resolveIdentity.timing /
// checkinWebapp.dashboard) via getPaxCacheRequestStats_ rather than logged here directly, so
// cache effectiveness becomes queryable in Axiom with zero new log volume (see file header).
// Naturally reset every execution (GAS re-evaluates top-level script state fresh each time) —
// resetPaxCacheRequestStats_ exists for tests only.
var paxCacheRequestStats_ = { wiped: false, rosterHit: 0, rosterMiss: 0, rowHit: 0, rowMiss: 0 };

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

/** Dates aren't JSON-safe — round-trip any Date cell through a plain marker object. */
function paxCacheSerializeRow_(row) {
  return (row || []).map(function(v) { return v instanceof Date ? { __d: v.toISOString() } : v; });
}

function paxCacheDeserializeRow_(row) {
  return (row || []).map(function(v) { return (v && typeof v === 'object' && v.__d) ? new Date(v.__d) : v; });
}

/** Returns the cached row for {kind, sheetId, name}, or null on a miss (never throws). */
function getPaxCacheRow_(kind, sheetId, name) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(paxCacheRowKey_(kind, sheetId, name));
    if (!raw) { paxCacheRequestStats_.rowMiss++; return null; }
    paxCacheRequestStats_.rowHit++;
    return paxCacheDeserializeRow_(JSON.parse(raw));
  } catch (e) {
    paxCacheRequestStats_.rowMiss++;
    return null;
  }
}

/**
 * Bulk read counterpart to getPaxCacheRow_ — fetches the whole PropertiesService store in one
 * getProperties() call rather than one getProperty() RPC per name (F3Go30 perf finding, 2026-07:
 * a per-key loop over a ~24-PAX roster measured ~13x slower than a single getProperties() call,
 * since per-call RPC overhead dominates over payload size — see buildTrackerValuesFromPaxCache_,
 * dashboardWebapp.js, the only caller). Same hit/miss stats + deserialize behavior as
 * getPaxCacheRow_ so switching a caller over preserves existing cache-effectiveness telemetry.
 * @param {string} kind
 * @param {string} sheetId
 * @param {Array<string>} names Already-normalized names (e.g. from a roster index's own keys).
 * @returns {Object<string, Array>} name -> deserialized row, present only for names actually
 *   found — a missing name is simply absent, mirroring getPaxCacheRow_'s null-on-miss.
 */
function getPaxCacheRowsBulk_(kind, sheetId, names) {
  var result = {};
  var store;
  try {
    store = PropertiesService.getScriptProperties().getProperties();
  } catch (e) {
    (names || []).forEach(function() { paxCacheRequestStats_.rowMiss++; });
    return result;
  }
  (names || []).forEach(function(name) {
    var raw = store[paxCacheRowKey_(kind, sheetId, name)];
    if (!raw) { paxCacheRequestStats_.rowMiss++; return; }
    try {
      result[name] = paxCacheDeserializeRow_(JSON.parse(raw));
      paxCacheRequestStats_.rowHit++;
    } catch (e) {
      paxCacheRequestStats_.rowMiss++;
    }
  });
  return result;
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
 * cache entries, WEBAPP_URL, etc. — are untouched.
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
 * Builds a {normalizedName: rowIndex} roster index from a flat list of raw names in row order —
 * first occurrence of a normalized name wins (mirrors dashboardWebapp.js's own roster-building
 * loop, which does the same over full row data; this variant exists separately because its
 * callers only ever have a bare name column, never full rows, to build from).
 * @param {Array<string>} names Raw (non-normalized) names, in row order.
 * @returns {Object<string, number>}
 */
function buildRosterIndexFromNames_(names) {
  var rosterIndex = {};
  (names || []).forEach(function(name, idx) {
    var norm = paxCacheNormalizeName_(name);
    if (!norm) return;
    if (!Object.prototype.hasOwnProperty.call(rosterIndex, norm)) rosterIndex[norm] = idx;
  });
  return rosterIndex;
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
 * Refreshes one PAX's cached row from the sheet AFTER a write to that row — the only correct way
 * to write-through a row edit (F3Go30-xg8f, F3Go30-s1a5).
 *
 * The tempting cheaper move — patch the edited column into the copy of the row the request read
 * on the way in, and cache that — is wrong for two independent reasons, both observed live:
 *   1. LOST UPDATE. Two concurrent check-ins for the same PAX both snapshot the same pre-write
 *      row, each patch a different day column, and whichever writes the cache last silently
 *      drops the other's day. The sheet is fine (different cells), so the corruption shows up
 *      only on the dashboard, and it is permanent — buildTrackerValuesFromPaxCache_ keeps
 *      serving the row as a hit because the roster index is still complete.
 *   2. STALE DERIVED COLUMNS. Score / Raw Score / bonus totals are sheet formulas. A snapshot
 *      patch carries their PRE-write values forward, so a PAX's own score lags their own
 *      check-in until something rebuilds the row.
 * A row derived from post-write sheet state has neither problem by construction.
 *
 * Lock-guarded over (re-read -> cache write) — same convention as patchPaxRosterIndex_ above.
 * The cell write itself deliberately stays OUTSIDE the lock: making the re-read and the cache
 * write atomic with respect to each other is already sufficient to order concurrent writers
 * (a later writer's re-read cannot be interleaved into an earlier writer's section, so the last
 * cache write always reflects every cell write that preceded it), and keeping the section down
 * to two operations avoids serializing all check-ins script-wide during a morning burst.
 *
 * flush() first: setValue is queued, and the formula recalc it triggers is not visible to a
 * getValues in the same execution until pending writes are applied.
 *
 * On lock failure or a failed re-read, the entry is DELETED rather than written from a
 * derivation that can't be trusted — the next reader rebuilds it live. Correctness over cache hit.
 *
 * @param {string} kind 'tracker' | 'responses'
 * @param {string} sheetId Spreadsheet id the row lives in.
 * @param {string} name PAX name to key the cache entry under.
 * @param {Sheet} sheet Already-open sheet handle the write just went through.
 * @param {number} sheetRow 1-based sheet row number that was written.
 */
function refreshPaxCacheRowFromSheet_(kind, sheetId, name, sheet, sheetRow) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('refreshPaxCacheRowFromSheet_.lockFailed', { kind: kind, sheetId: sheetId, error: e.message });
    deletePaxCacheRow_(kind, sheetId, name);
    return;
  }
  try {
    SpreadsheetApp.flush();
    var row = sheet.getRange(sheetRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    setPaxCacheRow_(kind, sheetId, name, row);
  } catch (e) {
    GasLogger.log('refreshPaxCacheRowFromSheet_.rereadFailed', { kind: kind, sheetId: sheetId, error: e.message });
    deletePaxCacheRow_(kind, sheetId, name);
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
      // PAX_HISTORY_PREFIX_ (F3Go30-5uk2's f3Name-keyed rolling history window) included here too
      // — it's the same PropertiesService store, and a wrong/stale streak needs the same "force a
      // reload" escape hatch as every other PaxCache entry. A wipe here just means the next
      // dashboard read for that PAX cold-starts via getPaxHistoryWindowValues_'s self-heal path.
      if (key.indexOf(PAX_CACHE_PREFIX_) === 0 || key.indexOf(PAX_CACHE_ROSTER_PREFIX_) === 0 || key.indexOf(PAX_HISTORY_PREFIX_) === 0) {
        props.deleteProperty(key);
        wiped++;
      }
    });
  } catch (e) { /* best-effort */ }
  return wiped;
}

/**
 * Wipes both PaxCache kinds (tracker + responses) plus the CacheService-backed full-roster/
 * bonus caches for one sheetId — the complete "this sheet's cache is no longer trustworthy"
 * action, used by handleTrackerEdit_ (TrackerEditTrigger.js's onEdit-driven invalidation) so
 * the CacheService key list only ever lives in one place.
 */
function wipePaxCacheAndRelatedCachesForSheet_(sheetId) {
  wipePaxCacheForSheet_('tracker', sheetId);
  wipePaxCacheForSheet_('responses', sheetId);
  // Also clears dashboardWebapp.js's full-roster CacheService cache (trackerValuesCacheKey_/
  // responsesValuesCacheKey_) for the same sheet — CacheService has no key-enumeration or
  // prefix-delete (unlike PropertiesService.getKeys() above), so the exact key strings are
  // duplicated here rather than referencing those functions directly, to avoid a circular
  // dependency between PaxCache.js and dashboardWebapp.js. Keep in sync if either changes.
  // Also clears bonusWebapp.js's per-sheet bonus entry/pill-shape caches
  // (bonusEntriesCacheKey_/bonusRowsCacheKey_) so a manual Bonus Tracker edit is picked up
  // without waiting for BONUS_ENTRIES_CACHE_TTL_SECONDS_ or a webapp-driven bonus write
  // (F3Go30-nzi0). Same exact-key-string duplication convention as above.
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('go30dash:trackerValues:' + sheetId);
    cache.remove('go30dash:responsesValues:' + sheetId);
    cache.remove('go30dash:bonusEntries:' + sheetId);
    cache.remove('go30dash:bonusRows:' + sheetId);
    // Tracker row2/row3 + Responses header layout blobs (trackerLayoutCacheKey_/
    // responsesLayoutCacheKey_) previously relied on their 6h TTL alone even for a structural
    // edit caught right here (a header-row edit fails tryPatchSinglePaxRow_te_'s row check and
    // falls through to this wipe) — clearing them too means a manual day-column/header edit is
    // picked up on the very next request instead of after up to 6h of staleness.
    cache.remove('go30dash:trackerLayout:' + sheetId);
    cache.remove('go30dash:responsesLayout:' + sheetId);
  } catch (e2) { /* best-effort — write-through invalidation at the point of write is the primary path */ }
}

/**
 * Snapshot of this execution's PaxCache hit/miss/wipe counters (F3Go30-440b.1), field-named to
 * drop straight into a caller's own per-request GasLogger event via Object.assign — see
 * dashboardWebapp.js's checkinWebapp.resolveIdentity.timing / checkinWebapp.dashboard call
 * sites. Deliberately not a log line of its own (see file header: no per-lookup log volume).
 */
function getPaxCacheRequestStats_() {
  return {
    paxCacheWiped: paxCacheRequestStats_.wiped,
    paxRosterHit: paxCacheRequestStats_.rosterHit,
    paxRosterMiss: paxCacheRequestStats_.rosterMiss,
    paxRowHit: paxCacheRequestStats_.rowHit,
    paxRowMiss: paxCacheRequestStats_.rowMiss,
  };
}

/** Resets the per-execution request-stats counters — test-only; production never needs to since
 *  Apps Script re-evaluates top-level script state fresh on every execution. */
function resetPaxCacheRequestStats_() {
  paxCacheRequestStats_ = { wiped: false, rosterHit: 0, rosterMiss: 0, rowHit: 0, rowMiss: 0 };
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

  var index = getPaxRosterIndex_(kind, sheetId);
  if (index && Object.prototype.hasOwnProperty.call(index, norm)) {
    paxCacheRequestStats_.rosterHit++;
    return index[norm];
  }
  paxCacheRequestStats_.rosterMiss++;

  var names = readNameColumn_() || [];
  var rebuilt = {};
  for (var i = 0; i < names.length; i++) {
    var n = paxCacheNormalizeName_(names[i]);
    if (n && !Object.prototype.hasOwnProperty.call(rebuilt, n)) rebuilt[n] = i;
  }
  setPaxRosterIndex_(kind, sheetId, rebuilt);
  return Object.prototype.hasOwnProperty.call(rebuilt, norm) ? rebuilt[norm] : -1;
}

/**
 * Every sheetId this PaxCache store could legitimately still be holding entries for, across
 * EVERY namespace — not just the bound spreadsheet's own TrackerDB (F3Go30-440b.2 follow-up).
 * PaxCache's PropertiesService store is shared by the one deployed script regardless of which
 * namespace a request's `ns` targeted (see file header / purgeStalePaxCache_'s docstring), but
 * TrackerDB is NOT — each namespace (ADR-014's copyTemplate) gets its own copied spreadsheet
 * with its own independent TrackerDB. Without this, an orphan sweep keyed only off the bound
 * spreadsheet's TrackerDB would wrongly treat every live namespace tracker as orphaned and wipe
 * it nightly. A namespace whose own spreadsheet can no longer be opened (trashed, or the
 * namespace was already torn down but a stray NamespaceDB row survives) contributes nothing and
 * is logged, not thrown — one unreachable namespace must never abort the whole run.
 * @param {Spreadsheet} boundSpreadsheet
 * @returns {Object<string, boolean>} {sheetId: true}
 */
function collectKnownTrackerSheetIds_(boundSpreadsheet) {
  var known = {};
  // The bound spreadsheet's OWN id, not just its trackers' — DR-01's go30hist entries are scoped
  // by resolved template spreadsheet id, and requests with no ns (the parent Template itself)
  // resolve to boundSpreadsheet (resolveTemplateSpreadsheet_, go30tools.js). Without this, every
  // go30hist entry the parent Template ever writes for itself would look orphaned here.
  try { known[boundSpreadsheet.getId()] = true; } catch (e) { /* best-effort */ }
  var boundRows = (readTrackerDbRowsBySheetId_pc_ ? readTrackerDbRowsBySheetId_pc_(boundSpreadsheet) : { bySheetId: {} }).bySheetId || {};
  Object.keys(boundRows).forEach(function(sheetId) { known[sheetId] = true; });

  var namespaces = listNamespaceRegistryRows_pc_ ? listNamespaceRegistryRows_pc_(boundSpreadsheet) : [];
  namespaces.forEach(function(nsRow) {
    if (!nsRow.templateId) return;
    known[nsRow.templateId] = true; // the namespace's own Template root, in case anything ever caches against it directly
    try {
      var nsSpreadsheet = SpreadsheetApp.openById(nsRow.templateId);
      var nsRows = (readTrackerDbRowsBySheetId_pc_ ? readTrackerDbRowsBySheetId_pc_(nsSpreadsheet) : { bySheetId: {} }).bySheetId || {};
      Object.keys(nsRows).forEach(function(sheetId) { known[sheetId] = true; });
    } catch (e) {
      GasLogger.log('purgeStalePaxCache_.namespaceUnreachable', { namespace: nsRow.namespace, templateId: nsRow.templateId, error: e.message });
    }
  });
  return known;
}

/** Extracts the sheetId (go30pax:/go30idx:) or namespace scopeId (go30hist:, DR-01) embedded in
 *  a PropertiesService key, or null for any other key (this store also holds unrelated entries —
 *  WEBAPP_URL, etc.). The two prefixes place their discriminator at a different split index —
 *  kind:sheetId:name vs scopeId:name — so this function is the one place that knows both shapes;
 *  callers get "the sheet/namespace this key belongs to" without caring which. */
function extractSheetIdFromPaxCacheKey_(key) {
  if (key.indexOf(PAX_CACHE_PREFIX_) === 0 || key.indexOf(PAX_CACHE_ROSTER_PREFIX_) === 0) {
    return key.split(':')[2] || null;
  }
  if (key.indexOf(PAX_HISTORY_PREFIX_) === 0) {
    return key.split(':')[1] || null;
  }
  return null;
}

/** Wipes every go30hist: entry scoped to scopeId — the PAX_HISTORY_PREFIX_ counterpart of
 *  wipePaxCacheForSheet_, used by the orphan sweep below (DR-01's scoped key makes this possible;
 *  previously these entries carried no sheet/namespace discriminator at all). */
function wipePaxHistoryForScope_(scopeId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var prefix = PAX_HISTORY_PREFIX_ + scopeId + ':';
    props.getKeys().forEach(function(key) {
      if (key.indexOf(prefix) === 0) props.deleteProperty(key);
    });
  } catch (e) { /* best-effort */ }
}

/**
 * Nightly cleanup (F3Go30-440b.2; see setupPaxCachePurgeTrigger_, onOpen.js's wiring): purges
 * every PaxCache entry (both kind=tracker and kind=responses) for any
 * TrackerDB row whose tracker month started more than PAX_CACHE_PURGE_RETENTION_DAYS_ ago.
 * wipePaxCacheForSheet_ already does the actual per-sheet cleanup — this just walks TrackerDB
 * deciding which sheetIds qualify. Mirrors CheckinSessions.js's cleanupStaleCheckinSessions_
 * nightly-trigger pattern (checked/purged/kept counts via GasLogger). A row with no parseable
 * startDate is kept rather than guessed at — better to under-purge than to wipe a live tracker.
 *
 * Second pass, same run: a sheet too recent to qualify for that wholesale wipe can still carry
 * per-PAX rows for someone who's stopped showing up altogether — the tracker-age check alone
 * would keep those forever. CheckinSessions.js already prunes that PAX's session on its own
 * nightly cadence (cleanupStaleCheckinSessions_), so a PAX with no row left there is reused as
 * the activity signal (listActiveCheckinSessionF3Names_) rather than re-deriving a second
 * staleness window here — every identify/signup creates or touches a session, so absence means
 * genuinely stale, not just "never used a bookmark." Skipped entirely (never purges anyone) when
 * the sessions store isn't wired, rather than treating an empty/unreadable list as "purge all."
 *
 * Third pass: orphan sweep (F3Go30-440b.2 follow-up). The first two passes only ever look at
 * sheetIds TrackerDB currently knows about — a sheetId whose TrackerDB row was removed entirely
 * (cleanupTrackerArtifact_ deleting a single tracker, or teardownEnvironment removing a whole
 * namespace) is invisible to them and would otherwise keep its PaxCache entries forever. This
 * pass instead enumerates the PropertiesService store directly and wipes any go30pax:/go30idx:
 * entry whose sheetId isn't in collectKnownTrackerSheetIds_'s cross-namespace "still
 * live somewhere" set. Skipped entirely when that set comes back empty — a TrackerDB read
 * failure/misconfiguration must never be mistaken for "nothing is live" and wipe everything.
 * @param {Date=} now Injectable for tests; defaults to the real current time.
 * @param {Spreadsheet=} spreadsheet Injectable for tests; defaults to the active spreadsheet.
 * @returns {{checked: number, purged: number, kept: number, paxRowsPurged: number, orphanedSheetsPurged: number, historyEntriesPurged: number}}
 */
function purgeStalePaxCache_(now, spreadsheet) {
  now = now || new Date();
  spreadsheet = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  var rowsBySheetId = (readTrackerDbRowsBySheetId_pc_ ? readTrackerDbRowsBySheetId_pc_(spreadsheet) : { bySheetId: {} }).bySheetId || {};
  var retentionMs = PAX_CACHE_PURGE_RETENTION_DAYS_ * 24 * 60 * 60 * 1000;
  var activeNames = listActiveCheckinSessionF3Names_pc_ ? listActiveCheckinSessionF3Names_pc_(spreadsheet) : null;

  var checked = 0, purged = 0, kept = 0, paxRowsPurged = 0;
  var purgedSheetIds = {};
  Object.keys(rowsBySheetId).forEach(function(sheetId) {
    checked++;
    var startDateRaw = rowsBySheetId[sheetId].startDate;
    var startDate = startDateRaw instanceof Date ? startDateRaw : new Date(startDateRaw);
    if (!isNaN(startDate.getTime()) && (now.getTime() - startDate.getTime()) > retentionMs) {
      wipePaxCacheForSheet_('tracker', sheetId);
      wipePaxCacheForSheet_('responses', sheetId);
      purged++;
      purgedSheetIds[sheetId] = true;
      return;
    }

    kept++;
    if (!activeNames) return;
    ['tracker', 'responses'].forEach(function(kind) {
      var index = getPaxRosterIndex_(kind, sheetId);
      if (!index) return;
      Object.keys(index).forEach(function(normName) {
        if (!Object.prototype.hasOwnProperty.call(activeNames, normName)) {
          deletePaxCacheRow_(kind, sheetId, normName);
          paxRowsPurged++;
        }
      });
    });
  });

  var orphanedSheetsPurged = 0;
  var knownSheetIds = collectKnownTrackerSheetIds_(spreadsheet);
  if (Object.keys(knownSheetIds).length) {
    var orphanSheetIds = {};
    try {
      PropertiesService.getScriptProperties().getKeys().forEach(function(key) {
        var sheetId = extractSheetIdFromPaxCacheKey_(key);
        if (sheetId && !knownSheetIds[sheetId] && !purgedSheetIds[sheetId]) orphanSheetIds[sheetId] = true;
      });
    } catch (e) { /* best-effort */ }
    Object.keys(orphanSheetIds).forEach(function(sheetId) {
      wipePaxCacheForSheet_('tracker', sheetId);
      wipePaxCacheForSheet_('responses', sheetId);
      // DR-01: go30hist is now scoped the same way (scopeId in place of sheetId), so an orphaned
      // scope's history entries are visible to — and reaped by — this same sweep instead of
      // needing their own bespoke pass (see the fourth pass below, which now only has to cover
      // per-PAX staleness WITHIN a still-live scope).
      wipePaxHistoryForScope_(sheetId);
      orphanedSheetsPurged++;
    });
  }

  // Fourth pass (F3Go30-uz9e.2): go30hist entries for a retired/typo'd PAX WITHIN the bound
  // spreadsheet's own scope — a name that ever checked in but stopped, or was mistyped, would
  // otherwise keep a Script Property forever against the 500KB store quota even though its scope
  // is still live (so the orphan sweep above never touches it). Reaped off the same
  // CheckinSessions activity signal the per-PAX row pass uses, and safe to be aggressive about:
  // unlike the row cache this window is derived data end to end, so a wrongly-reaped entry
  // self-heals from the Tracker on the next dashboard read. Scoped to the bound spreadsheet's own
  // id (DR-01) — activeNames is itself only that scope's CheckinSessions, so reaping another
  // scope's entries here would use the wrong activity signal for them entirely.
  var historyEntriesPurged = 0;
  if (activeNames) {
    try {
      var boundScopeId = spreadsheet.getId();
      var historyPrefix = PAX_HISTORY_PREFIX_ + boundScopeId + ':';
      PropertiesService.getScriptProperties().getKeys().forEach(function(key) {
        if (key.indexOf(historyPrefix) !== 0) return;
        var normName = key.slice(historyPrefix.length);
        if (Object.prototype.hasOwnProperty.call(activeNames, normName)) return;
        PropertiesService.getScriptProperties().deleteProperty(key);
        historyEntriesPurged++;
      });
    } catch (e) { /* best-effort — the rest of the purge already ran */ }
  }

  var result = { checked: checked, purged: purged, kept: kept, paxRowsPurged: paxRowsPurged, orphanedSheetsPurged: orphanedSheetsPurged, historyEntriesPurged: historyEntriesPurged };
  GasLogger.log('purgeStalePaxCache_', result);
  return result;
}

/** GasLogger-wrapped entry point for the nightly trigger (see onOpen.js). */
function purgeStalePaxCache() {
  return GasLogger.run('purgeStalePaxCache', function() {
    return purgeStalePaxCache_();
  });
}

// ── f3Name-keyed rolling history window (F3Go30-5uk2, PAX data model migration Slice 1) ──
//
// A third PaxCache entry kind, deliberately NOT namespaced by tracker sheetId like the two above
// — this is the first step toward a per-PAX record that spans months
// (docs/pax-data-model-and-contract.md §3.1/§5), so a monthly tracker rollover must not start a
// new window. It IS namespace-scoped, though (DR-01, 2026-08-04 design review): PropertiesService
// belongs to the executing script project, not to any one spreadsheet, so two namespaces sharing
// that project (ADR-014) would otherwise collide on the same PAX name. The key therefore carries
// scopeId — the resolved template spreadsheet id, stable across that namespace's monthly
// trackers — never the tracker sheetId, which would defeat the cross-month window that is the
// whole point of this cache. One entry per {scopeId, PAX}, holding a dense trailing window of day
// outcomes so buildDashboardPaxRow_ (dashboardWebapp.js) can compute streak/maxStreak30 correctly
// for every PAX on the board, not just the logged-in viewer, without a month-boundary stitch.
//
// Shape: { historyEndDate: "YYYY-MM-DD", days: "<1-char/day string, oldest first>" }.
// historyEndDate is the calendar day the LAST character of days represents — required, since a
// bare day-string alone can't say which day it ends on. Every write shifts days and advances
// historyEndDate together (advancePaxHistoryEntry_), so the anchor can never drift out of sync
// with its data.
var PAX_HISTORY_PREFIX_ = 'go30hist:';

// Storage cap only — how many trailing days one stored entry may hold. Deliberately NOT tied to
// MAX_STREAK_WINDOW_DAYS_ (30, dashboardWebapp.js).
//
// It used to be 40, with the rebuild path storing back only the trailing 30, so effective storage
// was 30 — shorter than the 44 that rollingAverage and priorMonthDayValues have needed since
// F3Go30-uz9e.1 (a full calendar month, 31, plus the client's display padding,
// DASHBOARD_DISPLAY_WINDOW_DAYS_ - 1 = 13). That only ever worked because the padding is wanted
// early in the month, when the current month's own dayValues is still short.
//
// F3Go30-uz9e.3 decouples the two. The window is a growth surface for later migration slices
// (docs/pax-data-model-and-contract.md §5) and costs one character per day per PAX — 400 days is
// ~400 bytes, well inside PropertiesService's 9KB/value cap and, across a realistic roster,
// inside the 500KB store cap. The 30-day streak cap now lives where streaks are computed
// (computeStreak_/computeMaxStreak_'s windowDays argument), so growing this never changes a
// displayed streak.
var PAX_HISTORY_WINDOW_DAYS_ = 400;

// How far back a REBUILD populates, as opposed to how much the window may hold. A rebuild reads
// the prior month's tracker, so "back to the start of the previous month" is the natural stopping
// point — 31 (prior) + 31 (current) worst case. That is exactly what lets a 30-day streak be
// computed from the window alone, with no prior-month spreadsheet read, throughout the following
// month. Days beyond this accumulate the ordinary way, one per write, up to
// PAX_HISTORY_WINDOW_DAYS_.
var PAX_HISTORY_BACKFILL_DAYS_ = 62;

/** @param {string} scopeId Namespace identity — the resolved template spreadsheet id. Not the
 *  tracker sheetId (see the header comment on PAX_HISTORY_PREFIX_ above). */
function paxHistoryKey_(scopeId, f3Name) {
  return PAX_HISTORY_PREFIX_ + scopeId + ':' + paxCacheNormalizeName_(f3Name);
}

/** 1-char encoding for one day's Tracker cell value — 1/0/-1 mirror the Tracker's own values;
 *  '.' marks a day with no data (blank cell, or a gap this window never observed). */
function paxHistoryEncodeValue_(value) {
  if (value === 1) return '1';
  if (value === 0) return '0';
  if (value === -1) return 'X';
  return '.';
}

function paxHistoryDecodeChar_(ch) {
  if (ch === '1') return 1;
  if (ch === '0') return 0;
  if (ch === 'X') return -1;
  return '';
}

/** Decodes a stored days string back into the same 1/0/-1/'' value shape computeStreak_/
 *  computeMaxStreak_ (dashboardWebapp.js) already expect from a Tracker dayValues array. */
function paxHistoryDaysToValues_(days) {
  return (days || '').split('').map(paxHistoryDecodeChar_);
}

/** Parses a "YYYY-MM-DD" string as a local-midnight Date — duplicated in miniature from
 *  dashboardWebapp.js's parseIsoDateLocal_ rather than imported, to avoid a circular dependency
 *  between this file and dashboardWebapp.js (same tradeoff as the CacheService key-string
 *  duplication in wipePaxCacheAndRelatedCachesForSheet_ above). */
function paxHistoryParseIsoLocal_(iso) {
  var parts = String(iso).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function paxHistoryFormatIsoLocal_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

/** Whole-day difference (toIso - fromIso), local-midnight to local-midnight. */
function paxHistoryDayDiff_(fromIso, toIso) {
  var a = paxHistoryParseIsoLocal_(fromIso);
  var b = paxHistoryParseIsoLocal_(toIso);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Pure state-transition function: folds one day's write {dateIso, value} into the existing
 * {historyEndDate, days} entry (or null, for a brand-new PAX), returning the next entry. Never
 * mutates its input. Exported separately from advancePaxHistoryDay_ so the shifting/padding rules
 * are unit-testable without a PropertiesService/LockService fixture.
 *   - No existing entry: starts a fresh 1-day window.
 *   - dateIso === entry.historyEndDate: an edit to the most recent day — rewrite in place.
 *   - dateIso after historyEndDate: advances the window, padding any skipped days with '.' (a
 *     missed nightly run, or several days between visits), then trims to the trailing
 *     PAX_HISTORY_WINDOW_DAYS_ characters.
 *   - dateIso before historyEndDate but still within the stored window: an edit to an older day
 *     (e.g. a PAX correcting yesterday after today's cell already advanced the window) — patched
 *     in place without moving historyEndDate.
 *   - dateIso older than the stored window: no representable slot — returned unchanged.
 * @param {?{historyEndDate:string, days:string}} entry
 * @param {string} dateIso "YYYY-MM-DD" day being written.
 * @param {number|null} value 1 | 0 | -1 | null (null clears the day back to unrecorded).
 * @returns {{historyEndDate:string, days:string}}
 */
function advancePaxHistoryEntry_(entry, dateIso, value) {
  var ch = paxHistoryEncodeValue_(value);
  if (!entry || !entry.historyEndDate || typeof entry.days !== 'string') {
    return { historyEndDate: dateIso, days: ch };
  }

  var dayDiff = paxHistoryDayDiff_(entry.historyEndDate, dateIso);
  if (dayDiff === 0) {
    return { historyEndDate: entry.historyEndDate, days: entry.days.slice(0, -1) + ch };
  }
  if (dayDiff > 0) {
    var pad = '';
    for (var i = 1; i < dayDiff; i++) pad += '.';
    var days = (entry.days + pad + ch).slice(-PAX_HISTORY_WINDOW_DAYS_);
    return { historyEndDate: dateIso, days: days };
  }

  var idxFromEnd = -dayDiff;
  if (idxFromEnd >= entry.days.length) return entry; // older than the stored window — not representable
  var idx = entry.days.length - 1 - idxFromEnd;
  return { historyEndDate: entry.historyEndDate, days: entry.days.slice(0, idx) + ch + entry.days.slice(idx + 1) };
}

/**
 * Read-side counterpart to advancePaxHistoryEntry_ (F3Go30-uz9e.2): decodes a stored entry into
 * day values that end EXACTLY at anchorIso, honouring the historyEndDate the write stamped.
 *
 * Without this, a stored window is silently assumed to end "now" — but it actually ends wherever
 * the last write left it, which is a different day whenever the PAX pre-marked a future day
 * (historyEndDate ahead of today), hasn't been written to for a while (behind today), or the
 * caller is asking about an earlier month entirely. The caller then tail-aligns the result
 * against this month's dayValues, so every day is off by that difference.
 *
 * Pure and clock-free, like advancePaxHistoryEntry_ — the anchor is always supplied.
 *   - anchor after historyEndDate: pad the tail with '.' (unknown). Safe specifically at the tail,
 *     because computeStreak_ trims trailing blanks before counting: "not reported yet" reads as
 *     no data, not as a broken streak. A gap in the MIDDLE would break one, which is why the
 *     write path pads gaps rather than dropping them.
 *   - anchor before historyEndDate: drop the trailing characters for days that, as of the anchor,
 *     have not happened yet.
 * @param {?{historyEndDate:string, days:string}} entry
 * @param {string} anchorIso "YYYY-MM-DD" day the returned values must end on.
 * @returns {?Array} Decoded 1/0/-1/'' values ending at anchorIso, or null when this entry cannot
 *   represent that day at all (every stored character would be trimmed or padded away) — the
 *   caller must then rebuild from the Tracker rather than serve a wrongly-aligned window.
 */
function anchorPaxHistoryValues_(entry, anchorIso) {
  if (!entry || !entry.historyEndDate || typeof entry.days !== 'string' || !entry.days.length) return null;
  if (!anchorIso) return paxHistoryDaysToValues_(entry.days);

  var dayDiff = paxHistoryDayDiff_(entry.historyEndDate, anchorIso);
  if (dayDiff === 0) return paxHistoryDaysToValues_(entry.days);

  if (dayDiff < 0) {
    var trimmed = entry.days.slice(0, dayDiff);
    return trimmed.length ? paxHistoryDaysToValues_(trimmed) : null;
  }

  if (dayDiff >= entry.days.length) return null; // padding would consume the whole window
  var pad = '';
  for (var i = 0; i < dayDiff; i++) pad += '.';
  return paxHistoryDaysToValues_((entry.days + pad).slice(-PAX_HISTORY_WINDOW_DAYS_));
}

/** Returns the cached {historyEndDate, days} rolling-window entry for {scopeId, f3Name}, or null
 *  on a miss. @param {string} scopeId See paxHistoryKey_. */
function getPaxHistoryEntry_(scopeId, f3Name) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(paxHistoryKey_(scopeId, f3Name));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Bulk counterpart to getPaxHistoryEntry_ (F3Go30-uz9e.2): one whole-store getProperties() call
 * for a whole roster instead of one getProperty() RPC per name. Same justification as
 * getPaxCacheRowsBulk_ above — the dashboard reads a history entry inside its per-row loop, so the
 * per-key form cost one PropertiesService round trip per PAX on every dashboard load.
 * @param {string} scopeId See paxHistoryKey_.
 * @param {Array<string>} f3Names
 * @returns {Object<string, {historyEndDate:string, days:string}>} Keyed by NORMALIZED name
 *   (paxCacheNormalizeName_); names with no stored entry are simply absent.
 */
function getPaxHistoryEntriesBulk_(scopeId, f3Names) {
  var entries = {};
  var store;
  try {
    store = PropertiesService.getScriptProperties().getProperties() || {};
  } catch (e) {
    return entries;
  }
  (f3Names || []).forEach(function(f3Name) {
    var norm = paxCacheNormalizeName_(f3Name);
    if (!norm || Object.prototype.hasOwnProperty.call(entries, norm)) return;
    var raw = store[PAX_HISTORY_PREFIX_ + scopeId + ':' + norm];
    if (!raw) return;
    try {
      entries[norm] = JSON.parse(raw);
    } catch (e2) { /* unparseable entry reads as a miss, same as getPaxHistoryEntry_ */ }
  });
  return entries;
}

/** @param {string} scopeId See paxHistoryKey_. */
function setPaxHistoryEntry_(scopeId, f3Name, entry) {
  try {
    PropertiesService.getScriptProperties().setProperty(paxHistoryKey_(scopeId, f3Name), JSON.stringify(entry));
  } catch (e) { /* best-effort — payload too large or Properties unavailable */ }
}

/**
 * Bulk counterpart to setPaxHistoryEntry_ (F3Go30-uz9e.3): one setProperties call for a whole
 * roster's rebuilt windows instead of one setProperty RPC per PAX. Same N+1 justification as
 * setPaxCacheRowsBulk_ — the post-wipe reload (reloadPaxCacheForCurrentAndPriorMonth_,
 * dashboardWebapp.js) rebuilds every PAX's window in one pass and already holds them all in
 * memory. setProperties merges, so unrelated properties are untouched.
 * @param {string} scopeId See paxHistoryKey_.
 * @param {Object<string, {historyEndDate:string, days:string}>} entriesByName Raw (non-normalized)
 *   name -> entry; keys are normalized here, same as setPaxHistoryEntry_.
 */
function setPaxHistoryEntriesBulk_(scopeId, entriesByName) {
  try {
    var batch = {};
    Object.keys(entriesByName || {}).forEach(function(name) {
      batch[paxHistoryKey_(scopeId, name)] = JSON.stringify(entriesByName[name]);
    });
    if (!Object.keys(batch).length) return;
    PropertiesService.getScriptProperties().setProperties(batch);
  } catch (e) { /* best-effort — payload too large or Properties unavailable */ }
}

/**
 * Write-through entry point (F3Go30-5uk2): folds one day's just-written Tracker value into
 * f3Name's rolling history window. Call sites: handleCheckinSubmit_ (dashboardWebapp.js, the live
 * checkin write path) and applyMinusOneToTrackerSheet_ (markMinusOne.js, the nightly -1 auto-mark
 * path) — every write that can change a Tracker day cell.
 *
 * Lock-guarded read-modify-write, same LOST UPDATE justification as
 * refreshPaxCacheRowFromSheet_ above: two nearly-simultaneous writes for the same PAX (e.g. a
 * checkin submit racing the nightly job marking a different day) must not silently drop one
 * write's shift by both reading the same pre-write entry.
 * F3Go30-uz9e.2: a write for a FUTURE day is dropped rather than folded in. Advance check-in is
 * an intended feature (handleCheckinSubmit_ accepts 1/0/null for any date with a tracker,
 * including next month), but advancing the window to a future day pads every skipped day with '.'
 * and shifts that many days of REAL history off the front, permanently — and the '.' gap then
 * reads as a broken streak once those days arrive. Nothing is lost by skipping: the value is on
 * the Tracker, and getPaxHistoryWindowValues_ reconciles the window against the Tracker row on
 * read, so the day appears the moment it is actually in range.
 * @param {string} scopeId See paxHistoryKey_.
 * @param {string} f3Name
 * @param {Date} date Calendar date the write applies to.
 * @param {number|null} value 1 | 0 | -1 | null.
 * @param {string=} todayIso "YYYY-MM-DD" context date to judge "future" against; defaults to the
 *   real clock. Callers that already resolved a context date (resolveContextDate_) should pass it.
 */
function advancePaxHistoryDay_(scopeId, f3Name, date, value, todayIso) {
  var dateIsoForClamp = paxHistoryFormatIsoLocal_(date);
  var anchorIso = todayIso || paxHistoryFormatIsoLocal_(new Date());
  if (paxHistoryDayDiff_(anchorIso, dateIsoForClamp) > 0) {
    GasLogger.log('advancePaxHistoryDay_.futureDaySkipped', { f3Name: f3Name, date: dateIsoForClamp, today: anchorIso });
    return;
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    GasLogger.log('advancePaxHistoryDay_.lockFailed', { f3Name: f3Name, error: e.message });
    return;
  }
  try {
    var dateIso = paxHistoryFormatIsoLocal_(date);
    var entry = getPaxHistoryEntry_(scopeId, f3Name);
    setPaxHistoryEntry_(scopeId, f3Name, advancePaxHistoryEntry_(entry, dateIso, value));
  } catch (e2) {
    GasLogger.log('advancePaxHistoryDay_.failed', { f3Name: f3Name, error: e2.message });
  } finally {
    lock.releaseLock();
  }
}

function clearPaxCachePurgeTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'purgeStalePaxCache') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** Installs the nightly PaxCache purge trigger exactly once — mirrors CheckinSessions.js's
 *  setupCheckinSessionCleanupTrigger_ convention (clear-then-recreate, so re-running this is
 *  idempotent). Template-only, same as every other ADR-010 dispatch trigger (see
 *  initializeTemplateDispatchTriggers, onOpen.js) — a monthly Tracker copy has its own
 *  independent PropertiesService store with nothing in it worth purging (see file header). */
function setupPaxCachePurgeTrigger_() {
  clearPaxCachePurgeTrigger_();
  ScriptApp.newTrigger('purgeStalePaxCache')
    .timeBased()
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .atHour(2)
    .nearMinute(0)
    .create();
}

/**
 * One-off diagnostic (F3Go30 script-properties perf question, 2026-07) — not part of any hot
 * read/write path. Compares the per-key getProperty() loop buildTrackerValuesFromPaxCache_
 * (dashboardWebapp.js) actually runs today against a single whole-store getProperties() call, and
 * against writing/reading this sheet's whole roster as one JSON blob — to see whether it's the
 * per-call RPC overhead (favors fewer calls) or the payload size (favors many small values) that
 * dominates. Read-only for the real cache; the blob variant uses its own temporary key and always
 * deletes it, even on error. Only ever invoked via handleAdminPost_'s benchmarkPropertiesService
 * admin action — never called from application code.
 * @returns {Object} timing arrays (ms per iteration) for each strategy, plus store/blob sizing.
 */
function benchmarkPaxCacheReads_(sheetId, iterations) {
  iterations = iterations || 5;
  var props = PropertiesService.getScriptProperties();
  var rosterIndex = getPaxRosterIndex_('tracker', sheetId);
  if (!rosterIndex) return { error: 'no cached roster index for sheetId ' + sheetId };
  var names = Object.keys(rosterIndex);
  if (!names.length) return { error: 'roster index for sheetId ' + sheetId + ' is empty' };
  var keys = names.map(function(n) { return paxCacheRowKey_('tracker', sheetId, n); });

  var perKeyLoopMs = [];
  var bulkGetPropertiesMs = [];
  var lastSnapshot = null;
  for (var i = 0; i < iterations; i++) {
    var t0 = Date.now();
    keys.forEach(function(k) { props.getProperty(k); });
    perKeyLoopMs.push(Date.now() - t0);

    var t1 = Date.now();
    lastSnapshot = props.getProperties();
    bulkGetPropertiesMs.push(Date.now() - t1);
  }

  var storeKeyCount = Object.keys(lastSnapshot).length;
  var storeBytesApprox = 0;
  Object.keys(lastSnapshot).forEach(function(k) { storeBytesApprox += (lastSnapshot[k] || '').length; });

  // Single-blob variant: this sheet's N rows combined into one JSON value under a throwaway key.
  var blobObj = {};
  keys.forEach(function(k) { blobObj[k] = lastSnapshot[k]; });
  var blobStr = JSON.stringify(blobObj);
  var blobBytes = blobStr.length;
  var blobKey = 'go30bench:blob:' + sheetId;
  var blobWriteMs = [];
  var blobReadMs = [];
  try {
    for (var j = 0; j < iterations; j++) {
      var tw = Date.now();
      props.setProperty(blobKey, blobStr);
      blobWriteMs.push(Date.now() - tw);
      var tr = Date.now();
      props.getProperty(blobKey);
      blobReadMs.push(Date.now() - tr);
    }
  } finally {
    props.deleteProperty(blobKey);
  }

  return {
    sheetId: sheetId, keyCount: keys.length, iterations: iterations,
    perKeyLoopMs: perKeyLoopMs, bulkGetPropertiesMs: bulkGetPropertiesMs,
    blobWriteMs: blobWriteMs, blobReadMs: blobReadMs, blobBytes: blobBytes,
    storeKeyCount: storeKeyCount, storeBytesApprox: storeBytesApprox,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    paxCacheNormalizeName_: paxCacheNormalizeName_,
    getPaxCacheRow_: getPaxCacheRow_,
    getPaxCacheRowsBulk_: getPaxCacheRowsBulk_,
    setPaxCacheRow_: setPaxCacheRow_,
    setPaxCacheRowsBulk_: setPaxCacheRowsBulk_,
    deletePaxCacheRow_: deletePaxCacheRow_,
    getPaxRosterIndex_: getPaxRosterIndex_,
    setPaxRosterIndex_: setPaxRosterIndex_,
    buildRosterIndexFromNames_: buildRosterIndexFromNames_,
    deletePaxRosterIndex_: deletePaxRosterIndex_,
    patchPaxRosterIndex_: patchPaxRosterIndex_,
    refreshPaxCacheRowFromSheet_: refreshPaxCacheRowFromSheet_,
    wipePaxCacheForSheet_: wipePaxCacheForSheet_,
    wipePaxCacheAndRelatedCachesForSheet_: wipePaxCacheAndRelatedCachesForSheet_,
    wipeAllPaxCache_: wipeAllPaxCache_,
    resolvePaxRowIndex_: resolvePaxRowIndex_,
    getPaxCacheRequestStats_: getPaxCacheRequestStats_,
    resetPaxCacheRequestStats_: resetPaxCacheRequestStats_,
    purgeStalePaxCache_: purgeStalePaxCache_,
    PAX_CACHE_PURGE_RETENTION_DAYS_: PAX_CACHE_PURGE_RETENTION_DAYS_,
    collectKnownTrackerSheetIds_: collectKnownTrackerSheetIds_,
    extractSheetIdFromPaxCacheKey_: extractSheetIdFromPaxCacheKey_,
    benchmarkPaxCacheReads_: benchmarkPaxCacheReads_,
    PAX_HISTORY_WINDOW_DAYS_: PAX_HISTORY_WINDOW_DAYS_,
    PAX_HISTORY_BACKFILL_DAYS_: PAX_HISTORY_BACKFILL_DAYS_,
    paxHistoryEncodeValue_: paxHistoryEncodeValue_,
    paxHistoryDecodeChar_: paxHistoryDecodeChar_,
    paxHistoryDaysToValues_: paxHistoryDaysToValues_,
    paxHistoryFormatIsoLocal_: paxHistoryFormatIsoLocal_,
    paxHistoryDayDiff_: paxHistoryDayDiff_,
    advancePaxHistoryEntry_: advancePaxHistoryEntry_,
    anchorPaxHistoryValues_: anchorPaxHistoryValues_,
    getPaxHistoryEntry_: getPaxHistoryEntry_,
    getPaxHistoryEntriesBulk_: getPaxHistoryEntriesBulk_,
    setPaxHistoryEntry_: setPaxHistoryEntry_,
    setPaxHistoryEntriesBulk_: setPaxHistoryEntriesBulk_,
    advancePaxHistoryDay_: advancePaxHistoryDay_,
  };
}
