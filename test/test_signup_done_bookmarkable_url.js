const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-1f75. Two defects on the static page's signup completion path:
//
// 1. applyIdentifySuccess_ installs ?id=<token> on the CURRENT url via history.replaceState but
//    leaves the signup routing params alone. A PAX who arrived on a ?cmd=signup link and tapped
//    "Continue to check in" ends up holding
//    ?cmd=signup&targetMonth=…&autoStart=1&id=<token>. Bookmarking that — which the done card is
//    now about to tell them to do — reopens the SIGNUP step on every future launch, because
//    runIdentityBootstrap_ branches on PAGE_CMD_ === 'signup' before the check-in bootstrap runs.
//    The token is right; the route is wrong.
//
// 2. The su-step-choose screen preselects 'current'. A PAX who reaches that screen is usually
//    signing up for the upcoming month rather than editing the one already underway.
//
// Extracts the REAL functions from index.html (not re-implementations) and runs them, the same
// pattern as test_client_transport_resilience.js / test_session_resume_refresh.js. Both are
// deliberately pure string/object -> value functions so they are testable without a DOM: the
// alternative, driving the whole of applyIdentifySuccess_, needs the entire check-in view stood
// up and would assert the rewrite only incidentally.

function readStaticPage_() {
  return fs.readFileSync(path.join(__dirname, '..', 'static-pages', 'src', 'index.html'), 'utf8');
}

function extractFn_(src, name) {
  var m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  assert.ok(m, name + ' function body not found in index.html');
  return m[0];
}

/** Both functions plus the route-param list they close over, evaluated in one scope. */
function loadSubject_() {
  var src = readStaticPage_();
  var listMatch = src.match(/var SIGNUP_ROUTE_PARAMS_\s*=\s*\[[^\]]*\];/);
  assert.ok(listMatch, 'SIGNUP_ROUTE_PARAMS_ declaration not found in index.html');
  var body = [
    listMatch[0],
    extractFn_(src, 'buildBookmarkableUrl_'),
    extractFn_(src, 'defaultTargetMonth_'),
    'return { buildBookmarkableUrl_: buildBookmarkableUrl_, defaultTargetMonth_: defaultTargetMonth_,',
    '         SIGNUP_ROUTE_PARAMS_: SIGNUP_ROUTE_PARAMS_ };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('URL', body)(URL);
}

const BASE = 'https://f3go30.github.io/static-pages/dist/sit/index.html';
const TOKEN = '11111111-2222-3333-4444-555555555555';

// ── AC1: the signup routing params are stripped when ?id= is installed ───────────────────────

(function testStripsCmdSignupFromTheBookmarkableUrl() {
  var subject = loadSubject_();
  var out = new URL(subject.buildBookmarkableUrl_(
    BASE + '?webapp=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FABC%2Fexec&cmd=signup&targetMonth=next&autoStart=1',
    TOKEN
  ));
  assert.equal(out.searchParams.get('id'), TOKEN, 'the token must be installed on the URL');
  assert.equal(out.searchParams.get('cmd'), null, 'cmd=signup must not survive into a bookmarkable check-in URL');
  assert.equal(out.searchParams.get('targetMonth'), null, 'targetMonth is signup routing and must be stripped');
  assert.equal(out.searchParams.get('autoStart'), null, 'autoStart is signup routing and must be stripped');
})();

(function testRouteParamListNamesAllThreeSignupRoutingParams() {
  var subject = loadSubject_();
  ['cmd', 'targetMonth', 'autoStart'].forEach(function(p) {
    assert.ok(subject.SIGNUP_ROUTE_PARAMS_.indexOf(p) !== -1,
      'SIGNUP_ROUTE_PARAMS_ must name ' + p + ' — runIdentityBootstrap_ reads all three off the URL');
  });
})();

// ── AC2: every non-routing param survives ───────────────────────────────────────────────────

(function testPreservesWebappNsAndContextDate() {
  var subject = loadSubject_();
  var webapp = 'https://script.google.com/macros/s/ABC/exec';
  var out = new URL(subject.buildBookmarkableUrl_(
    BASE + '?webapp=' + encodeURIComponent(webapp) + '&ns=smoke-abc&contextDate=2026-08-01&cmd=signup',
    TOKEN
  ));
  assert.equal(out.searchParams.get('webapp'), webapp, 'webapp must survive — it is the API backend for every later call');
  assert.equal(out.searchParams.get('ns'), 'smoke-abc', 'ns must survive or the bookmark silently leaves its namespace');
  assert.equal(out.searchParams.get('contextDate'), '2026-08-01', 'contextDate must survive for month-boundary testing');
})();

