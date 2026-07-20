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
} = require('../script/Utilities.js');

// WebApp.js/dashboardWebapp.js reach these as GAS-runtime globals (one flat script scope);
// under Node they're module exports, so bind them onto global exactly as the runtime would.
global.buildStaticSignupUrl_ = buildStaticSignupUrl_;
global.buildStaticSignupRedirectUrl_ = buildStaticSignupRedirectUrl_;
global.buildStaticCheckinUrl_ = require('../script/Utilities.js').buildStaticCheckinUrl_;

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

const { renderSignupPage_, renderHomePage_ } = require('../script/WebApp.js');
const { buildCheckinPageOutput_ } = require('../script/dashboardWebapp.js');
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
      '&cmd=signup&id=sess-123&ns=sit-smoke&contextDate=2026-07-01&targetMonth=next&autoStart=1'
  );
})();

(function testRedirectUrlHandlesABareLegacyLink() {
  // The commonest already-distributed shape: a TinyURL or bookmark with nothing but cmd=signup.
  var url = buildStaticSignupRedirectUrl_(WEBAPP, { cmd: 'signup' });
  assert.equal(url, STATIC_BASE + 'sit/?webapp=' + encodeURIComponent(WEBAPP) + '&cmd=signup');
})();

(function testAutoStartOnlyCarriesWhenExplicitlyOne() {
  assert.ok(buildStaticSignupRedirectUrl_(WEBAPP, { autoStart: '0' }).indexOf('autoStart') === -1);
  assert.ok(buildStaticSignupRedirectUrl_(WEBAPP, { autoStart: '1' }).indexOf('&autoStart=1') !== -1);
})();

(function testStaticZeroOptsOutOfTheRedirect() {
  // ADR-018's availability fallback: the GAS page stays reachable, one parameter away.
  assert.equal(buildStaticSignupRedirectUrl_(WEBAPP, { cmd: 'signup', static: '0' }), '');
})();

(function testNoWebappUrlDeclinesToRedirect() {
  assert.equal(buildStaticSignupRedirectUrl_('', { cmd: 'signup' }), '');
})();

// ── AC5: an old ?cmd=signup arrival reaches the static signup, and is never a dead end ───────

(function testLegacySignupArrivalRedirectsToTheStaticSignup() {
  var output = renderSignupPage_({ parameter: { cmd: 'signup', targetMonth: 'next', autoStart: '1' } });
  var expected = buildStaticSignupRedirectUrl_(WEBAPP, { targetMonth: 'next', autoStart: '1' });

  assert.ok(output.__html, 'renders the redirect page, not the GAS signup template');
  // window.top, not window.location — HtmlService serves this inside a sandbox iframe, so
  // navigating the frame alone would leave the PAX on script.google.com with the static page
  // trapped inside it.
  assert.ok(
    output.__html.indexOf('window.top.location.replace(' + JSON.stringify(expected) + ')') !== -1,
    'scripted hop targets the top frame with the query-preserving static URL'
  );
  // Never a dead end: the same destination is a real, tappable link, so a browser that blocks
  // the scripted top-level navigation still gets the PAX there.
  assert.ok(
    output.__html.indexOf('href="' + expected.replace(/&/g, '&amp;') + '"') !== -1,
    'redirect page also offers the destination as a manual link'
  );
  assert.ok(output.__html.indexOf('target="_top"') !== -1, 'manual link escapes the sandbox iframe too');
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
  var output = renderHomePage_({ parameter: {} });
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
