const assert = require('node:assert/strict');

// F3Go30-31w5.1: the setContextDate admin action persists a contextDate override into the
// ns-resolved spreadsheet's Config sheet, but must refuse outright on PROD (APP_DEPLOY_TARGET
// === 'TEMPLATE') — resolveContextDate_'s own PROD guard would ignore a stored value anyway,
// but this fails loudly at write time instead of silently doing nothing useful.

global.GasLogger = { log: function() {}, logError: function() {}, run: function(name, fn) { return fn(); } };
global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: function(text) {
    return {
      _text: text,
      setMimeType: function() { return this; }
    };
  }
};

var fakeScriptProperties_ = { ADMIN_SHARED_SECRET: 'test-secret' };
global.PropertiesService = {
  getScriptProperties: function() {
    return {
      getProperty: function(key) { return Object.prototype.hasOwnProperty.call(fakeScriptProperties_, key) ? fakeScriptProperties_[key] : null; },
      setProperty: function(key, value) { fakeScriptProperties_[key] = value; },
      setProperties: function(props) { Object.assign(fakeScriptProperties_, props); }
    };
  }
};

var upsertedCalls_ = [];
var configSheetAvailable_ = true;
var configRowsForRead_ = {};
global.resolveTemplateSpreadsheet_ = function(e, payload) { return { __ns: (payload && payload.ns) || null }; };
global.openConfigSheet = function(spreadsheet) {
  if (!configSheetAvailable_) return null;
  return {
    upsertValue: function(key, primary, secondary) { upsertedCalls_.push({ key: key, value: primary, secondary: secondary, ns: spreadsheet.__ns }); },
    getPair: function(key) { return Object.prototype.hasOwnProperty.call(configRowsForRead_, key) ? configRowsForRead_[key] : null; },
    // F3Go30-6daa: resolveContextDate_ reads "Context Date" through getValue — needed by the
    // memo-invalidation tests at the bottom of this file.
    getValue: function(key) { configReads_++; return key === 'Context Date' ? contextDateCellValue_ : null; },
  };
};
var configReads_ = 0;
var contextDateCellValue_ = null;

const { handleAdminPost_ } = require('../script/WebApp.js');
const { resolveContextDate_, invalidateContextDateMemo_ } = require('../script/go30tools.js');

