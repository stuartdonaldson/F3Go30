const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-31w5.1: contextDate round-trips exactly like `ns` (ADR-014 D3) — read server-side from
// the request's query string / POST payload, injected into the page template, and echoed back
// in every subsequent callApi() POST for that page session (test/test_ns_client_roundtrip.js is
// the precedent this mirrors).

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
global.openConfigSheet = function() { return null; };
function fakeSpreadsheet_() {
  return { id: 'bound-spreadsheet', getSheetByName: function() { return null; }, getId: function() { return 'bound-spreadsheet'; } };
}
global.resolveTemplateSpreadsheet_ = function(e) { return fakeSpreadsheet_(); };
global.readTeamLists_ = function() { return { aoList: [], goalList: [] }; };
global.getCurrentAndNextMonths_ = function() { return { current: null, next: null }; };
global.resolveContextDate_ = function() { return new Date(); };
global.Utilities = { getUuid: function() { return 'fake-uuid'; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

const { renderSignupPage_ } = require('../script/WebApp.js');
const { buildCheckinPageOutput_, renderCheckinPage_, renderCheckinPageForTypedIdentify_ } =
  require('../script/dashboardWebapp.js');

(function testRenderSignupPageInjectsContextDateFromRequestParameter() {
  var output = renderSignupPage_({ parameter: { contextDate: '2026-01-15' } });
  assert.equal(output.__captured.urlContextDateJson, JSON.stringify('2026-01-15'));
})();

(function testRenderSignupPageDefaultsContextDateToNullWhenAbsent() {
  var output = renderSignupPage_({ parameter: {} });
  assert.equal(output.__captured.urlContextDateJson, JSON.stringify(null));
})();

(function testBuildCheckinPageOutputInjectsGivenContextDate() {
  var output = buildCheckinPageOutput_(null, null, 'guid-1', { id: 'bound' }, 'sit-smoke', '2026-01-15');
  assert.equal(output.__captured.urlContextDateJson, JSON.stringify('2026-01-15'));
})();

(function testRenderCheckinPagePassesRequestContextDateThrough() {
  var output = renderCheckinPage_({ parameter: { contextDate: '2026-01-15' } });
  assert.equal(output.__captured.urlContextDateJson, JSON.stringify('2026-01-15'));
})();

(function testRenderCheckinPageForTypedIdentifyPassesRequestContextDateThrough() {
  var output = renderCheckinPageForTypedIdentify_({ parameter: { contextDate: '2026-01-15', f3Name: 'X', email: 'x@example.com' } });
  assert.equal(output.__captured.urlContextDateJson, JSON.stringify('2026-01-15'));
})();

// --- Client-side static-shape checks (no Node-executable module boundary for GAS <script> JS) ---

function readHtml_(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'script', name), 'utf8');
}

(function testIdentityCoreCallApiEchoesContextDate() {
  var src = readHtml_('IdentityCore.html');
  var fnMatch = src.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'callApi function body not found in IdentityCore.html');
  assert.match(fnMatch[0], /CONTEXT_DATE_/, 'callApi body must reference CONTEXT_DATE_ so contextDate round-trips on every POST');
})();

(function testCheckinAppDefinesContextDateBeforeIdentityCoreInclude() {
  var src = readHtml_('CheckinApp.html');
  var declIndex = src.search(/var CONTEXT_DATE_\s*=/);
  var includeIndex = src.indexOf("include_('IdentityCore')");
  assert.notEqual(declIndex, -1, 'CheckinApp.html must declare CONTEXT_DATE_ from the server-rendered urlContextDateJson');
  assert.ok(declIndex < includeIndex, 'CONTEXT_DATE_ must be declared before IdentityCore is included');
})();

(function testSignupAppDefinesContextDateBeforeIdentityCoreInclude() {
  var src = readHtml_('SignupApp.html');
  var declIndex = src.search(/var CONTEXT_DATE_\s*=/);
  var includeIndex = src.indexOf("include_('IdentityCore')");
  assert.notEqual(declIndex, -1, 'SignupApp.html must declare CONTEXT_DATE_ from the server-rendered urlContextDateJson');
  assert.ok(declIndex < includeIndex, 'CONTEXT_DATE_ must be declared before IdentityCore is included');
})();

console.log('test_context_date_client_roundtrip.js: all assertions passed');
