const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-0gx6: state.monthCache is populated at identify time by prefetchDashboard_(), BEFORE
// any check-in made this session. F3Go30-5nfj.5 replaced the original invalidate-and-hope fix
// (delete the cached month, hope the in-flight prefetch resolves before it's read again) with a
// write-through patch: the checkin submit functions now call applyOwnDayWrite_(dateIso, value)
// synchronously, BEFORE the callApi round trip, so the value lands either straight in the
// already-cached payload or in state.pendingSelfWrites for loadDashboard_ to apply the moment its
// own in-flight fetch resolves — closing the race regardless of arrival order. A failed write
// reverts via revertOwnDayWrite_, which still uses invalidateMonthCacheFor_ (a real fetch is
// safest after an unknown-state failure). No jsdom harness exists for this GAS-templated
// <script> file (see test_ns_client_roundtrip.js's precedent), so this is a static-shape check.

function readHtml_(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'script', name), 'utf8');
}

(function testInvalidateMonthCacheForDropsTheAffectedMonthKey() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function invalidateMonthCacheFor_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'invalidateMonthCacheFor_ not found in CheckinApp.html');
  assert.match(fnMatch[0], /delete state\.monthCache\[/, 'invalidateMonthCacheFor_ must delete the affected monthCache entry');
})();

(function testApplyOwnDayWritePatchesCacheOrQueuesPending() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function applyOwnDayWrite_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'applyOwnDayWrite_ not found in CheckinApp.html');
  assert.match(fnMatch[0], /patchOwnDayIntoPayload_\(/, 'applyOwnDayWrite_ must patch an already-cached payload');
  assert.match(fnMatch[0], /state\.pendingSelfWrites\[dateIso\] = value/, 'applyOwnDayWrite_ must queue the write when no month is cached yet');
})();

(function testSubmitCheckinAppliesWriteThroughBeforeCallApiAndRevertsOnFailure() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function submitCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitCheckin_ not found in CheckinApp.html');
  var body = fnMatch[0];
  var applyIdx = body.indexOf('applyOwnDayWrite_(dateIso, value)');
  var callApiIdx = body.indexOf('callApi(');
  assert.ok(applyIdx !== -1, 'submitCheckin_ must call applyOwnDayWrite_(dateIso, value)');
  assert.ok(applyIdx < callApiIdx, 'submitCheckin_ must call applyOwnDayWrite_ synchronously before callApi');
  assert.doesNotMatch(body, /\.then\(function\(\) \{[\s\S]*invalidateMonthCacheFor_/,
    'submitCheckin_ success handler must no longer invalidate the whole cached month (replaced by write-through)');
  assert.match(body, /\.catch\(function\(err\) \{\s*revertOwnDayWrite_\(dateIso\);/,
    'submitCheckin_ failure handler must call revertOwnDayWrite_(dateIso) before reporting the error');
})();

(function testSubmitSelectionCheckinAppliesWriteThroughBeforeCallApiAndRevertsOnFailure() {
  var src = readHtml_('CheckinApp.html');
  var fnMatch = src.match(/function submitSelectionCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitSelectionCheckin_ not found in CheckinApp.html');
  var body = fnMatch[0];
  var applyIdx = body.indexOf('applyOwnDayWrite_(dateIso, value)');
  var callApiIdx = body.indexOf('callApi(');
  assert.ok(applyIdx !== -1, 'submitSelectionCheckin_ must call applyOwnDayWrite_(dateIso, value)');
  assert.ok(applyIdx < callApiIdx, 'submitSelectionCheckin_ must call applyOwnDayWrite_ synchronously before callApi');
  assert.doesNotMatch(body, /\.then\(function\(\) \{[\s\S]*invalidateMonthCacheFor_/,
    'submitSelectionCheckin_ success handler must no longer invalidate the whole cached month (replaced by write-through)');
  assert.match(body, /\.catch\(function\(err\) \{ revertOwnDayWrite_\(dateIso\);/,
    'submitSelectionCheckin_ failure handler must call revertOwnDayWrite_(dateIso) before reporting the error');
})();

console.log('test_checkin_monthcache_invalidation.js: all assertions passed');
