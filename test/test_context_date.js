const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-31w5.1: resolveContextDate_ precedence — PROD guard > explicit override > Config
// sheet "Context Date" > real now. See go30tools.js's docstring for the full rationale.

// F3Go30-taag/F3Go30-emwk.14: GasLogger comes from test/helpers/gasEnv.js instead of a hand-rolled
// stub, and each case is its own `it` so a failure names the behaviour rather than the file.
installGasEnv_({ logger: true });

function fakeSpreadsheetWithConfig_(configValues) {
  return {
    __configValues: configValues || null
  };
}

// F3Go30-6daa: counts what the memo is meant to remove — one Config-sheet read per
// resolveContextDate_ call.
var configReads_ = 0;
global.openConfigSheet = function(spreadsheet) {
  if (!spreadsheet || !spreadsheet.__configValues) return null;
  var values = spreadsheet.__configValues;
  return {
    getValue: function(key) {
      configReads_++;
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    }
  };
};

const { resolveContextDate_, invalidateContextDateMemo_ } = require('../script/go30tools.js');

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

describe('resolveContextDate_ precedence', function() {

// 1. PROD guard wins even when both an explicit override and a Config value are present.
it('PROD guard wins over both an explicit override and a Config value', function() {
  withDeployTarget_('TEMPLATE', function() {
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2020-01-01' });
    var result = resolveContextDate_(spreadsheet, '2020-05-05');
    assertCloseToNow_(result, 'PROD result');
  });
});

// 2. Non-PROD: explicit per-request override wins over Config.
it('an explicit per-request override wins over Config', function() {
  withDeployTarget_('TEST', function() {
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-01-01' });
    var result = resolveContextDate_(spreadsheet, '2026-03-15');
    assert.equal(result.toISOString().slice(0, 10), '2026-03-15');
  });
});

// 3. Non-PROD, no explicit override: falls back to the Config sheet's "Context Date".
it("falls back to the Config sheet's Context Date when there is no override", function() {
  withDeployTarget_('TEST', function() {
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-02-20' });
    var result = resolveContextDate_(spreadsheet, null);
    assert.equal(result.toISOString().slice(0, 10), '2026-02-20');
  });
});

// 4. Non-PROD, no override, no Config row: real now.
it('falls back to real now with no override and no Config row', function() {
  withDeployTarget_('TEST', function() {
    var spreadsheet = fakeSpreadsheetWithConfig_({});
    var result = resolveContextDate_(spreadsheet, null);
    assertCloseToNow_(result, 'no-override/no-config result');
  });
});

// 5. Non-PROD, no Config sheet at all (openConfigSheet returns null): real now, no throw.
it('falls back to real now when there is no Config sheet at all', function() {
  withDeployTarget_('TEST', function() {
    var spreadsheet = fakeSpreadsheetWithConfig_(null);
    var result = resolveContextDate_(spreadsheet, null);
    assertCloseToNow_(result, 'missing Config sheet result');
  });
});

// 6. Invalid explicit override string falls through to Config rather than producing Invalid Date.
it('falls through to Config when the explicit override is unparseable', function() {
  withDeployTarget_('TEST', function() {
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-04-10' });
    var result = resolveContextDate_(spreadsheet, 'not-a-date');
    assert.equal(result.toISOString().slice(0, 10), '2026-04-10');
  });
});

});

