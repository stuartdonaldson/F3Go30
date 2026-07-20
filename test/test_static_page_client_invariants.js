const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-giqm: static-pages/src/index.html is a "faithful port" of CheckinApp.html +
// IdentityCore.html (per static-checkin.spec.js's header) — same client-side invariants that
// test_context_date_client_roundtrip.js / test_ns_client_roundtrip.js / test_checkin_monthcache_
// invalidation.js / test_checkin_token_inline_identify.js already assert against the GAS HTML
// source, but nothing previously read this file at all, so a regression here only surfaces in
// the live-browser Playwright spec, which doesn't run in npm test. This harness re-asserts the
// same static-shape invariants against the static page's single inlined script, plus the
// documented divergences (no include boundary, no attemptTopRedirect_, per-call `cmd`) so they
// are asserted rather than assumed.

function readStaticPage_() {
  return fs.readFileSync(path.join(__dirname, '..', 'static-pages', 'src', 'index.html'), 'utf8');
}

function readScript_(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'script', name), 'utf8');
}

// ── NS_ / CONTEXT_DATE_ round trip (mirrors test_ns_client_roundtrip.js / ────────────────────
//    test_context_date_client_roundtrip.js, but there is no IdentityCore include boundary on
//    this single-file page — the equivalent ordering constraint is "declared before callApi is
//    defined", since callApi's body closes over them.

(function testStaticPageDeclaresNsBeforeCallApiIsDefined() {
  var src = readStaticPage_();
  var declIndex = src.search(/var NS_\s*=/);
  var callApiIndex = src.indexOf('function callApi(');
  assert.notEqual(declIndex, -1, 'index.html must declare NS_ from the URL query string');
  assert.notEqual(callApiIndex, -1, 'callApi not found in index.html');
  assert.ok(declIndex < callApiIndex, 'NS_ must be declared before callApi is defined');
})();

(function testStaticPageDeclaresContextDateBeforeCallApiIsDefined() {
  var src = readStaticPage_();
  var declIndex = src.search(/var CONTEXT_DATE_\s*=/);
  var callApiIndex = src.indexOf('function callApi(');
  assert.notEqual(declIndex, -1, 'index.html must declare CONTEXT_DATE_ from the URL query string');
  assert.notEqual(callApiIndex, -1, 'callApi not found in index.html');
  assert.ok(declIndex < callApiIndex, 'CONTEXT_DATE_ must be declared before callApi is defined');
})();

(function testStaticPageCallApiEchoesNsAndContextDate() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'callApi function body not found in index.html');
  assert.match(fnMatch[0], /NS_/, 'callApi body must reference NS_ so ns round-trips on every POST');
  assert.match(fnMatch[0], /CONTEXT_DATE_/, 'callApi body must reference CONTEXT_DATE_ so contextDate round-trips on every POST');
})();

// ── Documented divergence: callApi takes a per-call `cmd` override on this page (one page, two ─
//    server dispatchers — handleCheckinPost_ vs handleSignupPost_), where the GAS callApi always
//    posts to the page-level CMD_ constant. Asserted rather than assumed (AC 3).

