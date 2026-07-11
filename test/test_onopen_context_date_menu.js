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
    fn();
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

console.log('test_onopen_context_date_menu.js: all assertions passed');
