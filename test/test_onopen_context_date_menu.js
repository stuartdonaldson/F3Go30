const assert = require('node:assert/strict');

// F3Go30-31w5.2: onOpen.js's "Set Test Context Date..." menu action — human-driver UX for the
// contextDate override (F3Go30-31w5.1). Covers the pure date-format validator and the PROD
// guard that must block before any prompt or admin call, mirroring resolveContextDate_'s own
// PROD guard (go30tools.js) so there's no UI path to override PROD's date either.

global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };

const { parseContextDateMenuInput_, setContextDateMenuAction } = require('../script/onOpen.js');

// --- parseContextDateMenuInput_ ---

(function testValidDateAccepted() {
  assert.deepEqual(parseContextDateMenuInput_('2026-03-15'), { valid: true, iso: '2026-03-15' });
})();

(function testWrongShapeRejected() {
  assert.equal(parseContextDateMenuInput_('3/15/2026').valid, false);
  assert.equal(parseContextDateMenuInput_('2026-03').valid, false);
  assert.equal(parseContextDateMenuInput_('').valid, false);
  assert.equal(parseContextDateMenuInput_(null).valid, false);
})();

(function testCalendarRolloverRejected() {
  // 2026-02-30 doesn't exist — JS Date would silently roll it into March 2.
  assert.equal(parseContextDateMenuInput_('2026-02-30').valid, false);
})();

(function testWhitespaceTrimmed() {
  assert.deepEqual(parseContextDateMenuInput_('  2026-03-15  '), { valid: true, iso: '2026-03-15' });
})();

// --- setContextDateMenuAction PROD guard ---

function fakeUi_(alertLog) {
  return {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL' },
    alert: function() { alertLog.push(Array.prototype.slice.call(arguments)); },
    prompt: function() {
      throw new Error('prompt should never be called on PROD');
    }
  };
}

function withDeployTarget_(target, fn) {
  var prev = global.APP_DEPLOY_TARGET;
  global.APP_DEPLOY_TARGET = target;
  try {
    return fn();
  } finally {
    global.APP_DEPLOY_TARGET = prev;
  }
}

(function testProdGuardBlocksBeforeAnyPrompt() {
  withDeployTarget_('TEMPLATE', function() {
    var alerts = [];
    global.SpreadsheetApp = { getUi: function() { return fakeUi_(alerts); } };
    global.PropertiesService = { getScriptProperties: function() { throw new Error('must not read properties on PROD'); } };
    global.UrlFetchApp = { fetch: function() { throw new Error('must not call the admin webapp on PROD'); } };

    setContextDateMenuAction();

    assert.equal(alerts.length, 1, 'exactly one PROD-guard alert, no prompt reached');
    assert.match(alerts[0][1] || alerts[0][0], /PROD/);
  });
})();

// --- setContextDateMenuAction full wiring (F3Go30-y8j7.4) ---
//
// The PROD guard above was already node-tested; this fills the actual gap the deferral named —
// nothing exercised the prompt -> parse -> PropertiesService lookup -> UrlFetchApp dispatch ->
// result-alert chain on SIT (APP_DEPLOY_TARGET !== 'TEMPLATE').

/**
 * Wires fake SpreadsheetApp/PropertiesService/UrlFetchApp globals and runs setContextDateMenuAction
 * on a non-PROD deploy target.
 * @param {object} opts
 * @param {'OK'|'CANCEL'} opts.promptButton  what the prompt dialog's selected button reports
 * @param {string} [opts.promptText]  the text the tester "typed" into the prompt
 * @param {object} [opts.props]  Script Properties to serve (default: none set)
 * @param {function} [opts.fetch]  UrlFetchApp.fetch stub; defaults to throwing (must not be called)
 */
