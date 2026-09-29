/*
 * Shared extraction helpers for tests that run REAL code lifted out of
 * static-pages/src/index.html rather than a test-authored re-implementation — the pattern
 * established by test_client_transport_resilience.js (transport block + showApiError_),
 * test_session_resume_refresh.js (silentResumeRefresh_) and
 * test_dashboard_stale_while_revalidate.js (revalidateDashboard_).
 *
 * Extracted here (F3Go30-xyri/n40u) so a new consumer doesn't hand-copy readStaticPage_ /
 * extractTransportBlock_ / extractShowApiError_ a fifth time. The four pre-existing test files
 * above were folded onto this shared helper in F3Go30-lem7 (PLAN-08-20 Stage 2) — none of them
 * carry their own copy of these functions any more.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readStaticPage_() {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'static-pages', 'src', 'index.html'), 'utf8');
}

/** The transport block: the retry/timeout constants through the end of callApi, the F3Go30-xyri
 * telemetry queue, and the F3Go30-n40u reconnect poll (which sit immediately above
 * hideApiError_, the end marker). */
function extractTransportBlock_(src) {
  var startIdx = src.indexOf('var REQUEST_TIMEOUT_MS_');
  var endIdx = src.indexOf('function hideApiError_');
  assert.notEqual(startIdx, -1, 'transport block start marker (var REQUEST_TIMEOUT_MS_) not found in index.html');
  assert.notEqual(endIdx, -1, 'hideApiError_ (transport block end marker) not found in index.html');
  assert.ok(startIdx < endIdx, 'the transport block must be declared above hideApiError_');
  return src.slice(startIdx, endIdx);
}

function extractShowApiError_(src) {
  var m = src.match(/function showApiError_\([\s\S]*?\n  \}/);
  assert.ok(m, 'showApiError_ function body not found in index.html');
  return m[0];
}

/** Generic single-function extractor by name, for functions with the standard 2-space-indented
 * body / closing-brace convention this file uses throughout. */
function extractFunction_(src, name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}');
  var m = src.match(re);
  assert.ok(m, 'function ' + name + ' not found in index.html');
  return m[0];
}

/** loadDashboard_/prefetchDashboard_/revalidateDashboard_ — the dashboard fetch block, shared by
 * test_dashboard_stale_while_revalidate.js (F3Go30-833s.13/e4r0) and test_dashboard_render_
 * telemetry.js (F3Go30-5p3z), so the two don't each carry their own copy of these markers. */
function extractLoadDashboardBlock_(src) {
  var startIdx = src.indexOf('function loadDashboard_(dateISO, opts) {');
  var endIdx = src.indexOf('function navigateDashboard_(deltaDays) {');
  assert.ok(startIdx !== -1 && endIdx !== -1, 'loadDashboard_/revalidateDashboard_ block markers not found in index.html');
  return src.slice(startIdx, endIdx);
}

/** In-memory localStorage stand-in for the extracted-page harnesses — values coerced to strings
 * as the real Storage does, `initial` seeds the store, `opts.throwOnSet` simulates a quota-exceeded
 * write. Shared (F3Go30-5c2a.9) so the harnesses stop hand-rolling their own copy. */
function makeFakeLocalStorage_(opts) {
  opts = opts || {};
  var store = Object.assign({}, opts.initial || {});
  return {
    getItem: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function(key, value) {
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      store[key] = String(value);
    },
    removeItem: function(key) { delete store[key]; },
    _store: store,
  };
}

/** Manual clock + timers for the extracted-page harnesses (F3Go30-5c2a.7). `setTimeout`/
 * `clearTimeout`/`Date` are injected into the extracted code; nothing fires until the test says
 * so, and firing a timer advances the clock to its due time — so a bounded poll's deadline can be
 * exercised deterministically instead of by waiting real seconds. `advance(ms)` moves the clock
 * with no timer (a slow in-flight request). `drain(promise)` fires due timers, earliest first,
 * until `promise` settles, then returns its value (or rethrows). */
function makeFakeClock_(startMs) {
  var now = startMs || 1700000000000;
  var timers = [];
  var seq = 0;
  class FakeDate extends Date { static now() { return now; } }
  function flush() { return new Promise(function(r) { setImmediate(r); }); }
  var clock = {
    Date: FakeDate,
    setTimeout: function(fn, ms) { var id = ++seq; timers.push({ id: id, fn: fn, ms: ms, due: now + ms }); return id; },
    clearTimeout: function(id) { timers = timers.filter(function(t) { return t.id !== id; }); },
    advance: function(ms) { now += ms; },
    nowMs: function() { return now; },
    pending: function() { return timers.slice(); },
    drain: function(promise) {
      var settled = false, value, error;
      promise.then(function(v) { settled = true; value = v; }, function(e) { settled = true; error = e; });
      function step(n) {
        return flush().then(function() {
          if (settled) { if (error) throw error; return value; }
          if (n > 200) throw new Error('makeFakeClock_.drain: promise never settled');
          timers.sort(function(a, b) { return a.due - b.due; });
          var t = timers.shift();
          if (t) { now = Math.max(now, t.due); t.fn(); }
          return step(n + 1);
        });
      }
      return step(0);
    },
  };
  return clock;
}

module.exports = {
  readStaticPage_, extractTransportBlock_, extractShowApiError_, extractFunction_, extractLoadDashboardBlock_,
  makeFakeLocalStorage_, makeFakeClock_,
};
