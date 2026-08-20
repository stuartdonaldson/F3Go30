/*
 * ClientTelemetryLog.js
 *
 * Server-side receiver for the static page's client telemetry pipeline (F3Go30-xyri: captured
 * client errors/crashes; F3Go30-n40u: background reconnect-poll attempts/outcomes feed the same
 * stream — see static-pages/src/index.html's captureClientTelemetry_/flushClientTelemetryQueue_).
 *
 * Dedupes by the client-minted record id so a client that retries an upload before getting an
 * ack doesn't produce duplicate Axiom rows (each record is only logged once, ever, within the
 * dedupe window below), then logs each not-yet-seen record via GasLogger — same sink as every
 * other server-side event, tagged 'clientTelemetry' so it's queryable/aggregable separately from
 * normal request logs (F3Go30-xyri AC).
 *
 * Dedup store: PropertiesService, not CacheService — CacheService's TTL caps at 6 hours, shorter
 * than the ~2-day dedupe window this needs (same reasoning as PaxCache.js's header comment). One
 * JSON blob of {id: isoTimestamp}, pruned to CLIENT_TELEMETRY_DEDUPE_WINDOW_DAYS_ on every write
 * so it can't grow without bound the way an un-pruned id list would.
 */

var CLIENT_TELEMETRY_DEDUPE_PROPERTY_ = 'CLIENT_TELEMETRY_DEDUPE_SEEN_IDS';
var CLIENT_TELEMETRY_DEDUPE_WINDOW_DAYS_ = 2;
var CLIENT_TELEMETRY_BATCH_MAX_ = 25; // defensive cap independent of the client's own queue cap

var clientTelemetryGasLoggerModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./GasLogger.js')
  : null;
var maskPiiForLog_ctl_ = (clientTelemetryGasLoggerModule_ && clientTelemetryGasLoggerModule_.maskPiiForLog_)
  || (typeof globalThis !== 'undefined' && globalThis.maskPiiForLog_);

function _loadClientTelemetrySeenIds_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(CLIENT_TELEMETRY_DEDUPE_PROPERTY_);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function _saveClientTelemetrySeenIds_(map) {
  try {
    PropertiesService.getScriptProperties().setProperty(CLIENT_TELEMETRY_DEDUPE_PROPERTY_, JSON.stringify(map));
  } catch (e) { /* best-effort — a lost write only costs one dedupe window's worth of re-logging */ }
}

/** Drops entries older than the dedupe window. Pure (no PropertiesService access) so it's
 * unit-testable without a GAS stub. */
function pruneClientTelemetrySeenIds_(map, nowMs) {
  var cutoff = (nowMs || Date.now()) - CLIENT_TELEMETRY_DEDUPE_WINDOW_DAYS_ * 24 * 60 * 60 * 1000;
  var pruned = {};
  Object.keys(map || {}).forEach(function(id) {
    var ts = Date.parse(map[id]);
    if (!isNaN(ts) && ts >= cutoff) pruned[id] = map[id];
  });
  return pruned;
}

/**
 * Logs each not-yet-seen record via GasLogger, skipping (not erroring on) records already seen
 * within the dedupe window or missing an id — a client-supplied batch is untrusted input, not a
 * contract the server can enforce shape on. Never throws.
 * @param {Array<Object>} records - Client-captured telemetry records (F3Go30-xyri shape: id, ts,
 *   kind, action, ...).
 * @param {Object=} context - Extra fields stamped on every logged row (e.g. { ns: payload.ns }).
 * @returns {{logged: number, skipped: number}}
 */
function handleClientTelemetryBatch_(records, context) {
  var list = Array.isArray(records) ? records.slice(0, CLIENT_TELEMETRY_BATCH_MAX_) : [];
  var seen = pruneClientTelemetrySeenIds_(_loadClientTelemetrySeenIds_());
  var logged = 0, skipped = 0;
  list.forEach(function(rec) {
    if (!rec || !rec.id) { skipped++; return; }
    if (seen[rec.id]) { skipped++; return; }
    var data = Object.assign({}, rec, context || {});
    // PAX identity: mask like every other GasLogger entry (file header PII rule) — f3Name is the
    // one PII-shaped field a captured record can carry (F3Go30-xyri addendum #2).
    if (data.f3Name && maskPiiForLog_ctl_) data.f3Name = maskPiiForLog_ctl_(data.f3Name);
    GasLogger.log('clientTelemetry', data);
    seen[rec.id] = new Date().toISOString();
    logged++;
  });
  _saveClientTelemetrySeenIds_(seen);
  return { logged: logged, skipped: skipped };
}

/** Handler for the `clientTelemetry` action (handleCheckinPost_'s dispatcher). */
function handleClientTelemetryPost_(payload) {
  var result = handleClientTelemetryBatch_(payload && payload.records, { ns: (payload && payload.ns) || '' });
  return { ok: true, logged: result.logged, skipped: result.skipped };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pruneClientTelemetrySeenIds_: pruneClientTelemetrySeenIds_,
    handleClientTelemetryBatch_: handleClientTelemetryBatch_,
    handleClientTelemetryPost_: handleClientTelemetryPost_
  };
}
