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

// Nightly purge threshold (F3Go30-440b.2) — go30pax:/go30idx:/go30asof: entries are keyed per
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

// Per-execution memo of {kind, sheetId} pairs already freshness-checked this request, so a
// request that looks up several PAX on the same sheet pays for one DriveApp call, not one per
// lookup. Apps Script re-evaluates top-level script state on every execution, so this is
// naturally empty at the start of each request — nothing to reset between requests.
var paxCacheFreshnessMemo_ = {};

// Per-execution hit/miss/wipe counters (F3Go30-440b.1) — folded into the caller's own
// per-request GasLogger event (dashboardWebapp.js's checkinWebapp.resolveIdentity.timing /
// checkinWebapp.dashboard) via getPaxCacheRequestStats_ rather than logged here directly, so
// cache effectiveness becomes queryable in Axiom with zero new log volume (see file header).
// Naturally reset every execution the same way paxCacheFreshnessMemo_ is (GAS re-evaluates
// top-level script state fresh each time) — resetPaxCacheRequestStats_ exists for tests only.
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
    if (!raw) { paxCacheRequestStats_.rowMiss++; return null; }
    paxCacheRequestStats_.rowHit++;
    return paxCacheDeserializeRow_(JSON.parse(raw));
  } catch (e) {
    paxCacheRequestStats_.rowMiss++;
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
 * Wipes both PaxCache kinds (tracker + responses) plus the CacheService-backed full-roster/
 * bonus caches for one sheetId — the complete "this sheet's cache is no longer trustworthy"
 * action, shared by ensurePaxCacheFresh_ (Drive-modtime poll) and handleTrackerEdit_
 * (TrackerEditTrigger.js's onEdit-driven invalidation) so the CacheService key list only ever
 * lives in one place.
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
  } catch (e2) { /* best-effort — write-through invalidation at the point of write is the primary path */ }
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
      paxCacheRequestStats_.wiped = true;
      wipePaxCacheAndRelatedCachesForSheet_(sheetId);
    }
    props.setProperty(key, String(liveModTime));
  } catch (e) { /* Drive lookup unavailable — trust existing cache rather than block the request */ }
}

/**
 * Marks {sheetId}'s cache fresh as of NOW without a DriveApp.getLastUpdated() round trip — for a
 * caller that has just performed a full LIVE read of the sheet and is about to write those rows
 * into the cache itself (resolveFullIdentityFromHandle_/resolveCheckinIdentityFull_ in
 * dashboardWebapp.js). A fresh live read is by definition current, so the Drive-modtime probe
 * ensurePaxCacheFresh_ would otherwise do before it is pure latency (~½s on GAS) with nothing to
 * invalidate. Stamping the asOf marker from the read moment keeps any later same-request lean
 * lookup on the same sheet (getPaxCacheRow_ -> ensurePaxCacheFresh_) from treating the rows the
 * caller just wrote as stale, and — by also setting the per-execution memo — suppresses a
 * redundant Drive call for the rest of this execution.
 *
 * Uses Date.now(), which is >= the sheet's real getLastUpdated() at the instant of the read
 * (we read after every edit Drive already knows about). The one tolerated race — an edit landing
 * in the sub-second window between the caller's getValues() and this stamp — is the same
 * self-healing case ensurePaxCacheFresh_ already documents for the just-after-write-through read:
 * the next request's Drive probe (or a write-through) re-invalidates, so no request serves stale
 * data for more than that instant. Fails open (best-effort) exactly like the write helpers above.
 */
function markPaxCacheFreshNow_(sheetId) {
  paxCacheFreshnessMemo_[sheetId] = true;
  try {
    PropertiesService.getScriptProperties().setProperty(paxCacheAsOfKey_(sheetId), String(Date.now()));
  } catch (e) { /* Properties unavailable — next reader just pays for one rebuild, never stale */ }
}

