const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ADR-014 D3 / F3Go30-i5md.3: the sandboxed client iframe carries no query string, so `ns`
// must be (a) read server-side and injected into the page template, and (b) echoed back in
// every callApi() POST body, exactly like targetMonth/id already are. This test covers both
// halves: server-side template injection (executable, via mocked HtmlService) and the
// client-side plumbing (static-shape check on the .html source, since that JS runs inside a
// GAS-templated <script> tag with no module boundary to require() in Node).

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
function fakeSpreadsheet_() {
  return { id: 'bound-spreadsheet', getSheetByName: function() { return null; }, getId: function() { return 'bound-spreadsheet'; } };
}
global.resolveTemplateSpreadsheet_ = function(e) { return fakeSpreadsheet_(); };
global.readTeamLists_ = function() { return { aoList: [], goalList: [] }; };
global.getCurrentAndNextMonths_ = function() { return { current: null, next: null }; };
global.Utilities = { getUuid: function() { return 'fake-uuid'; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

const { renderSignupPage_ } = require('../script/WebApp.js');
const { buildCheckinPageOutput_, renderCheckinPage_, renderCheckinPageForTypedIdentify_ } =
  require('../script/dashboardWebapp.js');

(function testRenderSignupPageInjectsNsFromRequestParameter() {
  var output = renderSignupPage_({ parameter: { ns: 'sit-smoke' } });
  assert.equal(output.__captured.urlNsJson, JSON.stringify('sit-smoke'));
})();

(function testRenderSignupPageDefaultsNsToNullWhenAbsent() {
  var output = renderSignupPage_({ parameter: {} });
  assert.equal(output.__captured.urlNsJson, JSON.stringify(null));
})();

(function testBuildCheckinPageOutputInjectsGivenNs() {
  var output = buildCheckinPageOutput_(null, null, 'guid-1', { id: 'bound' }, 'sit-smoke');
  assert.equal(output.__captured.urlNsJson, JSON.stringify('sit-smoke'));
})();

(function testRenderCheckinPagePassesRequestNsThrough() {
  var output = renderCheckinPage_({ parameter: { ns: 'sit-smoke' } });
  assert.equal(output.__captured.urlNsJson, JSON.stringify('sit-smoke'));
})();

(function testRenderCheckinPageForTypedIdentifyPassesRequestNsThrough() {
  var output = renderCheckinPageForTypedIdentify_({ parameter: { ns: 'sit-smoke', f3Name: 'X', email: 'x@example.com' } });
  assert.equal(output.__captured.urlNsJson, JSON.stringify('sit-smoke'));
})();

// --- Client-side static-shape checks (no Node-executable module boundary for GAS <script> JS) ---

function readHtml_(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'script', name), 'utf8');
}

(function testIdentityCoreCallApiEchoesNs() {
  var src = readHtml_('IdentityCore.html');
  var fnMatch = src.match(/function callApi\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'callApi function body not found in IdentityCore.html');
  assert.match(fnMatch[0], /NS_/, 'callApi body must reference NS_ so ns round-trips on every POST');
})();

(function testCheckinAppDefinesNsBeforeIdentityCoreInclude() {
  var src = readHtml_('CheckinApp.html');
  var nsDeclIndex = src.search(/var NS_\s*=/);
  var includeIndex = src.indexOf("include_('IdentityCore')");
  assert.notEqual(nsDeclIndex, -1, 'CheckinApp.html must declare NS_ from the server-rendered urlNsJson');
  assert.ok(nsDeclIndex < includeIndex, 'NS_ must be declared before IdentityCore is included');
})();

(function testSignupAppDefinesNsBeforeIdentityCoreInclude() {
  var src = readHtml_('SignupApp.html');
  var nsDeclIndex = src.search(/var NS_\s*=/);
  var includeIndex = src.indexOf("include_('IdentityCore')");
  assert.notEqual(nsDeclIndex, -1, 'SignupApp.html must declare NS_ from the server-rendered urlNsJson');
  assert.ok(nsDeclIndex < includeIndex, 'NS_ must be declared before IdentityCore is included');
})();

console.log('test_ns_client_roundtrip.js: all assertions passed');