(function testPreservesTheOriginAndPathUnchanged() {
  var subject = loadSubject_();
  var out = new URL(subject.buildBookmarkableUrl_(BASE + '?cmd=signup', TOKEN));
  assert.equal(out.origin + out.pathname, BASE, 'only the query is rewritten — never the host or path');
})();

(function testReplacesAnAlreadyPresentIdRatherThanAppendingASecond() {
  var subject = loadSubject_();
  var out = new URL(subject.buildBookmarkableUrl_(BASE + '?id=stale-token', TOKEN));
  assert.deepEqual(out.searchParams.getAll('id'), [TOKEN], 'a re-identify must replace the token, not accumulate ?id= twice');
})();

(function testIsANoOpOnAUrlThatCarriesNoSignupRouting() {
  var subject = loadSubject_();
  var out = new URL(subject.buildBookmarkableUrl_(BASE + '?webapp=x', TOKEN));
  assert.equal(out.searchParams.get('webapp'), 'x');
  assert.equal(out.searchParams.get('id'), TOKEN);
})();

// ── AC3: the rewritten URL routes to check-in, not signup, on the next load ──────────────────

(function testRewrittenUrlDoesNotTripTheSignupBootstrapBranch() {
  var subject = loadSubject_();
  var out = new URL(subject.buildBookmarkableUrl_(BASE + '?cmd=signup&autoStart=1', TOKEN));
  // Mirrors runIdentityBootstrap_'s own branch: `if (PAGE_CMD_ === 'signup') { openSignup_(…) }`
  var pageCmd = out.searchParams.get('cmd') || '';
  assert.notEqual(pageCmd, 'signup', 'reloading the bookmarked URL must reach the check-in bootstrap, not openSignup_');
})();

