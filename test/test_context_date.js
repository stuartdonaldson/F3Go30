const assert = require('node:assert/strict');

// F3Go30-31w5.1: resolveContextDate_ precedence — PROD guard > explicit override > Config
// sheet "Context Date" > real now. See go30tools.js's docstring for the full rationale.

global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };

function fakeSpreadsheetWithConfig_(configValues) {
  return {
    __configValues: configValues || null
  };
}

global.openConfigSheet = function(spreadsheet) {
  if (!spreadsheet || !spreadsheet.__configValues) return null;
  var values = spreadsheet.__configValues;
  return {
    getValue: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    }
  };
};

const { resolveContextDate_ } = require('../script/go30tools.js');

function withDeployTarget_(target, fn) {
  var prev = global.APP_DEPLOY_TARGET;
  global.APP_DEPLOY_TARGET = target;
  try {
    fn();
  } finally {
    global.APP_DEPLOY_TARGET = prev;
  }
}

function assertCloseToNow_(date, label) {
  assert.ok(Math.abs(date.getTime() - Date.now()) < 5000, label + ' should be ~real now');
}

// 1. PROD guard wins even when both an explicit override and a Config value are present.
withDeployTarget_('TEMPLATE', function() {
  var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2020-01-01' });
  var result = resolveContextDate_(spreadsheet, '2020-05-05');
  assertCloseToNow_(result, 'PROD result');
});

// 2. Non-PROD: explicit per-request override wins over Config.
withDeployTarget_('TEST', function() {
  var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-01-01' });
  var result = resolveContextDate_(spreadsheet, '2026-03-15');
  assert.equal(result.toISOString().slice(0, 10), '2026-03-15');
});

// 3. Non-PROD, no explicit override: falls back to the Config sheet's "Context Date".
withDeployTarget_('TEST', function() {
  var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-02-20' });
  var result = resolveContextDate_(spreadsheet, null);
  assert.equal(result.toISOString().slice(0, 10), '2026-02-20');
});

// 4. Non-PROD, no override, no Config row: real now.
withDeployTarget_('TEST', function() {
  var spreadsheet = fakeSpreadsheetWithConfig_({});
  var result = resolveContextDate_(spreadsheet, null);
  assertCloseToNow_(result, 'no-override/no-config result');
});

// 5. Non-PROD, no Config sheet at all (openConfigSheet returns null): real now, no throw.
withDeployTarget_('TEST', function() {
  var spreadsheet = fakeSpreadsheetWithConfig_(null);
  var result = resolveContextDate_(spreadsheet, null);
  assertCloseToNow_(result, 'missing Config sheet result');
});

// 6. Invalid explicit override string falls through to Config rather than producing Invalid Date.
withDeployTarget_('TEST', function() {
  var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-04-10' });
  var result = resolveContextDate_(spreadsheet, 'not-a-date');
  assert.equal(result.toISOString().slice(0, 10), '2026-04-10');
});

console.log('test_context_date.js: all assertions passed');
