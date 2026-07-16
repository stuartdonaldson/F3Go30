const assert = require('node:assert/strict');

// F3Go30-5nfj.1: a saved-link ?id=<token> check-in login used to cost a whole extra /exec round
// trip — doGet (renderCheckinPage_) served an empty CheckinApp shell, then the client fired an
// async callApi('identify', {token}) POST to populate it. This mirrors the pattern already used
// for the typed-identify form POST (renderCheckinPageForTypedIdentify_): resolve the token
// server-side inside the SAME doGet and bake the result into the page. Modeled on
// test_ns_client_roundtrip.js's HtmlService-mock approach and test_checkin_sessions.js's
// CheckinSessions sheet fixture.

function fakeTemplate_() {
  var captured = {};
  var proxy = new Proxy(captured, {
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
  return proxy;
}

global.HtmlService = {
  createTemplateFromFile: function() { return fakeTemplate_(); },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; }
};
global.ScriptApp = { getService: function() { return { getUrl: function() { return 'https://example.com/exec'; } }; } };
global.APP_VERSION = '9.9.9';
global.getConfigValue_ = function() { return {}; };
global.Utilities = { getUuid: function() { return 'fake-uuid'; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
global.resolveContextDate_ = function() { return new Date(); };

function makeFakeScriptCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
  };
}
var fakeCache_;
global.CacheService = { getScriptCache: function() { return fakeCache_; } };

function makeFakeProperties_() {
  var store = {};
  return {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setProperty: function(key, value) { store[key] = value; },
    deleteProperty: function(key) { delete store[key]; },
    getKeys: function() { return Object.keys(store); },
  };
}
var fakeProps_;
global.PropertiesService = { getScriptProperties: function() { return fakeProps_; } };

const { buildCheckinPageOutput_, renderCheckinPage_, handleCheckinIdentify_ } = require('../script/dashboardWebapp.js');

function resetFakes_() {
  fakeCache_ = makeFakeScriptCache_();
  fakeProps_ = makeFakeProperties_();
}

// ── tokenInvalid / plain-miss token still falls back to the blank identify form ────────────
(function testRenderCheckinPageTokenInvalidBakesFallbackNoErrorText() {
  resetFakes_();
  var spreadsheet = {
    getSheetByName: function(name) {
      if (name === 'CheckinSessions') return null; // no session store -> resolveCheckinSession_dw_ misses
      if (name === 'PaxDB') return null;
      return null; // no TrackerDB -> resolveCheckinIdentity_ never reached (tokenInvalid short-circuits first)
    },
  };
  global.resolveTemplateSpreadsheet_ = function() { return spreadsheet; };

  var output = renderCheckinPage_({ parameter: { id: 'stale-or-tampered-token' } });
  var baked = JSON.parse(output.__captured.tokenIdentifyResultJson);
  assert.equal(baked.matched, false);
  assert.equal(baked.tokenInvalid, true);
  // The client's async SAVED_IDENTITY_TOKEN branch must never also fire in parallel — see the
  // documented gotcha (renderCheckinPageForTypedIdentify_) — so savedToken must be null here.
  assert.equal(output.__captured.savedIdentityTokenJson, JSON.stringify(null));
  // formGuid still carries the incoming id through to the identify form's action URL, even
  // though it never resolved.
  assert.equal(output.__captured.formGuid, 'stale-or-tampered-token');
})();

// ── knownPaxNotRegistered token bakes the PaxDB-fallback shape ─────────────────────────────
(function testRenderCheckinPageKnownPaxNotRegisteredBakesFallbackShape() {
  resetFakes_();
  var PAXDB_HEADERS = ['F3 Name', 'Email', 'SheetId', 'Team', 'WHO', 'WHAT', 'HOW', 'Team Type', 'Other Team', 'Phone', 'NAG Email'];
  var spreadsheet = {
    getSheetByName: function(name) {
      if (name === 'CheckinSessions') return null;
      if (name === 'PaxDB') {
        return {
          getDataRange: function() {
            return {
              getValues: function() {
                return [
                  PAXDB_HEADERS,
                  ['LateSignupTest', 'latesignup@example.com', 'sheet-prior', 'Crucible', 'w', 'wh', 'ho', 'ao', '', '', ''],
                ];
              },
            };
          },
        };
      }
      return null; // no TrackerDB -> resolveCheckinIdentity_ misses fast, falling through to PaxDB
    },
  };
  global.resolveTemplateSpreadsheet_ = function() { return spreadsheet; };

  // A pre-rollout legacy signed token never resolves via the session store, so
  // resolveCheckinToken_dw_ falls through to verifyIdentityToken_dw_, which also misses on a
  // non-signature-shaped string -> tokenInvalid. To exercise resolveCheckinIdentity_'s PaxDB
  // fallback path (not the tokenInvalid short-circuit) we instead go through a pre-bound
  // CheckinSessions row that resolves this exact identity.
  var sessionsSheet = {
    getLastRow: function() { return 2; },
    getLastColumn: function() { return 5; },
    getRange: function(row, col, numRows, numCols) {
      var headers = ['Session Id', 'F3 Name', 'Email', 'Created At', 'Last Used At'];
      var body = [['known-pax-token', 'LateSignupTest', 'latesignup@example.com', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z']];
      return {
        getValues: function() {
          var out = [];
          for (var r = 0; r < (numRows || 1); r++) {
            var idx = row + r;
            var source = idx === 1 ? headers : body[idx - 2];
            out.push((source || []).slice((col || 1) - 1, (col || 1) - 1 + (numCols || headers.length)));
          }
          return out;
        },
        setValue: function() {},
        setValues: function() {},
      };
    },
  };
  spreadsheet.getSheetByName = function(name) {
    if (name === 'CheckinSessions') return sessionsSheet;
    if (name === 'PaxDB') {
      return {
        getDataRange: function() {
          return {
            getValues: function() {
              return [
                PAXDB_HEADERS,
                ['LateSignupTest', 'latesignup@example.com', 'sheet-prior', 'Crucible', 'w', 'wh', 'ho', 'ao', '', '', ''],
              ];
            },
          };
        },
      };
    }
    return null; // no TrackerDB -> resolveCheckinIdentity_ misses fast
  };

  var output = renderCheckinPage_({ parameter: { id: 'known-pax-token' } });
  var baked = JSON.parse(output.__captured.tokenIdentifyResultJson);
  assert.equal(baked.matched, false);
  assert.equal(baked.knownPaxNotRegistered, true);
  assert.equal(baked.f3Name, 'LateSignupTest');
  assert.equal(baked.email, 'latesignup@example.com');
  assert.equal(output.__captured.savedIdentityTokenJson, JSON.stringify(null));
})();

// ── a fresh visit (no ?id=) is completely unaffected ────────────────────────────────────────
(function testRenderCheckinPageWithNoIdBakesNothing() {
  resetFakes_();
  var identifyCalled = false;
  global.resolveTemplateSpreadsheet_ = function() { return { getSheetByName: function() { identifyCalled = true; return null; } }; };

  var output = renderCheckinPage_({ parameter: {} });
  assert.equal(output.__captured.tokenIdentifyResultJson, JSON.stringify(null));
  assert.equal(output.__captured.savedIdentityTokenJson, JSON.stringify(null));
  assert.equal(identifyCalled, false, 'handleCheckinIdentify_ must never run when there is no id param');
})();

// ── buildCheckinPageOutput_'s title lookup falls back to the baked token result's f3Name ────
(function testBuildCheckinPageOutputTitleUsesTokenIdentifyResult() {
  resetFakes_();
  var spreadsheet = { getSheetByName: function() { return null; } };
  var output = buildCheckinPageOutput_(null, null, 'guid-x', spreadsheet, null, null, { f3Name: 'Token Resolved Name' });
  // pageTitle isn't captured directly by this fake (setTitle isn't proxied through __captured),
  // so assert via the raw output shape instead: tokenIdentifyResultJson round-trips as given.
  assert.equal(output.__captured.tokenIdentifyResultJson, JSON.stringify({ f3Name: 'Token Resolved Name' }));
})();

// ── a valid session-bound token that resolves to a real match bakes the full populated shape ──
(function testRenderCheckinPageValidTokenBakesFullMatchedResult() {
  resetFakes_();
  var today = new Date(2026, 6, 2); // July 2, 2026
  global.resolveContextDate_ = function() { return today; };

  var RESPONSES_HEADERS = [
    'Timestamp', 'Email Address', 'F3 Name', 'Are you currently participating in Go30?',
    'Team type', 'Team', 'Other team name',
    'WHO do you ultimately want to become?', 'WHAT is your Go30 Challenge?',
    'HOW are you going to be successful this month?', 'Cell Phone Number', 'NAG Email?',
  ];
  var RESPONSES_ROW = [
    new Date(2026, 5, 1), 'anchor@example.com', 'Anchor', 'Yes',
    'AO', 'Crucible', '',
    'A better leader', 'Run 30 miles', 'Daily accountability', '', 'No',
  ];

  var trackerRow2 = ['', '', '', '', '', '', '', '', '', ''];
  var trackerRow3 = ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score',
    new Date(2026, 6, 1), new Date(2026, 6, 2)];
  var trackerPaxRows = [
    ['Anchor', 'Crucible', '', '', '', '', 5, 0.5, 1, 1],
  ];

  function makeRangeSheet_(rows2d) {
    return {
      getLastRow: function() { return rows2d.length; },
      getLastColumn: function() { return rows2d.reduce(function(m, r) { return Math.max(m, r.length); }, 0); },
      getRange: function(row, col, numRows, numCols) {
        return {
          getValues: function() {
            var out = [];
            for (var r = 0; r < (numRows || 1); r++) out.push((rows2d[row - 1 + r] || []).slice());
            return out;
          },
        };
      },
    };
  }

  var responsesSheet = makeRangeSheet_([RESPONSES_HEADERS, RESPONSES_ROW]);
  var trackerSheet = makeRangeSheet_([[], trackerRow2, trackerRow3].concat(trackerPaxRows));

  var monthSpreadsheet = {
    getSheetByName: function(name) {
      if (name === 'Responses') return responsesSheet;
      if (name === 'Tracker') return trackerSheet;
      return null;
    },
  };
  global.SpreadsheetApp = { openById: function(id) { assert.equal(id, 'sheet-jul'); return monthSpreadsheet; } };

  var trackerDbSheet = {
    getDataRange: function() {
      return {
        getValues: function() {
          return [
            ['Date Modified', 'StartDate', 'SpreadsheetName', 'SheetId', 'TrackerUrl'],
            [new Date(2026, 5, 25), new Date(2026, 6, 1), 'July 2026', 'sheet-jul', 'https://example/jul'],
          ];
        },
      };
    },
  };

  var sessionsSheet = {
    getLastRow: function() { return 2; },
    getLastColumn: function() { return 5; },
    getRange: function(row, col, numRows, numCols) {
      var headers = ['Session Id', 'F3 Name', 'Email', 'Created At', 'Last Used At'];
      var body = [['valid-anchor-token', 'Anchor', 'anchor@example.com', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z']];
      return {
        getValues: function() {
          var out = [];
          for (var r = 0; r < (numRows || 1); r++) {
            var idx = row + r;
            var source = idx === 1 ? headers : body[idx - 2];
            out.push((source || []).slice((col || 1) - 1, (col || 1) - 1 + (numCols || headers.length)));
          }
          return out;
        },
        setValue: function() {},
        setValues: function() {},
      };
    },
  };

  var templateSpreadsheet = {
    getSheetByName: function(name) {
      if (name === 'CheckinSessions') return sessionsSheet;
      if (name === 'TrackerDB') return trackerDbSheet;
      return null;
    },
  };
  global.resolveTemplateSpreadsheet_ = function() { return templateSpreadsheet; };

  var output = renderCheckinPage_({ parameter: { id: 'valid-anchor-token' } });
  var baked = JSON.parse(output.__captured.tokenIdentifyResultJson);
  assert.equal(baked.matched, true);
  assert.equal(baked.f3Name, 'Anchor');
  assert.equal(baked.team, 'Crucible');
  assert.equal(baked.todayStatus, 'done'); // Jul 2 col value 1
  assert.equal(baked.identityToken, 'valid-anchor-token');
  assert.equal(baked.firstUse, true); // createdAt === lastUsedAt in the fixture -> never resolved before
  // No client-side identify round trip needed — savedToken must stay null.
  assert.equal(output.__captured.savedIdentityTokenJson, JSON.stringify(null));

  delete global.SpreadsheetApp;
  global.resolveContextDate_ = function() { return new Date(); };
})();

console.log('test_checkin_token_inline_identify.js: all assertions passed');
