const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-833s.11 — every signup link a PAX can hold must end up at the static signup, whether
// it is a link this code mints today (home page, check-in deep links, the Slack short URL) or
// one already distributed and unrewritable (bookmarks, old Slack posts, TinyURL aliases). The
// unrewritable ones are covered by making the GAS ?cmd=signup route itself carry arrivals
// across — the AC5 "an old link is never a dead end" case, which was previously verifiable
// only by hand. See test_static_signup_url.js for buildStaticSignupUrl_'s own shape.
//
// DR-04 (2026-08-04, design-review-2026-08-04.md; F3Go30-wjpu): the GAS-rendered
// SignupApp.html/CheckinApp.html templates this file used to exercise as a fallback (the
// `?static=0` escape hatch, buildCheckinPageOutput_) are gone — every arrival redirects
// unconditionally to the static front end. What remains here is the redirect-preservation
// contract (every meaningful query param survives the hop) and the short-URL repair logic,
// neither of which depended on the removed templates.

const STATIC_BASE = 'https://pax.example.github.io/f3go30/';
const WEBAPP = 'https://script.example.com/exec';

// Globals in the shape version.js provides them at runtime, set before requiring Utilities.js
// (both builders read them at call time — same contract test_static_signup_url.js relies on).
global.STATIC_PAGES_BASE_URL_ = STATIC_BASE;
global.APP_DEPLOY_TARGET = 'TEST';

const {
  buildStaticSignupUrl_,
  buildStaticSignupRedirectUrl_,
  buildStaticCheckinUrl_,
  buildStaticCheckinRedirectUrl_,
  buildStaticRedirectUrl_,
} = require('../script/Utilities.js');

// WebApp.js/dashboardWebapp.js reach these as GAS-runtime globals (one flat script scope);
// under Node they're module exports, so bind them onto global exactly as the runtime would.
global.buildStaticSignupUrl_ = buildStaticSignupUrl_;
global.buildStaticSignupRedirectUrl_ = buildStaticSignupRedirectUrl_;
global.buildStaticCheckinUrl_ = buildStaticCheckinUrl_;
global.buildStaticCheckinRedirectUrl_ = buildStaticCheckinRedirectUrl_;
global.buildStaticRedirectUrl_ = buildStaticRedirectUrl_;

