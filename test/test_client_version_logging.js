const assert = require('node:assert/strict');

// F3Go30-833s.15: the doPost entry log must carry the client's baked build version (so a
// stale-PWA report can be diagnosed from Axiom without guessing), while still never logging
// the rest of postData.contents (PAX names/emails/secrets — see buildWebAppRequestLog_'s note).

global.HtmlService = {
  createTemplateFromFile: function() { return {}; },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; }
};
global.ScriptApp = { getService: function() { return { getUrl: function() { return 'https://example.com/exec'; } }; } };
global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

const { buildWebAppRequestLog_ } = require('../script/WebApp.js');

(function testClientVersionCarriedThroughFromPostBody() {
  var e = {
    postData: { type: 'text/plain', length: 42, contents: JSON.stringify({ action: 'identify', clientVersion: '2.4.3', f3Name: 'Should Not Appear' }) }
  };
  var log = buildWebAppRequestLog_(e);
  assert.equal(log.clientVersion, '2.4.3');
  assert.equal(log.postData.length, 42, 'postData.length must still be logged');
  assert.equal(log.postData.contents, undefined, 'raw postData.contents must never be logged');
})();

(function testMissingClientVersionMarkedLegacy() {
  var e = {
    postData: { type: 'text/plain', length: 10, contents: JSON.stringify({ action: 'identify', f3Name: 'GAS Page' }) }
  };
  var log = buildWebAppRequestLog_(e);
  assert.equal(log.clientVersion, 'legacy');
})();

(function testNoPostDataMarkedLegacy() {
  // doGet requests (e.g. renderHomePage_) carry no postData at all.
  var log = buildWebAppRequestLog_({ parameter: {} });
  assert.equal(log.clientVersion, 'legacy');
})();

(function testUnparseableBodyMarkedLegacyNotThrown() {
  var e = { postData: { type: 'application/x-www-form-urlencoded', length: 20, contents: 'formIdentify=1&f3Name=Foo' } };
  var log = buildWebAppRequestLog_(e);
  assert.equal(log.clientVersion, 'legacy');
})();

console.log('test_client_version_logging.js: all tests passed');
