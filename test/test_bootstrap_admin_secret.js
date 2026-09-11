const assert = require('node:assert/strict');

// F3Go30-4xgj: bootstrapAdminSecret_ (script/WebApp.js) is an unauthenticated race on an
// anonymous deployment (REVIEW-260910 finding 15, staged docs/staging/review-260910.md
// stage:observability) — deliberately not fixed here (the bootstrap flow must keep working
// before any secret exists, §3.2). This only closes the observability gap: the already_bootstrapped
// rejection used to return silently; it must now log so probing is visible. The action itself is
// entry-point-registry `[permanent]` deferred from the live-driven suite (test/contract/
// entryPointRegistry.js: "driving it mid-suite rewrites the admin secret every later call depends
// on") — this file never drives it through that shared fixture; it's an isolated in-memory store
// per test, the same prior-art pattern other [permanent] actions use for their pure-logic node
// coverage (e.g. test_set_context_date_admin.js, test_pax_cache.js's purge-bound tests).

global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: function(text) {
    return { _text: text, setMimeType: function() { return this; } };
  }
};

var loggedEvents_ = [];
global.GasLogger = {
  log: function(name, payload) { loggedEvents_.push({ name: name, payload: payload }); },
  logError: function() {},
  run: function(name, fn) { return fn(); },
};

var fakeScriptProperties_;
global.PropertiesService = {
  getScriptProperties: function() {
    return {
      getProperty: function(key) { return Object.prototype.hasOwnProperty.call(fakeScriptProperties_, key) ? fakeScriptProperties_[key] : null; },
      setProperty: function(key, value) { fakeScriptProperties_[key] = value; },
      setProperties: function(props) { Object.assign(fakeScriptProperties_, props); },
    };
  }
};

const { handleAdminPost_ } = require('../script/WebApp.js');

function callBootstrap_(secret) {
  var payload = { action: 'bootstrapSecret', secret: secret };
  var response = handleAdminPost_({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(response._text);
}

function reset_() {
  fakeScriptProperties_ = {};
  loggedEvents_ = [];
}

reset_();
var firstResult = callBootstrap_('a-sixteen-char-secret');
assert.deepEqual(firstResult, { ok: true });
assert.ok(loggedEvents_.some(function(e) { return e.name === 'bootstrapAdminSecret_.bootstrapped'; }),
  'the success path must still log bootstrapAdminSecret_.bootstrapped, unchanged by this bead');

loggedEvents_ = [];
var secondResult = callBootstrap_('a-different-16-char-secret');
assert.deepEqual(secondResult, { ok: false, error: 'already_bootstrapped' });
assert.ok(loggedEvents_.some(function(e) { return e.name === 'bootstrapAdminSecret_.alreadyBootstrapped'; }),
  'the already_bootstrapped rejection must now be logged so probing is visible (F3Go30-4xgj)');

reset_();
var shortSecretResult = callBootstrap_('too-short');
assert.deepEqual(shortSecretResult, { ok: false, error: 'secret must be at least 16 characters' });
assert.equal(loggedEvents_.length, 0, 'the pre-existing validation-failure path is unchanged — no new log line for it');

console.log('test_bootstrap_admin_secret.js: bootstrapAdminSecret_ observability assertions passed');