function callAdmin_(action, extra) {
  var payload = Object.assign({ action: action, adminSecret: 'test-secret' }, extra || {});
  var response = handleAdminPost_({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(response._text);
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

// 1. Non-PROD: writes the Config sheet and reports ok.
withDeployTarget_('TEST', function() {
  upsertedCalls_ = [];
  var result = callAdmin_('setContextDate', { ns: 'sit-smoke', contextDate: '2026-03-15' });
  assert.equal(result.ok, true);
  assert.equal(result.contextDate, '2026-03-15');
  assert.deepEqual(upsertedCalls_, [{ key: 'Context Date', value: '2026-03-15', secondary: undefined, ns: 'sit-smoke' }]);
});

// 2. PROD: refuses before ever touching the Config sheet.
withDeployTarget_('TEMPLATE', function() {
  upsertedCalls_ = [];
  var result = callAdmin_('setContextDate', { ns: 'sit-smoke', contextDate: '2026-03-15' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden_in_prod');
  assert.deepEqual(upsertedCalls_, []);
});

// 3. Non-PROD, missing Config sheet: reports the specific error instead of throwing.
withDeployTarget_('TEST', function() {
  configSheetAvailable_ = false;
  var result = callAdmin_('setContextDate', { contextDate: '2026-03-15' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'config_sheet_not_found');
  configSheetAvailable_ = true;
});

// ── setConfigValue (F3Go30-g9bi): generic Config-sheet write, same shape/guards as setContextDate

// 4. Non-PROD: writes the Config sheet (key + both primary/secondary) and reports ok.
withDeployTarget_('TEST', function() {
  upsertedCalls_ = [];
  var result = callAdmin_('setConfigValue', { ns: 'sit-smoke', key: 'Announce.11', primary: 'HC moved to Saturday' });
  assert.equal(result.ok, true);
  assert.equal(result.key, 'Announce.11');
  assert.deepEqual(upsertedCalls_, [{ key: 'Announce.11', value: 'HC moved to Saturday', secondary: '', ns: 'sit-smoke' }]);
});

// 5. PROD: refuses before ever touching the Config sheet.
withDeployTarget_('TEMPLATE', function() {
  upsertedCalls_ = [];
  var result = callAdmin_('setConfigValue', { ns: 'sit-smoke', key: 'Announce.11', primary: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden_in_prod');
  assert.deepEqual(upsertedCalls_, []);
});

// 6. Non-PROD, missing key: reports the specific error instead of writing a blank-key row.
withDeployTarget_('TEST', function() {
  upsertedCalls_ = [];
  var result = callAdmin_('setConfigValue', { primary: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'key is required');
  assert.deepEqual(upsertedCalls_, []);
});

// 7. Non-PROD, missing Config sheet: reports the specific error instead of throwing.
withDeployTarget_('TEST', function() {
  configSheetAvailable_ = false;
  var result = callAdmin_('setConfigValue', { key: 'Announce.11', primary: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'config_sheet_not_found');
  configSheetAvailable_ = true;
});

// ── getConfigValue (F3Go30-g9bi): read-only counterpart, no PROD guard (plain read)

// 8. Found key: reports primary/secondary/found:true.
withDeployTarget_('TEST', function() {
  configRowsForRead_ = { 'Announce.11': { primary: 'HC Moved', secondary: 'HC moved to Saturday' } };
  var result = callAdmin_('getConfigValue', { key: 'Announce.11' });
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.primary, 'HC Moved');
  assert.equal(result.secondary, 'HC moved to Saturday');
});

// 9. Missing key on the sheet: found:false, primary/secondary null — distinguishable from "found
// but blank" (a live-check restore script needs this to know whether to delete vs blank a row).
withDeployTarget_('TEST', function() {
  configRowsForRead_ = {};
  var result = callAdmin_('getConfigValue', { key: 'Announce.99' });
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.primary, null);
  assert.equal(result.secondary, null);
});

// 10. Allowed on PROD (plain read, no guard) — unlike setConfigValue/setContextDate.
withDeployTarget_('TEMPLATE', function() {
  configRowsForRead_ = { 'Site Q': { primary: 'Little John', secondary: 'lj@example.com' } };
  var result = callAdmin_('getConfigValue', { key: 'Site Q' });
  assert.equal(result.ok, true);
  assert.equal(result.primary, 'Little John');
});

// 11. No key: reports the specific error.
withDeployTarget_('TEST', function() {
  var result = callAdmin_('getConfigValue', {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'key is required');
});

// 12. Missing Config sheet: reports the specific error instead of throwing.
withDeployTarget_('TEST', function() {
  configSheetAvailable_ = false;
  var result = callAdmin_('getConfigValue', { key: 'Announce.11' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'config_sheet_not_found');
  configSheetAvailable_ = true;
});

// ── memo invalidation (F3Go30-6daa): both Config-sheet WRITE actions must drop
// resolveContextDate_'s per-execution memo, so a write-then-read inside ONE execution (a
// live-check script's setContextDate followed by a dashboard call in the same request, or
// setConfigValue overwriting the same row) reads the value just written, not the pre-write memo.

function primeContextDateMemo_(spreadsheet, value) {
  invalidateContextDateMemo_();
  contextDateCellValue_ = value;
  configReads_ = 0;
  resolveContextDate_(spreadsheet, null);
  assert.equal(configReads_, 1, 'memo prime should have read Config once');
  resolveContextDate_(spreadsheet, null);
  assert.equal(configReads_, 1, 'memo should be serving the second call');
}

// 13. setContextDate invalidates the memo.
withDeployTarget_('TEST', function() {
  var spreadsheet = { __ns: 'sit-smoke' };
  primeContextDateMemo_(spreadsheet, '2026-03-01');

  contextDateCellValue_ = '2026-04-02';                 // what the upsert would have persisted
  var result = callAdmin_('setContextDate', { ns: 'sit-smoke', contextDate: '2026-04-02' });
  assert.equal(result.ok, true);

  var after = resolveContextDate_(spreadsheet, null);
  assert.equal(configReads_, 2, 'the write must have forced a re-read');
  assert.equal(after.toISOString().slice(0, 10), '2026-04-02',
    'the same execution must see the context date it just wrote');
});

// 14. setConfigValue invalidates it too — it writes the same Config sheet, and can target the
//     "Context Date" row itself.
withDeployTarget_('TEST', function() {
  var spreadsheet = { __ns: 'sit-smoke' };
  primeContextDateMemo_(spreadsheet, '2026-05-01');

  contextDateCellValue_ = '2026-06-03';
  var result = callAdmin_('setConfigValue', { ns: 'sit-smoke', key: 'Context Date', primary: '2026-06-03' });
  assert.equal(result.ok, true);

  var after = resolveContextDate_(spreadsheet, null);
  assert.equal(configReads_, 2, 'the write must have forced a re-read');
  assert.equal(after.toISOString().slice(0, 10), '2026-06-03');
});

// 15. A REFUSED write (PROD guard, missing key, missing Config sheet) writes nothing, so the memo
//     it never invalidated is still correct — asserted so a future change that moves the
//     invalidation ahead of the guards is caught.
withDeployTarget_('TEMPLATE', function() {
  var spreadsheet = { __ns: 'sit-smoke' };
  global.APP_DEPLOY_TARGET = 'TEST';
  primeContextDateMemo_(spreadsheet, '2026-07-01');
  global.APP_DEPLOY_TARGET = 'TEMPLATE';

  var result = callAdmin_('setContextDate', { ns: 'sit-smoke', contextDate: '2026-08-08' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden_in_prod');
  assert.equal(configReads_, 1, 'a refused write must not have invalidated anything');
});

console.log('test_set_context_date_admin.js: all assertions passed');
