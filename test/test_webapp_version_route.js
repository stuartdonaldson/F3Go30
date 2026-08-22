const assert = require('node:assert/strict');

// RECOMMENDATION.md §3.2 (F3Go30-gas-deploy Stage 1c): cmd=version must return the stamped
// build identity with no secret required, on both GET and POST, so it works on an
// ANYONE_ANONYMOUS deployment and before any secret is bootstrapped.

global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: function(text) {
    return { _text: text, setMimeType: function() { return this; } };
  },
};
global.HtmlService = {
  createTemplateFromFile: function() { return {}; },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; },
};

// The stamped build identity (version.js's globals in the real GAS runtime — WebApp.js and
// version.js are concatenated into one global scope there).
global.APP_VERSION = '2.5.0.11';
global.APP_VERSION_DATE = '2026-08-22T00:38:28.874Z';
global.APP_DEPLOY_TARGET = 'TEST';

global.PropertiesService = {
  getScriptProperties: function() { return { getProperty: function() { return null; } }; },
};
global.ScriptApp = {
  getService: function() { return { getUrl: function() { return 'https://script.google.com/macros/s/AKfycbzTEST123/exec'; } }; },
};
// resolveWebAppBaseUrl_ (Utilities.js) is a plain global function in the real (GAS-concatenated)
// runtime; under Node it must be stubbed like every other cross-file global in this suite (see
// test_dashboard_webapp.js's resolveContextDate_ stub for the same pattern) — its real body just
// walks PropertiesService then ScriptApp.getService().getUrl(), which is what this returns.
global.resolveWebAppBaseUrl_ = function() { return 'https://script.google.com/macros/s/AKfycbzTEST123/exec'; };

const { handleVersionRequest_, extractDeploymentIdFromUrl_, doGet, doPost } = require('../script/WebApp.js');

function readJson_(output) {
  return JSON.parse(output._text);
}

(function testExtractDeploymentIdFromUrl() {
  assert.equal(
    extractDeploymentIdFromUrl_('https://script.google.com/macros/s/AKfycbzTEST123/exec'),
    'AKfycbzTEST123'
  );
  assert.equal(extractDeploymentIdFromUrl_(''), null);
  assert.equal(extractDeploymentIdFromUrl_(null), null);
  assert.equal(extractDeploymentIdFromUrl_('not a webapp url'), null);
})();

(function testHandleVersionRequestReturnsStampedIdentity() {
  const body = readJson_(handleVersionRequest_());
  assert.deepEqual(body, {
    ok: true,
    version: '2.5.0.11',
    versionDate: '2026-08-22T00:38:28.874Z',
    target: 'TEST',
    deploymentId: 'AKfycbzTEST123',
  });
})();

(function testDoGetRoutesCmdVersionNoSecret() {
  const body = readJson_(doGet({ parameter: { cmd: 'version' } }));
  assert.equal(body.ok, true);
  assert.equal(body.version, '2.5.0.11');
  assert.ok(!('adminSecret' in body));
})();

(function testDoPostRoutesCmdVersionNoSecret() {
  // No adminSecret in the payload at all — cmd=version must not require one.
  const body = readJson_(doPost({ parameter: { cmd: 'version' }, postData: { type: 'text/plain', length: 2, contents: '{}' } }));
  assert.equal(body.ok, true);
  assert.equal(body.target, 'TEST');
  assert.equal(body.deploymentId, 'AKfycbzTEST123');
})();

console.log('test_webapp_version_route.js: all tests passed');