global.HtmlService = {
  createHtmlOutput: function(html) {
    var output = {
      __html: html,
      setTitle: function() { return output; },
      addMetaTag: function() { return output; },
    };
    return output;
  },
};
global.ScriptApp = { getService: function() { return { getUrl: function() { return WEBAPP; } }; } };
global.APP_VERSION = '9.9.9';
global.getConfigValue_ = function() { return {}; };
global.resolveTemplateSpreadsheet_ = function() {
  return { id: 'bound', getSheetByName: function() { return null; }, getId: function() { return 'bound'; } };
};
global.readTeamLists_ = function() { return { aoList: [], goalList: [] }; };
global.getCurrentAndNextMonths_ = function() { return { current: null, next: null }; };
global.resolveContextDate_ = function() { return new Date(); };
global.Utilities = { getUuid: function() { return 'fake-uuid'; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

const { renderSignupPage_, renderHomePage_, renderStaticRedirect_, renderStaticUnavailable_, logStaticRedirect_ } = require('../script/WebApp.js');
// dashboardWebapp.js's renderCheckinPage_ calls renderStaticRedirect_/logStaticRedirect_ as
// bare GAS-runtime globals (one flat script scope in production) — bind them before requiring
// dashboardWebapp.js, mirroring the buildStatic*_ globals above.
global.renderStaticRedirect_ = renderStaticRedirect_;
global.renderStaticUnavailable_ = renderStaticUnavailable_;
global.logStaticRedirect_ = logStaticRedirect_;
const { renderCheckinPage_ } = require('../script/dashboardWebapp.js');
const { extractShortUrlAlias_ } = require('../script/urlShortener.js');

// ── buildStaticSignupRedirectUrl_: a legacy arrival's query string survives the hop ──────────
//    targetMonth/autoStart/id/ns/contextDate each change what the signup flow does, so dropping
//    any of them would make the redirect a different request rather than the same one.

(function testRedirectUrlPreservesEveryMeaningfulParameter() {
  var url = buildStaticSignupRedirectUrl_(WEBAPP, {
    cmd: 'signup',
    id: 'sess-123',
    ns: 'sit-smoke',
    contextDate: '2026-07-01',
    targetMonth: 'next',
    autoStart: '1',
  });
  assert.equal(
    url,
    STATIC_BASE + 'sit/?cmd=signup&id=sess-123&ns=sit-smoke&contextDate=2026-07-01&targetMonth=next&autoStart=1&from=gas'
  );
})();

(function testRedirectUrlHandlesABareLegacyLink() {
  // The commonest already-distributed shape: a TinyURL or bookmark with nothing but cmd=signup.
  var url = buildStaticSignupRedirectUrl_(WEBAPP, { cmd: 'signup' });
  assert.equal(url, STATIC_BASE + 'sit/?cmd=signup&from=gas');
})();

(function testAutoStartOnlyCarriesWhenExplicitlyOne() {
  assert.ok(buildStaticSignupRedirectUrl_(WEBAPP, { autoStart: '0' }).indexOf('autoStart') === -1);
  assert.ok(buildStaticSignupRedirectUrl_(WEBAPP, { autoStart: '1' }).indexOf('&autoStart=1') !== -1);
})();

(function testNoWebappUrlDeclinesToRedirect() {
  assert.equal(buildStaticSignupRedirectUrl_('', { cmd: 'signup' }), '');
})();

// ── F3Go30-ubwl.4 AC1: buildStaticCheckinRedirectUrl_ — the check-in/home counterpart of ─────
//    buildStaticSignupRedirectUrl_ above, exercising the same generalized buildStaticRedirectUrl_
//    forwarding path (F3Go30-ubwl.2) with buildStaticCheckinUrl_ as its builder instead.

(function testCheckinRedirectUrlPreservesEveryMeaningfulParameter() {
  var url = buildStaticCheckinRedirectUrl_(WEBAPP, {
    id: 'sess-123',
    ns: 'sit-smoke',
    contextDate: '2026-07-01',
  });
  assert.equal(
    url,
    STATIC_BASE + 'sit/?id=sess-123&ns=sit-smoke&contextDate=2026-07-01&from=gas'
  );
})();

(function testCheckinRedirectUrlHandlesABareLegacyLink() {
  var url = buildStaticCheckinRedirectUrl_(WEBAPP, { cmd: 'checkin' });
  assert.equal(url, STATIC_BASE + 'sit/?from=gas');
})();

(function testCheckinRedirectUrlNoWebappUrlDeclinesToRedirect() {
  assert.equal(buildStaticCheckinRedirectUrl_('', { id: 'sess-123' }), '');
})();

// ── F3Go30-ubwl.4 AC2: exactly one shared redirect renderer and one shared param-forwarding ──
//    path back all three routes (signup, check-in, home) — guards the ubwl.2 reuse mandate
//    against a later regression that reintroduces a second, diverging implementation.

(function testAllThreeRedirectBuildersRouteThroughTheSameForwardingPath() {
  var utilSrc = fs.readFileSync(path.join(__dirname, '..', 'script', 'Utilities.js'), 'utf8');
  var defs = utilSrc.match(/^function buildStaticRedirectUrl_\(/gm) || [];
  assert.equal(defs.length, 1, 'exactly one buildStaticRedirectUrl_ definition must exist');

  var signupFn = utilSrc.match(/function buildStaticSignupRedirectUrl_\([\s\S]*?\n\}/)[0];
  var checkinFn = utilSrc.match(/function buildStaticCheckinRedirectUrl_\([\s\S]*?\n\}/)[0];
  assert.match(signupFn, /return buildStaticRedirectUrl_\(/, 'signup redirect must delegate to the shared forwarding path');
  assert.match(checkinFn, /return buildStaticRedirectUrl_\(/, 'check-in redirect must delegate to the shared forwarding path');
})();

(function testAllThreeRoutesRenderThroughTheSameRedirectRenderer() {
  var webAppSrc = fs.readFileSync(path.join(__dirname, '..', 'script', 'WebApp.js'), 'utf8');
  var dashboardSrc = fs.readFileSync(path.join(__dirname, '..', 'script', 'dashboardWebapp.js'), 'utf8');

  var defs = webAppSrc.match(/^function renderStaticRedirect_\(/gm) || [];
  assert.equal(defs.length, 1, 'exactly one renderStaticRedirect_ definition must exist');

  var signupFn = webAppSrc.match(/function renderSignupPage_\([\s\S]*?\n\}/)[0];
  var homeFn = webAppSrc.match(/function renderHomePage_\([\s\S]*?\n\}/)[0];
  var checkinFn = dashboardSrc.match(/function renderCheckinPage_\([\s\S]*?\n\}/)[0];
  assert.match(signupFn, /return renderStaticRedirect_\(/, 'signup route must render through the shared renderer');
  assert.match(homeFn, /return renderStaticRedirect_\(/, 'home route must render through the shared renderer');
  assert.match(checkinFn, /return renderStaticRedirect_\(/, 'check-in route must render through the shared renderer');
})();

(function testHomeRouteRedirectsToStaticCheckinUrlCarryingIdentityParams() {
  var output = renderHomePage_({ parameter: { id: 'sess-123', ns: 'sit-smoke', contextDate: '2026-07-01' } });
  var expected = buildStaticCheckinRedirectUrl_(WEBAPP, { id: 'sess-123', ns: 'sit-smoke', contextDate: '2026-07-01' });
  assert.ok(output.__html, 'renders the redirect page');
  assert.ok(
    output.__html.indexOf('href="' + expected.replace(/&/g, '&amp;') + '"') !== -1,
    'home route redirect must target the same static URL check-in would, with identity params intact'
  );
})();

(function testCheckinRouteRedirectsToStaticCheckinUrlCarryingIdentityParams() {
  var output = renderCheckinPage_({ parameter: { id: 'sess-123', ns: 'sit-smoke', contextDate: '2026-07-01' } });
  var expected = buildStaticCheckinRedirectUrl_(WEBAPP, { id: 'sess-123', ns: 'sit-smoke', contextDate: '2026-07-01' });
  assert.ok(output.__html, 'renders the redirect page');
  assert.ok(
    output.__html.indexOf('href="' + expected.replace(/&/g, '&amp;') + '"') !== -1,
    'check-in route redirect must carry id/ns/contextDate across to the static front end'
  );
})();

(function testCheckinRouteFallsBackToUnavailablePageWhenStaticHostIsUnconfigured() {
  var saved = global.buildStaticCheckinRedirectUrl_;
  global.buildStaticCheckinRedirectUrl_ = function() { return ''; };
  try {
    var output = renderCheckinPage_({ parameter: {} });
    assert.ok(output.__html, 'renders the unavailable page, not undefined');
    assert.match(output.__html, /unavailable/i);
  } finally {
    global.buildStaticCheckinRedirectUrl_ = saved;
  }
})();

// ── AC5: an old ?cmd=signup arrival reaches the static signup, and is never a dead end ───────

(function testLegacySignupArrivalRedirectsToTheStaticSignup() {
  var output = renderSignupPage_({ parameter: { cmd: 'signup', targetMonth: 'next', autoStart: '1' } });
  var expected = buildStaticSignupRedirectUrl_(WEBAPP, { targetMonth: 'next', autoStart: '1' });

  assert.ok(output.__html, 'renders the redirect page');
  // The tappable link is the ONLY hop, not a fallback behind a scripted one: HtmlService serves
  // this inside an iframe sandboxed allow-top-navigation-by-user-activation, so a script-driven
  // top navigation on load has no user gesture and is refused for every visitor. See
  // renderStaticRedirect_'s doc comment.
  assert.ok(
    output.__html.indexOf('href="' + expected.replace(/&/g, '&amp;') + '"') !== -1,
    'redirect page offers the query-preserving static URL as a real link'
  );
  // target="_top", not a frame-local navigation — otherwise the PAX stays on script.google.com
  // with the static page trapped inside the sandbox iframe and an unbookmarkable address bar.
  assert.ok(output.__html.indexOf('target="_top"') !== -1, 'manual link escapes the sandbox iframe');
  // The dead scripted hop must not come back: it could never fire, and it threw an uncaught
  // SecurityError into the console on every legacy arrival.
  assert.ok(
    output.__html.indexOf('location.replace(') === -1,
    'no scripted top-level navigation — it cannot fire without a user gesture'
  );
})();

(function testUnconfiguredStaticHostRendersTheUnavailablePageNotAGasTemplate() {
  // DR-04: there is no GAS template left to fall back to — the only remaining outcome on an
  // unbuildable static URL (practically Node-test-only; every real deployment has one) is the
  // minimal renderStaticUnavailable_ page.
  var saved = global.buildStaticSignupRedirectUrl_;
  global.buildStaticSignupRedirectUrl_ = function() { return ''; };
  try {
    var output = renderSignupPage_({ parameter: { cmd: 'signup' } });
    assert.ok(output.__html, 'renders a page');
    assert.match(output.__html, /unavailable/i);
  } finally {
    global.buildStaticSignupRedirectUrl_ = saved;
  }
})();

(function testRenderStaticUnavailableNamesTheUnavailableThing() {
  var output = renderStaticUnavailable_('Go30 Hard Commit Signup');
  assert.match(output.__html, /Go30 Hard Commit Signup is unavailable/);
})();

// ── AC2: emitters mint static signup links, not bare ?cmd=signup ─────────────────────────────

(function testHomePageSignupLinkIsStatic() {
  var output = renderHomePage_({ parameter: {} });
  // A bare arrival redirects by default (F3Go30-ubwl.2) — this test's own job is the emitted
  // signup link's shape at the source (buildStaticSignupUrl_), independent of the redirect path.
  assert.equal(buildStaticSignupUrl_(WEBAPP).indexOf(STATIC_BASE), 0, 'points at the static host');
  assert.ok(output.__html, 'sanity: the route still renders something');
})();

// ── AC4: re-pointing an already-distributed TinyURL alias ────────────────────────────────────

(function testAliasIsRecoverableFromAStoredShortUrl() {
  // ensureSignupShortUrl_ stores only the short URL, so the alias to re-point has to come back
  // out of it.
  assert.equal(extractShortUrlAlias_('https://tinyurl.com/Go30Signup'), 'Go30Signup');
  assert.equal(extractShortUrlAlias_('https://tinyurl.com/Go30Signup/'), 'Go30Signup');
  assert.equal(extractShortUrlAlias_('https://tinyurl.com/Go30Signup?x=1'), 'Go30Signup');
  assert.equal(extractShortUrlAlias_(''), '', 'no short URL yet → nothing to re-point');
  assert.equal(extractShortUrlAlias_('https://tinyurl.com/'), '', 'no alias segment');
  assert.equal(extractShortUrlAlias_(null), '');
})();

(function testRepairPathAttemptsARepointBeforeMintingANewAlias() {
  // Static-shape check: ensureSignupShortUrl_ pulls in GAS-only Drive/Sheets globals well
  // beyond this branch, so assert the ordering that matters — re-point, verify, and only then
  // fall through to shortenUrl — rather than standing up the whole tracker-creation harness.
  var src = fs.readFileSync(path.join(__dirname, '..', 'script', 'CreateNewTracker.js'), 'utf8');
  var fnMatch = src.match(/function ensureSignupShortUrl_\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'ensureSignupShortUrl_ found');
  var body = fnMatch[0];

  assert.ok(body.indexOf('buildStaticSignupUrl_') !== -1,
    'the short URL targets the static signup, not a bare ?cmd=signup');

  var repointIndex = body.indexOf('repointTinyUrlAlias');
  var shortenIndex = body.indexOf('shortenUrl(');
  assert.ok(repointIndex !== -1, 'repair tries to re-point the existing alias');
  assert.ok(shortenIndex !== -1, 'minting a new alias remains the fallback');
  assert.ok(repointIndex < shortenIndex,
    're-point is attempted BEFORE minting — a new alias migrates nobody who saved the old one');
  assert.ok(body.indexOf('resolveShortUrlRedirectTarget_(existingShortUrl) === expectedTarget') !== -1,
    'the re-point is verified against the live redirect, not trusted from the API response');
})();

console.log('test_signup_link_migration.js: all assertions passed');
