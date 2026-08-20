/*
 * Shared extraction helpers for tests that run REAL code lifted out of
 * static-pages/src/index.html rather than a test-authored re-implementation — the pattern
 * established by test_client_transport_resilience.js (transport block + showApiError_),
 * test_session_resume_refresh.js (silentResumeRefresh_) and
 * test_dashboard_stale_while_revalidate.js (revalidateDashboard_).
 *
 * Extracted here (F3Go30-xyri/n40u) so a new consumer doesn't hand-copy readStaticPage_ /
 * extractTransportBlock_ / extractShowApiError_ a fifth time. The four pre-existing test files
 * above each still carry their own copy — flagged as pre-existing duplication worth folding onto
 * this helper in a later pass, not retrofitted here to avoid touching passing, unrelated tests.
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

module.exports = { readStaticPage_, extractTransportBlock_, extractShowApiError_, extractFunction_ };
