const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-833s.11 — every signup link a PAX can hold must end up at the static signup, whether
// it is a link this code mints today (home page, check-in deep links, the Slack short URL) or
// one already distributed and unrewritable (bookmarks, old Slack posts, TinyURL aliases). The
// unrewritable ones are covered by making the GAS ?cmd=signup page itself carry arrivals
// across — the AC5 "an old link is never a dead end" case, which was previously verifiable
// only by hand. See test_static_signup_url.js for buildStaticSignupUrl_'s own shape.

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

function fakeTemplate_() {
  var captured = {};
  return new Proxy(captured, {
    set: function(target, prop, value) { target[prop] = value; return true; },
    get: function(target, prop) {
      if (prop === 'evaluate') {
        return function() {
          var output = {
            setTitle: function() { return output; },
            setFaviconUrl: function() { return output; },
            addMetaTag: function() { return output; },
            __captured: captured,
          };
          return output;
        };
      }
      return target[prop];
    }
  });
}

global.HtmlService = {
  createTemplateFromFile: function() { return fakeTemplate_(); },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; },
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

const { renderSignupPage_, renderHomePage_, renderStaticRedirect_, logStaticRedirect_ } = require('../script/WebApp.js');
// dashboardWebapp.js's renderCheckinPage_ calls renderStaticRedirect_ and logStaticRedirect_ as
// bare GAS-runtime globals (one flat script scope in production) — bind them before requiring
// dashboardWebapp.js, mirroring the buildStatic*_ globals above.
global.renderStaticRedirect_ = renderStaticRedirect_;
global.logStaticRedirect_ = logStaticRedirect_;
const { buildCheckinPageOutput_, renderCheckinPage_ } = require('../script/dashboardWebapp.js');
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
    STATIC_BASE + 'sit/?webapp=' + encodeURIComponent(WEBAPP) +
      '&cmd=signup&id=sess-123&ns=sit-smoke&contextDate=2026-07-01&targetMonth=next&autoStart=1&from=gas'
  );
})();

(function testRedirectUrlHandlesABareLegacyLink() {
  // The commonest already-distributed shape: a TinyURL or bookmark with nothing but cmd=signup.
  var url = buildStaticSignupRedirectUrl_(WEBAPP, { cmd: 'signup' });
  assert.equal(url, STATIC_BASE + 'sit/?webapp=' + encodeURIComponent(WEBAPP) + '&cmd=signup&from=gas');
})();

(function testAutoStartOnlyCarriesWhenExplicitlyOne() {
  assert.ok(buildStaticSignupRedirectUrl_(WEBAPP, { autoStart: '0' }).indexOf('autoStart') === -1);
  assert.ok(buildStaticSignupRedirectUrl_(WEBAPP, { autoStart: '1' }).indexOf('&autoStart=1') !== -1);
})();

(function testStaticZeroOptsOutOfTheRedirect() {
  // Developer/legacy escape hatch (ADR-019): the GAS page stays reachable, one parameter away.
  assert.equal(buildStaticSignupRedirectUrl_(WEBAPP, { cmd: 'signup', static: '0' }), '');
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
    STATIC_BASE + 'sit/?webapp=' + encodeURIComponent(WEBAPP) +
      '&id=sess-123&ns=sit-smoke&contextDate=2026-07-01&from=gas'
  );
})();

(function testCheckinRedirectUrlHandlesABareLegacyLink() {
  var url = buildStaticCheckinRedirectUrl_(WEBAPP, { cmd: 'checkin' });
  assert.equal(url, STATIC_BASE + 'sit/?webapp=' + encodeURIComponent(WEBAPP) + '&from=gas');
})();

(function testCheckinRedirectUrlStaticZeroOptsOut() {
  // Same escape hatch as the signup route (ADR-019): the GAS page stays reachable.
  assert.equal(buildStaticCheckinRedirectUrl_(WEBAPP, { id: 'sess-123', static: '0' }), '');
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
  assert.ok(output.__html, 'renders the redirect page, not the GAS home template');
  assert.ok(
    output.__html.indexOf('href="' + expected.replace(/&/g, '&amp;') + '"') !== -1,
    'home route redirect must target the same static URL check-in would, with identity params intact'
  );
})();

(function testHomeRouteStaticZeroStillRendersTheGasHomePage() {
  var output = renderHomePage_({ parameter: { static: '0' } });
  assert.equal(output.__html, undefined, 'no redirect page');
  assert.ok(output.__captured && 'signupUrl' in output.__captured, 'the real GAS home template rendered');
})();

(function testCheckinRouteRedirectsToStaticCheckinUrlCarryingIdentityParams() {
  var output = renderCheckinPage_({ parameter: { id: 'sess-123', ns: 'sit-smoke', contextDate: '2026-07-01' } });
  var expected = buildStaticCheckinRedirectUrl_(WEBAPP, { id: 'sess-123', ns: 'sit-smoke', contextDate: '2026-07-01' });
  assert.ok(output.__html, 'renders the redirect page, not the GAS check-in template');
  assert.ok(
    output.__html.indexOf('href="' + expected.replace(/&/g, '&amp;') + '"') !== -1,
    'check-in route redirect must carry id/ns/contextDate across to the static front end'
  );
})();