function runSetContextDate_(opts) {
  var props = opts.props || {};
  var alerts = [];
  var fetchCalls = [];
  var fetchImpl = opts.fetch || function() { throw new Error('UrlFetchApp.fetch must not be called'); };

  return withDeployTarget_('SIT', function() {
    global.SpreadsheetApp = {
      getUi: function() {
        return {
          ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
          Button: { OK: 'OK', CANCEL: 'CANCEL' },
          alert: function() { alerts.push(Array.prototype.slice.call(arguments)); },
          prompt: function() {
            return {
              getSelectedButton: function() { return opts.promptButton; },
              getResponseText: function() { return opts.promptText || ''; },
            };
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

    setContextDateMenuAction();
    return { alerts: alerts, fetchCalls: fetchCalls };
  });
}

function lastAlertText_(alerts) {
  var call = alerts[alerts.length - 1];
  // ui.alert(title, message, buttonSet) for the 3-arg dialogs; ui.alert(message) otherwise.
  return call.length >= 3 ? call[1] : call[0];
}

(function testCancelSkipsHttpCall() {
  var result = runSetContextDate_({ promptButton: 'CANCEL', promptText: '2026-03-15' });
  assert.equal(result.fetchCalls.length, 0, 'cancelling the prompt must not call the webapp');
  assert.equal(result.alerts.length, 0, 'no alert at all when the prompt is cancelled');
})();

(function testInvalidDateRejectedBeforeHttpCall() {
  var result = runSetContextDate_({ promptButton: 'OK', promptText: 'not-a-date' });
  assert.equal(result.fetchCalls.length, 0);
  assert.match(lastAlertText_(result.alerts), /Invalid date: "not-a-date"/);
})();

(function testMissingCredentialsFailsClosed() {
  var result = runSetContextDate_({ promptButton: 'OK', promptText: '2026-03-15', props: {} });
  assert.equal(result.fetchCalls.length, 0);
  assert.match(lastAlertText_(result.alerts), /WEBAPP_URL \/ ADMIN_SHARED_SECRET is not set/);
})();

(function testSuccessfulSetReportsReadyToOpenUrls() {
  var result = runSetContextDate_({
    promptButton: 'OK',
    promptText: '2026-03-15',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() { return { getContentText: function() { return JSON.stringify({ ok: true }); } }; },
  });
  var call = result.fetchCalls[0];
  assert.equal(call[0], 'https://example.test/exec?cmd=admin');
  var payload = JSON.parse(call[1].payload);
  assert.equal(payload.action, 'setContextDate');
  assert.equal(payload.adminSecret, 'shh');
  assert.equal(payload.contextDate, '2026-03-15');
  var text = lastAlertText_(result.alerts);
  assert.match(text, /Context date set to 2026-03-15/);
  assert.match(text, /cmd=checkin&contextDate=2026-03-15/);
  assert.match(text, /cmd=signup&contextDate=2026-03-15/);
})();

(function testBlankInputClearsOverride() {
  var result = runSetContextDate_({
    promptButton: 'OK',
    promptText: '   ',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() { return { getContentText: function() { return JSON.stringify({ ok: true }); } }; },
  });
  var payload = JSON.parse(result.fetchCalls[0][1].payload);
  assert.equal(payload.contextDate, '');
  assert.match(lastAlertText_(result.alerts), /Context date override cleared/);
})();

(function testServerErrorReported() {
  var result = runSetContextDate_({
    promptButton: 'OK',
    promptText: '2026-03-15',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() { return { getContentText: function() { return JSON.stringify({ ok: false, error: 'boom' }); } }; },
  });
  assert.match(lastAlertText_(result.alerts), /Setting context date failed: boom/);
})();

(function testFetchExceptionReported() {
  var result = runSetContextDate_({
    promptButton: 'OK',
    promptText: '2026-03-15',
    props: { WEBAPP_URL: 'https://example.test/exec', ADMIN_SHARED_SECRET: 'shh' },
    fetch: function() { throw new Error('network down'); },
  });
  assert.match(lastAlertText_(result.alerts), /Setting context date failed: network down/);
})();

console.log('test_onopen_context_date_menu.js: all assertions passed');