describe('resolveContextDate_ per-execution memo', function() {
// ---------------------------------------------------------------------------------------------
// F3Go30-6daa — per-execution memoization of the Config-sheet leg.
// The memo is safe only because Apps Script runs one execution per request with freshly-evaluated
// globals (see _configContextDateMemoized_'s docstring); every test below is about the one window
// that guarantee does NOT cover — a Config write followed by a read inside the same execution.
// ---------------------------------------------------------------------------------------------

// 7. Repeat calls for the same spreadsheet read the Config sheet ONCE (the dashboard/bonus paths
//    call resolveContextDate_ several times per request; resolveBonusSheet_ twice back to back).
it('reads the Config sheet once per execution, not once per call', function() {
  withDeployTarget_('TEST', function() {
    invalidateContextDateMemo_();
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-05-05' });
    configReads_ = 0;
    var first = resolveContextDate_(spreadsheet, null);
    var second = resolveContextDate_(spreadsheet, null);
    var third = resolveContextDate_(spreadsheet, null);
    assert.equal(configReads_, 1, 'the Config sheet must be read once per execution, not per call');
    assert.equal(first.toISOString().slice(0, 10), second.toISOString().slice(0, 10));
    assert.equal(second.getTime(), third.getTime());
  });
});

// 8. A miss is memoized too (a no-Config-value read costs the same sheet open as a hit).
it('memoizes a Config miss as well as a hit', function() {
  withDeployTarget_('TEST', function() {
    invalidateContextDateMemo_();
    var spreadsheet = fakeSpreadsheetWithConfig_({});
    configReads_ = 0;
    assertCloseToNow_(resolveContextDate_(spreadsheet, null), 'first no-config result');
    assertCloseToNow_(resolveContextDate_(spreadsheet, null), 'second no-config result');
    assert.equal(configReads_, 1, 'a negative Config result must be memoized as well');
  });
});

// 9. WRITE-THEN-READ IN ONE EXECUTION: after a Config write, invalidateContextDateMemo_ (called by
//    WebApp.js's setContextDate/setConfigValue) makes the next resolve see the value just written,
//    not the pre-write memo. This is the Must-not — a memo with no invalidation path.
it('sees a value written earlier in the same execution once the memo is invalidated', function() {
  withDeployTarget_('TEST', function() {
    invalidateContextDateMemo_();
    var configValues = { 'Context Date': '2026-06-01' };
    var spreadsheet = fakeSpreadsheetWithConfig_(configValues);
    assert.equal(resolveContextDate_(spreadsheet, null).toISOString().slice(0, 10), '2026-06-01');

    configValues['Context Date'] = '2026-07-04';           // the write
    assert.equal(resolveContextDate_(spreadsheet, null).toISOString().slice(0, 10), '2026-06-01',
      'without invalidation the memo is (correctly) still serving the pre-write value');

    invalidateContextDateMemo_();                          // what the write path must do
    assert.equal(resolveContextDate_(spreadsheet, null).toISOString().slice(0, 10), '2026-07-04',
      'after invalidation the same execution must see the value it just wrote');
  });
});

// 10. The memo is per spreadsheet — two namespaces resolved in one execution must not share a
//     context date (ADR-014: one script project serves many namespaces' spreadsheets).
it('keeps the memo per spreadsheet so two namespaces never share a context date', function() {
  withDeployTarget_('TEST', function() {
    invalidateContextDateMemo_();
    var nsA = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-08-08' });
    var nsB = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-09-09' });
    assert.equal(resolveContextDate_(nsA, null).toISOString().slice(0, 10), '2026-08-08');
    assert.equal(resolveContextDate_(nsB, null).toISOString().slice(0, 10), '2026-09-09');
    assert.equal(resolveContextDate_(nsA, null).toISOString().slice(0, 10), '2026-08-08');
  });
});

// 11. Precedence is untouched by the memo: an explicit override still wins on a memoized
//     spreadsheet, and does not poison the memo for the next override-free call.
it('leaves precedence untouched: an override wins without poisoning the memo', function() {
  withDeployTarget_('TEST', function() {
    invalidateContextDateMemo_();
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-10-10' });
    assert.equal(resolveContextDate_(spreadsheet, null).toISOString().slice(0, 10), '2026-10-10');
    assert.equal(resolveContextDate_(spreadsheet, '2026-11-11').toISOString().slice(0, 10), '2026-11-11');
    assert.equal(resolveContextDate_(spreadsheet, null).toISOString().slice(0, 10), '2026-10-10');
  });
});

// 12. A caller mutating the returned Date must not corrupt the memo (it is handed a copy).
it('hands out a copy, so a caller mutating the Date cannot corrupt the memo', function() {
  withDeployTarget_('TEST', function() {
    invalidateContextDateMemo_();
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2026-12-12' });
    var first = resolveContextDate_(spreadsheet, null);
    first.setFullYear(1999);
    assert.equal(resolveContextDate_(spreadsheet, null).toISOString().slice(0, 10), '2026-12-12');
  });
});

// 13. PROD never reads the Config sheet at all — the guard short-circuits before the memo.
it('never reads Config on PROD — the guard short-circuits before the memo', function() {
  withDeployTarget_('TEMPLATE', function() {
    invalidateContextDateMemo_();
    var spreadsheet = fakeSpreadsheetWithConfig_({ 'Context Date': '2020-01-01' });
    configReads_ = 0;
    assertCloseToNow_(resolveContextDate_(spreadsheet, null), 'PROD memo-path result');
    assert.equal(configReads_, 0, 'PROD must not read Config at all');
  });
});

});
