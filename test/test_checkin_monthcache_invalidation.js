const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-0gx6: state.monthCache is populated at identify time by prefetchDashboard_(), BEFORE
// any check-in made this session. If a check-in submit succeeds without invalidating that cache,
// Continue-to-Dashboard's cache-hit fast path (dashboardBtn click handler) renders the stale
// pre-check-in payload. No jsdom harness exists for this GAS-templated <script> file (see
// test_ns_client_roundtrip.js's precedent), so this is a static-shape check: both check-in submit
// success handlers must call the new invalidateMonthCacheFor_ helper.

function readHtml_(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'script', name), 'utf8');
}

(function testInvalidateMonthCacheForDropsTheAffectedMonthKey() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function invalidateMonthCacheFor_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'invalidateMonthCacheFor_ not found in CheckinApp.html');
  assert.match(fnMatch[0], /delete state\.monthCache\[/, 'invalidateMonthCacheFor_ must delete the affected monthCache entry');
})();

(function testSubmitCheckinInvalidatesMonthCacheOnSuccess() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function submitCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitCheckin_ not found in CheckinApp.html');
  assert.match(fnMatch[0], /invalidateMonthCacheFor_\(dateIso\)/,
    'submitCheckin_ success handler must invalidate state.monthCache so Continue-to-Dashboard does not render the pre-check-in prefetch');
})();

(function testSubmitSelectionCheckinInvalidatesMonthCacheOnSuccess() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function submitSelectionCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitSelectionCheckin_ not found in CheckinApp.html');
  assert.match(fnMatch[0], /invalidateMonthCacheFor_\(dateIso\)/,
    'submitSelectionCheckin_ success handler must invalidate state.monthCache so Continue-to-Dashboard does not render the pre-check-in prefetch');
})();

console.log('test_checkin_monthcache_invalidation.js: all assertions passed');