(function testApplyIdentifySuccessRoutesItsUrlRewriteThroughTheHelper() {
  // The helper is only worth anything if the one place that rewrites the URL actually calls it.
  var src = readStaticPage_();
  var fn = extractFn_(src, 'applyIdentifySuccess_');
  assert.match(fn, /buildBookmarkableUrl_\(/,
    'applyIdentifySuccess_ must build its replaceState URL via buildBookmarkableUrl_, not inline');
})();

// ── AC8: the month choice defaults to next when both are offered ─────────────────────────────

const BOTH_MONTHS = { current: { label: 'July 2026' }, next: { label: 'August 2026' } };

(function testDefaultsToNextWhenBothMonthsAreOffered() {
  var subject = loadSubject_();
  assert.equal(subject.defaultTargetMonth_(BOTH_MONTHS, ''), 'next',
    'a PAX reaching the choose screen is usually signing up for the upcoming month');
})();

(function testAnExplicitUrlTargetMonthCurrentStillWins() {
  var subject = loadSubject_();
  assert.equal(subject.defaultTargetMonth_(BOTH_MONTHS, 'current'), 'current',
    'an emailed "edit your current-month goals" link must land on current');
})();

(function testAnExplicitUrlTargetMonthNextIsHonouredToo() {
  var subject = loadSubject_();
  assert.equal(subject.defaultTargetMonth_(BOTH_MONTHS, 'next'), 'next');
})();

(function testFallsBackToCurrentWhenThereIsNoNextMonthToOffer() {
  var subject = loadSubject_();
  assert.equal(subject.defaultTargetMonth_({ current: { label: 'July 2026' } }, ''), 'current',
    'with no next-month tracker there is nothing to default to');
  assert.equal(subject.defaultTargetMonth_(null, ''), 'current', 'a missing months object must not throw');
})();

(function testTheChooseStepAppliesTheDefaultBeforeItIsShown() {
  // Applying it inside renderSignupMonthChoices_ would be wrong — that function re-runs on every
  // option click, so the default has to be set once, on entry to the step.
  var src = readStaticPage_();
  var handler = src.match(/\$\('suInfoNextBtn'\)\.addEventListener\([\s\S]*?\n  \}\);/);
  assert.ok(handler, "suInfoNextBtn's click handler not found in index.html");
  assert.match(handler[0], /defaultTargetMonth_\(/,
    'the choose step must set its default via defaultTargetMonth_ before rendering the choices');
})();

// ── Done-card structure (AC4-AC7) ───────────────────────────────────────────────────────────

(function testDoneCardLeadsWithCheckinAndDemotesTheTrackerLink() {
  var src = readStaticPage_();
  var card = src.match(/<div id="su-step-done"[\s\S]*?\n      <\/div>/);
  assert.ok(card, 'su-step-done card not found in index.html');
  var checkinIdx = card[0].indexOf('suDoneCheckinLink');
  var trackerIdx = card[0].indexOf('suSavedTrackerLink');
  assert.notEqual(checkinIdx, -1, 'the done card must offer the personal check-in link');
  assert.notEqual(trackerIdx, -1, 'the tracker link must remain available as a fallback');
  assert.ok(checkinIdx < trackerIdx, 'the check-in link must come before the tracker link on the done card');
})();

// ── AC12: the check-in link is a NAVIGATION anchor, offered whatever month they signed up for ─

(function testTheCheckinLinkIsAnAnchorNotAnInPageButton() {
  var src = readStaticPage_();
  var card = src.match(/<div id="su-step-done"[\s\S]*?\n      <\/div>/);
  assert.match(card[0], /<a [^>]*id="suDoneCheckinLink"[^>]*href=/,
    'bookmarking requires a real <a href> to the check-in page, not an in-page button');
})();

(function testTheLinkHrefIsTakenFromTheServersCheckinUrl() {
  var src = readStaticPage_();
  var fn = src.match(/function performSignupSave_\([\s\S]*?\n  \}/);
  assert.ok(fn, 'performSignupSave_ not found in index.html');
  assert.match(fn[0], /suDoneCheckinLink'\)\.href\s*=\s*[\s\S]{0,80}checkinUrl/,
    "the link must point at the server's checkinUrl — the same URL the confirmation email sends");
})();

(function testTheBlockIsShownWheneverThereIsACheckinUrlRegardlessOfMonth() {
  // The bug: the block keyed off identityToken, which the server withholds for a next-month
  // save, so a next-month signup saw no link at all.
  var src = readStaticPage_();
  var fn = src.match(/function performSignupSave_\([\s\S]*?\n  \}/);
  var toggle = fn[0].match(/suDoneCheckinBlock'\)\.classList\.toggle\([^;]*\);/);
  assert.ok(toggle, 'performSignupSave_ must decide whether to show suDoneCheckinBlock');
  assert.ok(toggle[0].indexOf('identityToken') === -1 && toggle[0].indexOf('savedToken') === -1,
    'showing the personal link must NOT depend on identityToken/savedToken — that is current-month only');
  assert.match(toggle[0], /checkinUrl/, 'it must depend on whether a personal check-in URL exists');
})();

(function testNoContinueToCheckInWordingSurvivesOnTheCard() {
  // "Continue to check in" asserts the check-in page is usable right now, which is false for a
  // next-month signup — the page is theirs, it just has nothing to record yet.
  var src = readStaticPage_();
  var card = src.match(/<div id="su-step-done"[\s\S]*?\n      <\/div>/);
  var copy = card[0].replace(/\s+/g, ' ');
  assert.doesNotMatch(copy, /Continue to check in/i,
    'the card must not promise check-in is available today — it may not be');
})();

(function testDoneCardCarriesBookmarkGuidance() {
  var src = readStaticPage_();
  var card = src.match(/<div id="su-step-done"[\s\S]*?\n      <\/div>/);
  assert.ok(card, 'su-step-done card not found in index.html');
  // Whitespace-normalised: the copy is hand-wrapped for readability in source, and a reflow
  // during a copy edit must not read as a missing phrase.
  var copy = card[0].replace(/\s+/g, ' ');
  assert.match(copy, /bookmark/i, 'the done card must tell the PAX to bookmark their personal link');
  assert.match(copy, /Add to Home Screen/i, 'the done card must offer Add to Home Screen, same as the email');
  assert.match(card[0], /suDoneTrackerHelp/,
    'the tracker link must be framed by help copy for someone having trouble with the check-in link');
})();

console.log('test_signup_done_bookmarkable_url.js: all assertions passed');