(function testStaticPageCallApiAcceptsPerCallCmdDivergingFromGasIdentityCore() {
  var staticSrc = readStaticPage_();
  var staticFnMatch = staticSrc.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(staticFnMatch, 'callApi function body not found in index.html');
  assert.match(staticFnMatch[0], /function callApi\(action, payload, cmd\)/, 'index.html callApi must accept a per-call cmd override');
  assert.match(staticFnMatch[0], /\?cmd=' \+ \(cmd \|\| CMD_\)/, 'index.html callApi must fall back to CMD_ when no per-call cmd is given');

  var gasSrc = readScript_('IdentityCore.html');
  var gasFnMatch = gasSrc.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(gasFnMatch, 'callApi function body not found in IdentityCore.html');
  assert.match(gasFnMatch[0], /function callApi\(action, payload\)/, 'IdentityCore.html callApi must NOT take a per-call cmd (only one dispatcher per page)');
})();

// ── Documented divergence: attemptTopRedirect_ exists in the GAS shared include (escapes the ──
//    HtmlService sandbox iframe) but is deliberately omitted from the static page, which is
//    already the top-level document.

(function testStaticPageOmitsAttemptTopRedirectPresentInGasIdentityCore() {
  var gasSrc = readScript_('IdentityCore.html');
  assert.match(gasSrc, /function attemptTopRedirect_\(/, 'IdentityCore.html must still define attemptTopRedirect_ (GAS sandbox-iframe escape)');

  var staticSrc = readStaticPage_();
  assert.doesNotMatch(staticSrc, /function attemptTopRedirect_\(/, 'index.html must not define attemptTopRedirect_ — this document is already top-level');
  // index.html's own comments reference the name while documenting the omission (not a call),
  // so only reject an actual invocation shape: attemptTopRedirect_( preceded by non-comment text.
  var callSites = staticSrc.match(/^(?!\s*\/\/).*attemptTopRedirect_\(/gm) || [];
  assert.equal(callSites.length, 0, 'index.html must never call attemptTopRedirect_');
})();

// ── Month-cache write-through (mirrors test_checkin_monthcache_invalidation.js) ────────────────

(function testStaticPageInvalidateMonthCacheForDropsTheAffectedMonthKey() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function invalidateMonthCacheFor_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'invalidateMonthCacheFor_ not found in index.html');
  assert.match(fnMatch[0], /delete state\.monthCache\[/, 'invalidateMonthCacheFor_ must delete the affected monthCache entry');
})();

(function testStaticPageApplyOwnDayWritePatchesCacheOrQueuesPending() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function applyOwnDayWrite_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'applyOwnDayWrite_ not found in index.html');
  assert.match(fnMatch[0], /patchOwnDayIntoPayload_\(/, 'applyOwnDayWrite_ must patch an already-cached payload');
  assert.match(fnMatch[0], /state\.pendingSelfWrites\[dateIso\] = value/, 'applyOwnDayWrite_ must queue the write when no month is cached yet');
})();

(function testStaticPageSubmitCheckinAppliesWriteThroughBeforeCallApiAndRevertsOnFailure() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function submitCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitCheckin_ not found in index.html');
  var body = fnMatch[0];
  var applyIdx = body.indexOf('applyOwnDayWrite_(dateIso, value)');
  var callApiIdx = body.indexOf('callApi(');
  assert.ok(applyIdx !== -1, 'submitCheckin_ must call applyOwnDayWrite_(dateIso, value)');
  assert.ok(applyIdx < callApiIdx, 'submitCheckin_ must call applyOwnDayWrite_ synchronously before callApi');
  assert.doesNotMatch(body, /\.then\(function\(\) \{[\s\S]*invalidateMonthCacheFor_/,
    'submitCheckin_ success handler must not invalidate the whole cached month (write-through only)');
  assert.match(body, /revertOwnDayWrite_\(dateIso\);/, 'submitCheckin_ failure handler must call revertOwnDayWrite_(dateIso)');
})();

(function testStaticPageSubmitSelectionCheckinAppliesWriteThroughBeforeCallApiAndRevertsOnFailure() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function submitSelectionCheckin_\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'submitSelectionCheckin_ not found in index.html');
  var body = fnMatch[0];
  var applyIdx = body.indexOf('applyOwnDayWrite_(dateIso, value)');
  var callApiIdx = body.indexOf('callApi(');
  assert.ok(applyIdx !== -1, 'submitSelectionCheckin_ must call applyOwnDayWrite_(dateIso, value)');
  assert.ok(applyIdx < callApiIdx, 'submitSelectionCheckin_ must call applyOwnDayWrite_ synchronously before callApi');
  assert.doesNotMatch(body, /\.then\(function\(\) \{[\s\S]*invalidateMonthCacheFor_/,
    'submitSelectionCheckin_ success handler must not invalidate the whole cached month (write-through only)');
  assert.match(body, /revertOwnDayWrite_\(dateIso\);/, 'submitSelectionCheckin_ failure handler must call revertOwnDayWrite_(dateIso)');
})();

console.log('test_static_page_client_invariants.js: all assertions passed');
