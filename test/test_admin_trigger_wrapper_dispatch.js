const assert = require('node:assert/strict');

// F3Go30-y8j7.3: admin.runMinusOneCheck and admin.runPaxCachePurge used to call
// markEmptyCellsAsMinusOne_/purgeStalePaxCache_ (the underscore helper) directly, skipping the
// GasLogger.run-wrapped, trigger-named entry point (markEmptyCellsAsMinusOne/purgeStalePaxCache)
// that the real installed daily trigger actually invokes — so an "on demand" run of either admin
// action produced an Axiom trace that never matched a genuine trigger fire. This test pins that
// dispatch to the trigger-named wrapper, not the helper, so a regression back to the _ call is
// caught here rather than only noticed by a live SIT trace mismatch.

var gasLoggerRunCalls_ = [];
global.GasLogger = {
  log: function() {},
  logError: function() {},
  run: function(triggerName, fn) {
    gasLoggerRunCalls_.push(triggerName);
    return fn();
  },
};
global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: function(text) {
    return { _text: text, setMimeType: function() { return this; } };
  },
};

var fakeScriptProperties_ = { ADMIN_SHARED_SECRET: 'test-secret' };
global.PropertiesService = {
  getScriptProperties: function() {
    return {
      getProperty: function(key) {
        return Object.prototype.hasOwnProperty.call(fakeScriptProperties_, key) ? fakeScriptProperties_[key] : null;
      },
    };
  },
};

var minusOneCalls_ = [];
global.markEmptyCellsAsMinusOne = function(contextDate) {
  minusOneCalls_.push(contextDate);
  return 'minus-one-result';
};
// The underscore helper must NOT be called by the admin dispatch — stub it to blow up if it is.
global.markEmptyCellsAsMinusOne_ = function() {
  throw new Error('handleAdminPost_ called the _ helper directly instead of the trigger wrapper');
};

var purgeCalls_ = [];
global.purgeStalePaxCache = function(now) {
  purgeCalls_.push(now);
  return 'purge-result';
};
global.purgeStalePaxCache_ = function() {
  throw new Error('handleAdminPost_ called the _ helper directly instead of the trigger wrapper');
};

const { handleAdminPost_ } = require('../script/WebApp.js');

function callAdmin_(action, extra) {
  var payload = Object.assign({ action: action, adminSecret: 'test-secret' }, extra || {});
  var response = handleAdminPost_({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(response._text);
}

// 1. runMinusOneCheck dispatches to the trigger-named wrapper (not the _ helper), threading the
//    requested contextDate through.
minusOneCalls_.length = 0;
var minusOneResponse = callAdmin_('runMinusOneCheck', { contextDate: '2026-06-25' });
assert.equal(minusOneResponse.ok, true);
assert.equal(minusOneResponse.result, 'minus-one-result');
assert.equal(minusOneCalls_.length, 1);
assert.equal(minusOneCalls_[0].toISOString().slice(0, 10), '2026-06-25');
console.log('PASS: admin.runMinusOneCheck calls the trigger-named markEmptyCellsAsMinusOne wrapper');

// 2. runPaxCachePurge dispatches to the trigger-named wrapper (not the _ helper), threading the
//    requested contextDate through.
purgeCalls_.length = 0;
var purgeResponse = callAdmin_('runPaxCachePurge', { contextDate: '2026-06-25' });
assert.equal(purgeResponse.ok, true);
assert.equal(purgeResponse.result, 'purge-result');
assert.equal(purgeCalls_.length, 1);
assert.equal(new Date(purgeCalls_[0]).toISOString().slice(0, 10), '2026-06-25');
console.log('PASS: admin.runPaxCachePurge calls the trigger-named purgeStalePaxCache wrapper');

console.log('All test_admin_trigger_wrapper_dispatch tests passed.');
