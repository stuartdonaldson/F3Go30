const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-833s.15: the doPost entry log must carry the client's baked build version (so a
// stale-PWA report can be diagnosed from Axiom without guessing), while still never logging
// the rest of postData.contents (PAX names/emails/secrets — see buildWebAppRequestLog_'s note).
//
// F3Go30-taag/F3Go30-emwk.14: GAS globals come from test/helpers/gasEnv.js instead of hand-rolled
// stubs, and each case is its own `it` so a failure names the behaviour rather than the file.

global.HtmlService = {
  createTemplateFromFile: function() { return {}; },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; }
};
global.ScriptApp = { getService: function() { return { getUrl: function() { return 'https://example.com/exec'; } }; } };
installGasEnv_({ logger: true, properties: true });

const { buildWebAppRequestLog_ } = require('../script/WebApp.js');

describe('buildWebAppRequestLog_ client version', function() {
  it('carries clientVersion through from the post body without logging its contents', function() {
    var e = {
      postData: { type: 'text/plain', length: 42, contents: JSON.stringify({ action: 'identify', clientVersion: '2.4.3', f3Name: 'Should Not Appear' }) }
    };
    var log = buildWebAppRequestLog_(e);
    assert.equal(log.clientVersion, '2.4.3');
    assert.equal(log.postData.length, 42, 'postData.length must still be logged');
    assert.equal(log.postData.contents, undefined, 'raw postData.contents must never be logged');
  });

  it('marks a body with no clientVersion as legacy', function() {
    var e = {
      postData: { type: 'text/plain', length: 10, contents: JSON.stringify({ action: 'identify', f3Name: 'GAS Page' }) }
    };
    var log = buildWebAppRequestLog_(e);
    assert.equal(log.clientVersion, 'legacy');
  });

  it('marks a request with no postData at all as legacy', function() {
    // doGet requests (e.g. renderHomePage_) carry no postData at all.
    var log = buildWebAppRequestLog_({ parameter: {} });
    assert.equal(log.clientVersion, 'legacy');
  });

  it('marks an unparseable body as legacy rather than throwing', function() {
    var e = { postData: { type: 'application/x-www-form-urlencoded', length: 20, contents: 'formIdentify=1&f3Name=Foo' } };
    var log = buildWebAppRequestLog_(e);
    assert.equal(log.clientVersion, 'legacy');
  });
});