/** Resets the per-execution freshness memo — test-only; production never needs to since Apps
 *  Script re-evaluates top-level script state fresh on every execution. */
function resetPaxCacheFreshnessMemo_() {
  paxCacheFreshnessMemo_ = {};
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

/** Resets the per-execution request-stats counters — test-only, same rationale as
 *  resetPaxCacheFreshnessMemo_. */
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

  ensurePaxCacheFresh_(sheetId);
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

/** Extracts the sheetId embedded in a go30pax:/go30idx:/go30asof: PropertiesService key, or
 *  null for any other key (this store also holds unrelated entries — WEBAPP_URL, etc.). */
function extractSheetIdFromPaxCacheKey_(key) {
  if (key.indexOf(PAX_CACHE_PREFIX_) === 0 || key.indexOf(PAX_CACHE_ROSTER_PREFIX_) === 0) {
    return key.split(':')[2] || null;
  }
  if (key.indexOf(PAX_CACHE_ASOF_PREFIX_) === 0) {
    return key.split(':')[1] || null;
  }
  return null;
}

/**
 * Nightly cleanup (F3Go30-440b.2; see setupPaxCachePurgeTrigger_, onOpen.js's wiring): purges
 * every PaxCache entry (both kind=tracker and kind=responses, plus the go30asof: marker) for any
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
 * pass instead enumerates the PropertiesService store directly and wipes any go30pax:/go30idx:/
 * go30asof: entry whose sheetId isn't in collectKnownTrackerSheetIds_'s cross-namespace "still
 * live somewhere" set. Skipped entirely when that set comes back empty — a TrackerDB read
 * failure/misconfiguration must never be mistaken for "nothing is live" and wipe everything.
 * @param {Date=} now Injectable for tests; defaults to the real current time.
 * @param {Spreadsheet=} spreadsheet Injectable for tests; defaults to the active spreadsheet.
 * @returns {{checked: number, purged: number, kept: number, paxRowsPurged: number, orphanedSheetsPurged: number}}
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
      try { PropertiesService.getScriptProperties().deleteProperty(paxCacheAsOfKey_(sheetId)); } catch (e) { /* best-effort */ }
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
      try { PropertiesService.getScriptProperties().deleteProperty(paxCacheAsOfKey_(sheetId)); } catch (e) { /* best-effort */ }
      orphanedSheetsPurged++;
    });
  }

  var result = { checked: checked, purged: purged, kept: kept, paxRowsPurged: paxRowsPurged, orphanedSheetsPurged: orphanedSheetsPurged };
  GasLogger.log('purgeStalePaxCache_', result);
  return result;
}

/** GasLogger-wrapped entry point for the nightly trigger (see onOpen.js). */
function purgeStalePaxCache() {
  return GasLogger.run('purgeStalePaxCache', function() {
    return purgeStalePaxCache_();
  });
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
    wipePaxCacheAndRelatedCachesForSheet_: wipePaxCacheAndRelatedCachesForSheet_,
    wipeAllPaxCache_: wipeAllPaxCache_,
    resolvePaxRowIndex_: resolvePaxRowIndex_,
    ensurePaxCacheFresh_: ensurePaxCacheFresh_,
    markPaxCacheFreshNow_: markPaxCacheFreshNow_,
    resetPaxCacheFreshnessMemo_: resetPaxCacheFreshnessMemo_,
    getPaxCacheRequestStats_: getPaxCacheRequestStats_,
    resetPaxCacheRequestStats_: resetPaxCacheRequestStats_,
    purgeStalePaxCache_: purgeStalePaxCache_,
    PAX_CACHE_PURGE_RETENTION_DAYS_: PAX_CACHE_PURGE_RETENTION_DAYS_,
    collectKnownTrackerSheetIds_: collectKnownTrackerSheetIds_,
    extractSheetIdFromPaxCacheKey_: extractSheetIdFromPaxCacheKey_,
  };
}
