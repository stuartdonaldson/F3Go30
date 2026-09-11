/*
 * ScriptProperties.js
 *
 * One per-execution memo of the whole PropertiesService script-properties store, plus the write
 * facade that keeps it honest (F3Go30-h4xt, REVIEW-260910 finding on repeated whole-store reads).
 *
 * WHY A MEMO IS SAFE HERE — Apps Script's one-execution-one-request guarantee:
 * every web-app request, trigger firing and menu invocation runs as its own script execution with
 * a freshly-evaluated global scope. Top-level `var` state (like the memo below) is created when
 * that execution starts and discarded when it ends; it is never shared with, and never visible
 * to, a concurrent or later request. So the only staleness window a memo can have is *within one
 * execution*, between a write and a subsequent read — and that window is closed structurally by
 * scriptPropertiesStore_() below, whose write methods invalidate the memo before delegating to
 * the real service. Nothing in this project is allowed to write script properties through the raw
 * PropertiesService handle for exactly that reason (see the callers in PaxCache.js, WebApp.js,
 * CheckinSessions.js, ClientTelemetryLog.js, GasLogger.js, IdentityToken.js, NotificationSBCode.js
 * and Utilities.js — all of them route their writes through this facade).
 *
 * The problem it solves: getProperties() is one RPC for the whole store, and the dashboard request
 * path made several of them — getPaxCacheRowsBulk_ and getPaxHistoryEntriesBulk_ each fetched the
 * entire store independently on the same request, for the same bytes. One fetch per execution,
 * shared, is strictly the same data (see the guarantee above) for a fraction of the round trips.
 */

/** The memoized whole-store snapshot for THIS execution, or null when unfetched/invalidated. */
var scriptPropertiesSnapshot_ = null;

/**
 * Per-execution counters + the memoized store size, shaped to drop straight into a caller's
 * GasLogger event (see dashboardWebapp.js's checkinWebapp.dashboard). bytes/keys are measured
 * once per fetch, not per read.
 */
var scriptPropertiesSnapshotStats_ = { fetches: 0, memoHits: 0, invalidations: 0, bytes: 0, keys: 0 };

/**
 * Approximate stored size of a whole-store snapshot: key + value characters summed. Apps Script
 * bills the 500KB total-store quota against the stored strings themselves, so this is the number
 * that matters operationally (an ASCII JSON blob is 1 byte/char; multi-byte content would read
 * low, which is acceptable for a telemetry gauge whose job is trend + headroom).
 * @param {Object<string,string>} store
 * @returns {{bytes:number, keys:number}}
 */
function measureScriptPropertiesSize_(store) {
  var bytes = 0;
  var keys = Object.keys(store || {});
  keys.forEach(function(key) {
    bytes += key.length + String(store[key] == null ? '' : store[key]).length;
  });
  return { bytes: bytes, keys: keys.length };
}

/**
 * The whole script-properties store for this execution — fetched at most once (see the
 * one-execution-one-request guarantee in this file's header), then served from the memo.
 * Never throws: a PropertiesService failure reads as an empty store, exactly as the per-call
 * getProperties() sites it replaced already degraded, and is NOT memoized so a transient failure
 * can't blank the store for the rest of the execution.
 * @returns {Object<string,string>} Read-only by convention — callers must not mutate it.
 */
function getScriptPropertiesSnapshot_() {
  if (scriptPropertiesSnapshot_) {
    scriptPropertiesSnapshotStats_.memoHits++;
    return scriptPropertiesSnapshot_;
  }
  var store;
  try {
    store = PropertiesService.getScriptProperties().getProperties() || {};
  } catch (e) {
    return {};
  }
  scriptPropertiesSnapshot_ = store;
  scriptPropertiesSnapshotStats_.fetches++;
  var size = measureScriptPropertiesSize_(store);
  scriptPropertiesSnapshotStats_.bytes = size.bytes;
  scriptPropertiesSnapshotStats_.keys = size.keys;
  return store;
}

/**
 * Drops the memo so the next read re-fetches. Called by every write method of
 * scriptPropertiesStore_() below — that is the ONLY invalidation contract this module has, and
 * it is why writes must not bypass the facade.
 */
function invalidateScriptPropertiesSnapshot_() {
  if (scriptPropertiesSnapshot_) scriptPropertiesSnapshotStats_.invalidations++;
  scriptPropertiesSnapshot_ = null;
}

/**
 * Facade over PropertiesService.getScriptProperties() with the same method contract, except that
 * every mutating method invalidates the memo first. Use this everywhere instead of the raw
 * handle: invalidation then cannot be forgotten at a call site, because there is no call site
 * that writes without going through here.
 */
function scriptPropertiesStore_() {
  var store = PropertiesService.getScriptProperties();
  return {
    getProperty: function(key) { return store.getProperty(key); },
    getProperties: function() { return store.getProperties(); },
    getKeys: function() { return store.getKeys(); },
    setProperty: function(key, value) {
      invalidateScriptPropertiesSnapshot_();
      return store.setProperty(key, value);
    },
    setProperties: function(properties, deleteAllOthers) {
      invalidateScriptPropertiesSnapshot_();
      return store.setProperties(properties, deleteAllOthers);
    },
    deleteProperty: function(key) {
      invalidateScriptPropertiesSnapshot_();
      return store.deleteProperty(key);
    },
    deleteAllProperties: function() {
      invalidateScriptPropertiesSnapshot_();
      return store.deleteAllProperties();
    },
  };
}

/**
 * Snapshot of this execution's memo counters + store size, field-named to drop straight into a
 * caller's GasLogger event via Object.assign — same idiom as PaxCache.js's
 * getPaxCacheRequestStats_. propsStoreBytes is the operational gauge: PropertiesService caps the
 * whole store at 500KB, and this project's caches are the only thing that grows in it.
 */
function getScriptPropertiesSnapshotStats_() {
  return {
    propsStoreBytes: scriptPropertiesSnapshotStats_.bytes,
    propsStoreKeys: scriptPropertiesSnapshotStats_.keys,
    propsFetches: scriptPropertiesSnapshotStats_.fetches,
    propsMemoHits: scriptPropertiesSnapshotStats_.memoHits,
    propsInvalidations: scriptPropertiesSnapshotStats_.invalidations,
  };
}

/** Clears the memo AND the counters — test-only; production never needs it, since Apps Script
 *  re-evaluates this file's top-level state fresh on every execution. */
function resetScriptPropertiesSnapshot_() {
  scriptPropertiesSnapshot_ = null;
  scriptPropertiesSnapshotStats_ = { fetches: 0, memoHits: 0, invalidations: 0, bytes: 0, keys: 0 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getScriptPropertiesSnapshot_: getScriptPropertiesSnapshot_,
    invalidateScriptPropertiesSnapshot_: invalidateScriptPropertiesSnapshot_,
    scriptPropertiesStore_: scriptPropertiesStore_,
    getScriptPropertiesSnapshotStats_: getScriptPropertiesSnapshotStats_,
    resetScriptPropertiesSnapshot_: resetScriptPropertiesSnapshot_,
    measureScriptPropertiesSize_: measureScriptPropertiesSize_,
  };
}