(function testCheckinRouteStaticZeroStillRendersTheGasCheckinPage() {
  var output = renderCheckinPage_({ parameter: { static: '0' } });
  assert.equal(output.__html, undefined, 'no redirect page');
  assert.ok(output.__captured && 'urlNsJson' in output.__captured, 'the real GAS check-in template rendered');
})();

// ── AC5: an old ?cmd=signup arrival reaches the static signup, and is never a dead end ───────

(function testLegacySignupArrivalRedirectsToTheStaticSignup() {
  var output = renderSignupPage_({ parameter: { cmd: 'signup', targetMonth: 'next', autoStart: '1' } });
  var expected = buildStaticSignupRedirectUrl_(WEBAPP, { targetMonth: 'next', autoStart: '1' });

  assert.ok(output.__html, 'renders the redirect page, not the GAS signup template');
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

(function testStaticZeroStillRendersTheGasSignupPage() {
  var output = renderSignupPage_({ parameter: { cmd: 'signup', static: '0', ns: 'sit-smoke' } });
  assert.equal(output.__html, undefined, 'no redirect page');
  assert.equal(output.__captured.urlNsJson, JSON.stringify('sit-smoke'), 'the real GAS template rendered');
})();

(function testUnconfiguredStaticHostStillRendersTheGasSignupPage() {
  // The other half of the fallback: nothing to redirect TO means render as before, never a
  // redirect to ''.
  var saved = global.buildStaticSignupRedirectUrl_;
  global.buildStaticSignupRedirectUrl_ = function() { return ''; };
  try {
    var output = renderSignupPage_({ parameter: { cmd: 'signup' } });
    assert.equal(output.__html, undefined, 'no redirect page when no static URL can be built');
    assert.ok(output.__captured, 'the real GAS template rendered');
  } finally {
    global.buildStaticSignupRedirectUrl_ = saved;
  }
})();

// ── AC2: emitters mint static signup links, not bare ?cmd=signup ─────────────────────────────

(function testHomePageSignupLinkIsStatic() {
  // static=0 reaches the real GAS home template (F3Go30-ubwl.2 now redirects a bare arrival by
  // default — see testHomeRouteRedirectsToStaticCheckinUrlCarryingIdentityParams above) — this
  // test's own job is the emitted signup link's shape, not the redirect.
  var output = renderHomePage_({ parameter: { static: '0' } });
  assert.equal(output.__captured.signupUrl, buildStaticSignupUrl_(WEBAPP));
  assert.ok(output.__captured.signupUrl.indexOf(STATIC_BASE) === 0, 'points at the static host');
})();

(function testCheckinPageGetsAStaticSignupBaseCarryingItsOwnNsAndContextDate() {
  var output = buildCheckinPageOutput_(null, null, 'guid-1', { id: 'bound' }, 'sit-smoke', '2026-07-01');
  assert.equal(
    JSON.parse(output.__captured.staticSignupBaseUrlJson),
    buildStaticSignupUrl_(WEBAPP, { ns: 'sit-smoke', contextDate: '2026-07-01' })
  );
})();

(function testCheckinPageStaticSignupBaseIsEmptyWhenStaticHostIsUnconfigured() {
  var saved = global.buildStaticSignupUrl_;
  global.buildStaticSignupUrl_ = function() { return ''; };
  try {
    var output = buildCheckinPageOutput_(null, null, 'guid-1', { id: 'bound' }, null, null);
    assert.equal(JSON.parse(output.__captured.staticSignupBaseUrlJson), '',
      'empty string, so CheckinApp.html takes its GAS fallback');
  } finally {
    global.buildStaticSignupUrl_ = saved;
  }
})();

// ── Client-side half of the check-in page's deep link (static-shape check on the HTML source,
//    since that JS runs inside a GAS-templated <script> tag with no module boundary to require).

(function testCheckinAppDeepLinkPrefersTheStaticBaseWithAGasFallback() {
  var src = fs.readFileSync(path.join(__dirname, '..', 'script', 'CheckinApp.html'), 'utf8');

  var declIndex = src.search(/var STATIC_SIGNUP_BASE_URL_\s*=/);
  assert.ok(declIndex !== -1, 'STATIC_SIGNUP_BASE_URL_ is templated in');
  assert.ok(src.indexOf('<?!= staticSignupBaseUrlJson ?>') !== -1,
    'bound to the template property buildCheckinPageOutput_ sets');

  var fnMatch = src.match(/function signupDeepLinkUrl_\(targetMonth\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'signupDeepLinkUrl_ is still the single place the deep link is built');
  var body = fnMatch[0];
  assert.ok(body.indexOf('STATIC_SIGNUP_BASE_URL_') !== -1, 'prefers the static base');
  assert.ok(body.indexOf("'?cmd=signup'") !== -1, 'keeps the GAS page as its fallback');
  assert.ok(body.indexOf('&targetMonth=') !== -1 && body.indexOf('&autoStart=1') !== -1,
    'appends targetMonth/autoStart with & — both bases already carry a query string');
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
