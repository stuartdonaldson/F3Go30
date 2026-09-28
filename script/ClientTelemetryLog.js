/*
 * ClientTelemetryLog.js
 *
 * Server-side receiver for the static page's client telemetry pipeline (F3Go30-xyri: captured
 * client errors/crashes; F3Go30-n40u: background reconnect-poll attempts/outcomes feed the same
 * stream — see static-pages/src/index.html's captureClientTelemetry_/flushClientTelemetryQueue_).
 *
 * Dedupes by the client-minted record id so a client that retries an upload before getting an
 * ack doesn't produce duplicate Axiom rows, then logs each not-yet-seen record via GasLogger — same
 * sink as every other server-side event, tagged 'clientTelemetry' so it's queryable/aggregable
 * separately from normal request logs (F3Go30-xyri AC).
 *
 * F3Go30-ga01: records normally ride piggyback on ordinary requests (payload.telemetry.records)
 * and every response carrying them returns telemetryAck: [ids], so the client dequeues on ack.
 * With acks, re-sends are rare and short-lived, so the dedupe store is CacheService per-id keys
 * (TTL 6h, the CacheService cap). The earlier whole-blob Script Property ({id: ts}, 2-day window)
 * was read-modify-written per request, so concurrent requests raced it and duplicates got through.
 * The generic loadDedupeSeenIds_/saveDedupeSeenIds_ store below stays for siteFeedback.js.
 */

var CLIENT_TELEMETRY_DEDUPE_TTL_SECONDS_ = 6 * 60 * 60;
var CLIENT_TELEMETRY_DEDUPE_KEY_PREFIX_ = 'ctlSeen:';
var CLIENT_TELEMETRY_BATCH_MAX_ = 25; // defensive cap independent of the client's own queue cap

var gasRequire_ = (typeof require === 'function') ? require('./GasRequire.js').gasRequire_ : globalThis.gasRequire_;
var clientTelemetryGasLoggerModule_ = gasRequire_('./GasLogger.js', ['maskPiiForLog_']);
var maskPiiForLog_ctl_ = clientTelemetryGasLoggerModule_.maskPiiForLog_;

/**
 * Generic PropertiesService-backed "seen id" dedupe store — {id: isoTimestamp} JSON blob under a
 * caller-chosen property key, pruned to a caller-chosen window on every write so it can't grow
 * without bound. Extracted (F3Go30-5c2a.3) from what was originally this file's private
 * client-telemetry-only helpers, so a second call site (handleSiteFeedback_,
 * dashboardWebapp.js) doesn't hand-roll a second dedupe store — same file header reasoning for
 * PropertiesService over CacheService (6h TTL cap) applies to any caller.
 */
function loadDedupeSeenIds_(propertyKey) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(propertyKey);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// F3Go30-h4xt: script-properties writes go through ScriptProperties.js's invalidating facade, so
// the per-execution whole-store memo (getScriptPropertiesSnapshot_) can never serve a value this
// same execution has already overwritten. Resolved lazily inside the accessor because in GAS
// these are plain globals whose defining file may evaluate after this one.
var scriptPropertiesModule_ctl_ = (typeof require === 'function') ? require('./ScriptProperties.js') : null;
function scriptProps_ctl_() {
  return scriptPropertiesModule_ctl_ ? scriptPropertiesModule_ctl_.scriptPropertiesStore_() : scriptPropertiesStore_();
}

function saveDedupeSeenIds_(propertyKey, map) {
  try {
    scriptProps_ctl_().setProperty(propertyKey, JSON.stringify(map));
  } catch (e) { /* best-effort — a lost write only costs one dedupe window's worth of re-processing */ }
}

/** Drops entries older than windowDays. Pure (no PropertiesService access) so it's unit-testable
 * without a GAS stub. */
function pruneDedupeSeenIds_(map, windowDays, nowMs) {
  var cutoff = (nowMs || Date.now()) - windowDays * 24 * 60 * 60 * 1000;
  var pruned = {};
  Object.keys(map || {}).forEach(function(id) {
    var ts = Date.parse(map[id]);
    if (!isNaN(ts) && ts >= cutoff) pruned[id] = map[id];
  });
  return pruned;
}

function clientTelemetryDedupeKey_(id) {
  return CLIENT_TELEMETRY_DEDUPE_KEY_PREFIX_ + String(id).slice(0, 200); // CacheService keys cap at 250 chars
}

