const assert = require('node:assert/strict');

// F3Go30-y8j7.4: onOpen.js's "Invalidate Cache" menu action has no call-site anywhere — the
// admin route it wraps (admin.invalidateAllCache) is driven live by
// pax-history-reload-live-check.spec.js, but the menu wrapper itself (the confirm dialog, the
// WEBAPP_URL/ADMIN_SHARED_SECRET guard, and the HTTP dispatch to the deployed webapp) was
// entirely untested. This node-tests that wiring end to end with mocked GAS globals, the same
// pattern test_onopen_context_date_menu.js already established for setContextDateMenuAction's
// PROD guard.

global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };

const { invalidateCacheMenuAction } = require('../script/onOpen.js');

/**
 * Wires fake SpreadsheetApp/PropertiesService/UrlFetchApp globals and runs invalidateCacheMenuAction.
 * @param {object} opts
 * @param {'OK'|'CANCEL'} opts.confirmResponse  what the confirm dialog "returns"
 * @param {object} [opts.props]  Script Properties to serve (default: none set)
 * @param {function} [opts.fetch]  UrlFetchApp.fetch stub; defaults to throwing (must not be called)
 * @returns {{alerts: Array, fetchCalls: Array}}
 */
function run_(opts) {
  var props = opts.props || {};
  var alerts = [];
  var fetchCalls = [];
  var fetchImpl = opts.fetch || function() { throw new Error('UrlFetchApp.fetch must not be called'); };

  global.SpreadsheetApp = {
    getUi: function() {
      return {
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
        Button: { OK: 'OK', CANCEL: 'CANCEL' },
        alert: function() {
          var args = Array.prototype.slice.call(arguments);
          alerts.push(args);
          // The confirm dialog is the one called with two string args plus a ButtonSet; the
          // plain result alerts in this file are called with one arg. Only the confirm call's
          // return value matters to invalidateCacheMenuAction's `if (response !== ui.Button.OK)`.
          return args.length >= 3 ? opts.confirmResponse : undefined;
        },
      };
    },
  };
  global.PropertiesService = {
    getScriptProperties: function() {
      return { getProperty: function(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; } };
    },
  };
  global.UrlFetchApp = {
    fetch: function() {
      fetchCalls.push(Array.prototype.slice.call(arguments));
      return fetchImpl.apply(null, arguments);
    },
  };

  invalidateCacheMenuAction();
  return { alerts: alerts, fetchCalls: fetchCalls };
}

function lastAlertText_(alerts) {
  var call = alerts[alerts.length - 1];
  return call[call.length - 1];
}

(function testCancelSkipsHttpCall() {
  var result = run_({ confirmResponse: 'CANCEL' });
  assert.equal(result.fetchCalls.length, 0, 'cancelling the confirm dialog must not call the webapp');
  assert.equal(result.alerts.length, 1, 'only the confirm dialog itself, no follow-up alert');
})();

(function testMissingCredentialsFailsClosed() {
  var result = run_({ confirmResponse: 'OK', props: {} });
  assert.equal(result.fetchCalls.length, 0);
  assert.match(lastAlertText_(result.alerts), /WEBAPP_URL \/ ADMIN_SHARED_SECRET is not set/);
})();

(function testSuccessfulInvalidationReportsCounts() {
  var result = run_({
    confirmResponse: 'OK',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() {
      return { getContentText: function() { return JSON.stringify({ ok: true, wiped: 3, layoutCleared: 1 }); } };
    },
  });
  assert.equal(result.fetchCalls.length, 1);
  var call = result.fetchCalls[0];
  assert.equal(call[0], 'https://example.test/exec?cmd=admin');
  assert.equal(call[1].method, 'post');
  var payload = JSON.parse(call[1].payload);
  assert.equal(payload.action, 'invalidateAllCache');
  assert.equal(payload.adminSecret, 'shh');
  assert.match(lastAlertText_(result.alerts), /3 PAX entries and 1 tracker layout entry cleared/);
})();

(function testSingularCountsWordedCorrectly() {
  var result = run_({
    confirmResponse: 'OK',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() {
      return { getContentText: function() { return JSON.stringify({ ok: true, wiped: 1, layoutCleared: 1 }); } };
    },
  });
  assert.match(lastAlertText_(result.alerts), /1 PAX entry and 1 tracker layout entry cleared/);
})();

(function testServerErrorReported() {
  var result = run_({
    confirmResponse: 'OK',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() {
      return { getContentText: function() { return JSON.stringify({ ok: false, error: 'boom' }); } };
    },
  });
  assert.match(lastAlertText_(result.alerts), /Cache invalidation failed: boom/);
})();

(function testFetchExceptionReported() {
  var result = run_({
    confirmResponse: 'OK',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() { throw new Error('network down'); },
  });
  assert.match(lastAlertText_(result.alerts), /Cache invalidation failed: network down/);
})();

console.log('test_onopen_invalidate_cache_menu.js: all assertions passed');