/**
 * Logs each not-yet-seen record via GasLogger, skipping (not erroring on) records already seen
 * within the dedupe TTL or missing an id — a client-supplied batch is untrusted input, not a
 * contract the server can enforce shape on. A CacheService failure degrades to "no dedupe", never
 * to dropping records.
 * @param {Array<Object>} records - Client-captured telemetry records (F3Go30-xyri shape: id, ts,
 *   kind, action, ...).
 * @param {Object=} context - Extra fields stamped on every logged row (e.g. { ns: payload.ns }).
 * @returns {{logged: number, skipped: number, ackIds: Array<string>}} ackIds: every id logged now
 *   or already seen — what the client may dequeue.
 */
function handleClientTelemetryBatch_(records, context) {
  var list = Array.isArray(records) ? records.slice(0, CLIENT_TELEMETRY_BATCH_MAX_) : [];
  var cache = null;
  var seen = {};
  try {
    cache = CacheService.getScriptCache();
    var keys = list.filter(function(rec) { return rec && rec.id; }).map(function(rec) { return clientTelemetryDedupeKey_(rec.id); });
    seen = (keys.length && cache.getAll(keys)) || {};
  } catch (e) { cache = null; seen = {}; }
  var logged = 0, skipped = 0;
  var ackIds = [];
  var toPut = {};
  list.forEach(function(rec) {
    if (!rec || !rec.id) { skipped++; return; }
    var key = clientTelemetryDedupeKey_(rec.id);
    if (seen[key] || toPut[key]) { skipped++; ackIds.push(String(rec.id)); return; }
    var data = Object.assign({}, rec, context || {});
    // PAX identity: mask like every other GasLogger entry (file header PII rule) — f3Name is the
    // one PII-shaped field a captured record can carry (F3Go30-xyri addendum #2).
    if (data.f3Name && maskPiiForLog_ctl_) data.f3Name = maskPiiForLog_ctl_(data.f3Name);
    GasLogger.log('clientTelemetry', data);
    toPut[key] = '1';
    ackIds.push(String(rec.id));
    logged++;
  });
  if (cache && Object.keys(toPut).length) {
    try { cache.putAll(toPut, CLIENT_TELEMETRY_DEDUPE_TTL_SECONDS_); } catch (e) { /* best-effort: costs one re-log at most */ }
  }
  return { logged: logged, skipped: skipped, ackIds: ackIds };
}

/** Handler for the `clientTelemetry` action (handleCheckinPost_'s dispatcher). */
function handleClientTelemetryPost_(payload) {
  var result = handleClientTelemetryBatch_(payload && payload.records, { ns: (payload && payload.ns) || '' });
  return { ok: true, logged: result.logged, skipped: result.skipped, telemetryAck: result.ackIds };
}

/**
 * F3Go30-ga01: logs the telemetry records a normal request carried piggyback
 * (payload.telemetry.records) and returns the ids to ack, or null when the request carried none
 * (and for the clientTelemetry action itself, which carries its records at top level). Never
 * throws: a telemetry failure must not affect the action — it acks nothing ([]) so the records
 * ride the next request.
 */
function logPiggybackedClientTelemetry_(payload) {
  var records = payload && payload.action !== 'clientTelemetry' && payload.telemetry && payload.telemetry.records;
  if (!Array.isArray(records) || !records.length) return null;
  try {
    return handleClientTelemetryBatch_(records, {
      ns: payload.ns || '', carrierAction: payload.action || '', carrierRequestId: payload.clientRequestId || '',
    }).ackIds;
  } catch (e) {
    return [];
  }
}

/** Merges telemetryAck into a JSON response object (ok:true or ok:false alike) when non-null. */
function attachTelemetryAck_(response, ackIds) {
  if (!ackIds || !response || typeof response !== 'object') return response;
  return Object.assign({}, response, { telemetryAck: ackIds });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadDedupeSeenIds_: loadDedupeSeenIds_,
    saveDedupeSeenIds_: saveDedupeSeenIds_,
    pruneDedupeSeenIds_: pruneDedupeSeenIds_,
    handleClientTelemetryBatch_: handleClientTelemetryBatch_,
    handleClientTelemetryPost_: handleClientTelemetryPost_,
    logPiggybackedClientTelemetry_: logPiggybackedClientTelemetry_,
    attachTelemetryAck_: attachTelemetryAck_
  };
}
