const assert = require('node:assert/strict');

var gasLoggerErrors = [];
global.GasLogger = {
  log: function() {},
  logError: function(tag, err, data) { gasLoggerErrors.push({ tag: tag, err: err, data: data }); },
  run: function(name, fn) { return fn(); }
};

const {
  resolveTemplateSpreadsheet_, _lookupNamespaceTemplateId_, _lookupNamespaceRegistryRow_, NAMESPACE_DB_SHEET_NAME_,
  NAMESPACE_DB_HEADERS_, buildNamespaceRegistryRow_, appendNamespaceRegistryRow_, removeNamespaceRegistryRow_,
  _listNamespaceRegistryRows_
} = require('../script/go30tools.js');

function fakeSheet_(headers, rows) {
  var values = [headers].concat(rows);
  return { getDataRange: function() { return { getValues: function() { return values; } }; } };
}

function fakeAppendableSheet_(headers, rows) {
  var appended = [];
  return {
    getDataRange: function() { return { getValues: function() { return [headers].concat(rows); } }; },
    appendRow: function(row) { appended.push(row); },
    _appended: appended
  };
}

function fakeBoundSpreadsheet_(namespaceDbSheet) {
  return {
    getSheetByName: function(name) {
      if (name === NAMESPACE_DB_SHEET_NAME_) return namespaceDbSheet;
      return null;
    }
  };
}

(function testNoNsParamFallsBackToBound() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return boundSpreadsheet; } };
  var result = resolveTemplateSpreadsheet_({ parameter: {} });
  assert.equal(result, boundSpreadsheet);
  delete global.SpreadsheetApp;
})();

(function testMissingNamespaceDbSheetFallsBackToBound() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(null);
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return boundSpreadsheet; } };
  var result = resolveTemplateSpreadsheet_({ parameter: { ns: 'sit-smoke' } });
  assert.equal(result, boundSpreadsheet);
  delete global.SpreadsheetApp;
})();

(function testUnregisteredNsFallsBackToBound() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return boundSpreadsheet; } };
  var result = resolveTemplateSpreadsheet_({ parameter: { ns: 'not-registered' } });
  assert.equal(result, boundSpreadsheet);
  delete global.SpreadsheetApp;
})();

(function testRegisteredNsResolvesToOpenedTemplate() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  var resolvedSpreadsheet = { id: 'tmpl-1' };
  var openByIdCalls = [];
  global.SpreadsheetApp = {
    getActiveSpreadsheet: function() { return boundSpreadsheet; },
    openById: function(id) { openByIdCalls.push(id); return resolvedSpreadsheet; }
  };
  var result = resolveTemplateSpreadsheet_({ parameter: { ns: 'sit-smoke' } });
  assert.equal(result, resolvedSpreadsheet);
  assert.deepEqual(openByIdCalls, ['tmpl-1']);
  delete global.SpreadsheetApp;
})();

(function testOpenByIdFailureFallsBackToBoundAndLogs() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  global.SpreadsheetApp = {
    getActiveSpreadsheet: function() { return boundSpreadsheet; },
    openById: function() { throw new Error('not found'); }
  };
  gasLoggerErrors.length = 0;
  var result = resolveTemplateSpreadsheet_({ parameter: { ns: 'sit-smoke' } });
  assert.equal(result, boundSpreadsheet);
  assert.equal(gasLoggerErrors.length, 1);
  assert.equal(gasLoggerErrors[0].tag, 'resolveTemplateSpreadsheet_.openById.error');
  delete global.SpreadsheetApp;
})();

(function testUndefinedEventFallsBackToBound() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(null);
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return boundSpreadsheet; } };
  var result = resolveTemplateSpreadsheet_(undefined);
  assert.equal(result, boundSpreadsheet);
  delete global.SpreadsheetApp;
})();

(function testPostBodyNsResolvesWhenParameterAbsent() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  var resolvedSpreadsheet = { id: 'tmpl-1' };
  global.SpreadsheetApp = {
    getActiveSpreadsheet: function() { return boundSpreadsheet; },
    openById: function() { return resolvedSpreadsheet; }
  };
  var result = resolveTemplateSpreadsheet_({ parameter: { cmd: 'admin' } }, { action: 'createTrackerForMonth', ns: 'sit-smoke' });
  assert.equal(result, resolvedSpreadsheet);
  delete global.SpreadsheetApp;
})();

(function testQueryParamNsTakesPrecedenceOverPostBody() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1'], ['other', 'tmpl-2']]));
  var openByIdCalls = [];
  global.SpreadsheetApp = {
    getActiveSpreadsheet: function() { return boundSpreadsheet; },
    openById: function(id) { openByIdCalls.push(id); return { id: id }; }
  };
  resolveTemplateSpreadsheet_({ parameter: { ns: 'sit-smoke' } }, { ns: 'other' });
  assert.deepEqual(openByIdCalls, ['tmpl-1']);
  delete global.SpreadsheetApp;
})();

(function testLookupHelperReturnsEmptyStringWhenUnresolved() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  assert.equal(_lookupNamespaceTemplateId_(boundSpreadsheet, 'nope'), '');
  assert.equal(_lookupNamespaceTemplateId_(boundSpreadsheet, 'sit-smoke'), 'tmpl-1');
})();

(function testMaliciousNsLookingLikeSpreadsheetIdIsRejectedWhenUnregistered() {
  // ADR-014 D2/i5md.5: an ns that itself resembles (or IS) a real spreadsheet id must never
  // resolve unless NamespaceDB explicitly registers it — the registry is the only allowlist,
  // never the shape of the ns string.
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return boundSpreadsheet; } };
  var maliciousNs = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz-someRealLookingSheetId';
  var result = resolveTemplateSpreadsheet_({ parameter: { ns: maliciousNs } });
  assert.equal(result, boundSpreadsheet);
  assert.equal(_lookupNamespaceTemplateId_(boundSpreadsheet, maliciousNs), '');
  delete global.SpreadsheetApp;
})();

(function testRegistryRowLookupReturnsNullWhenUnresolved() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], [['sit-smoke', 'tmpl-1']]));
  assert.equal(_lookupNamespaceRegistryRow_(boundSpreadsheet, 'nope'), null);
  assert.equal(_lookupNamespaceRegistryRow_(fakeBoundSpreadsheet_(null), 'sit-smoke'), null);
})();

(function testRegistryRowLookupSurfacesKindAndTriggerColumns() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(
    ['NameSpace', 'TemplateId', 'Kind', 'NagEnabled', 'MinusOneEnabled', 'AutoGenerateEnabled', 'CleanupSessionsEnabled'],
    [['sit-smoke', 'tmpl-1', 'smoke', 'Yes', 'no', 'true', '']]
  ));
  var row = _lookupNamespaceRegistryRow_(boundSpreadsheet, 'sit-smoke');
  assert.deepEqual(row, {
    namespace: 'sit-smoke',
    templateId: 'tmpl-1',
    kind: 'smoke',
    nagEnabled: true,
    minusOneEnabled: false,
    autoGenerateEnabled: true,
    cleanupSessionsEnabled: false
  });
})();

// _listNamespaceRegistryRows_ (F3Go30-440b.2 follow-up) — every registered namespace's row,
// contrast _lookupNamespaceRegistryRow_'s single-ns lookup.
(function testListNamespaceRegistryRowsReturnsEmptyWhenSheetMissing() {
  assert.deepEqual(_listNamespaceRegistryRows_(fakeBoundSpreadsheet_(null)), []);
})();

(function testListNamespaceRegistryRowsReturnsEmptyWhenSheetHasNoRows() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(['NameSpace', 'TemplateId'], []));
  assert.deepEqual(_listNamespaceRegistryRows_(boundSpreadsheet), []);
})();

(function testListNamespaceRegistryRowsReturnsEveryRow() {
  var boundSpreadsheet = fakeBoundSpreadsheet_(fakeSheet_(
    ['NameSpace', 'TemplateId', 'Kind', 'NagEnabled', 'MinusOneEnabled', 'AutoGenerateEnabled', 'CleanupSessionsEnabled'],
    [
      ['sit-smoke', 'tmpl-1', 'smoke', 'Yes', 'no', 'true', ''],
      ['demo-env', 'tmpl-2', 'demo', '', '', '', ''],
    ]
  ));
  var rows = _listNamespaceRegistryRows_(boundSpreadsheet);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].namespace, 'sit-smoke');
  assert.equal(rows[0].templateId, 'tmpl-1');
  assert.equal(rows[0].nagEnabled, true);
  assert.equal(rows[1].namespace, 'demo-env');
  assert.equal(rows[1].templateId, 'tmpl-2');
})();

(function testBuildNamespaceRegistryRowDefaultsKindAndBlanksTriggerFlags() {
  // ADR-014 D6: a fresh registration defaults Kind to 'smoke' and leaves fan-out opt-ins off
  // until an operator deliberately enables them.
  var row = buildNamespaceRegistryRow_({ nameSpace: 'SIT-2026-07-06', templateId: 'tmpl-new' });
  assert.deepEqual(row, {
    nameSpace: 'SIT-2026-07-06',
    templateId: 'tmpl-new',
    kind: 'smoke',
    nagEnabled: '',
    minusOneEnabled: '',
    autoGenerateEnabled: '',
    cleanupSessionsEnabled: ''
  });
})();

(function testBuildNamespaceRegistryRowHonorsExplicitKindAndFlags() {
  var row = buildNamespaceRegistryRow_({
    nameSpace: 'demo-env', templateId: 'tmpl-demo', kind: 'demo',
    nagEnabled: true, minusOneEnabled: true, autoGenerateEnabled: true, cleanupSessionsEnabled: true
  });
  assert.equal(row.kind, 'demo');
  assert.equal(row.nagEnabled, 'Yes');
  assert.equal(row.minusOneEnabled, 'Yes');
  assert.equal(row.autoGenerateEnabled, 'Yes');
  assert.equal(row.cleanupSessionsEnabled, 'Yes');
})();

(function testAppendNamespaceRegistryRowWritesInHeaderOrder() {
  var sheet = fakeAppendableSheet_(
    ['Kind', 'NameSpace', 'TemplateId', 'NagEnabled', 'MinusOneEnabled', 'AutoGenerateEnabled', 'CleanupSessionsEnabled'],
    []
  );
  var registrySpreadsheet = { getSheetByName: function(name) { return name === NAMESPACE_DB_SHEET_NAME_ ? sheet : null; } };
  var result = appendNamespaceRegistryRow_(registrySpreadsheet, { nameSpace: 'SIT-2026-07-06', templateId: 'tmpl-new', kind: 'smoke' });
  assert.deepEqual(sheet._appended, [['smoke', 'SIT-2026-07-06', 'tmpl-new', '', '', '', '']]);
  assert.equal(result.nameSpace, 'SIT-2026-07-06');
})();

// First-registration bootstrap: a registry deployment with no NamespaceDB sheet yet has one
// created + seeded with the canonical header row, then the row is appended (create-then-write,
// never silently skipped). Prevents the manual per-environment sheet-setup prerequisite.
(function testAppendNamespaceRegistryRowCreatesSheetWhenMissing() {
  var created = null;
  var registrySpreadsheet = {
    getSheetByName: function() { return null; },
    insertSheet: function(name) {
      created = { name: name, sheet: fakeAppendableSheet_(NAMESPACE_DB_HEADERS_, []) };
      // The seeded header row goes through appendRow like any other; mirror it into the
      // data range so the subsequent header-order lookup sees real headers.
      var s = created.sheet;
      s.getDataRange = function() { return { getValues: function() { return [s._appended[0] || []]; } }; };
      return s;
    }
  };
  var result = appendNamespaceRegistryRow_(registrySpreadsheet, { nameSpace: 'boot-env', templateId: 'tmpl-boot', kind: 'smoke' });
  assert.notEqual(created, null, 'a NamespaceDB sheet should have been inserted');
  assert.equal(created.name, NAMESPACE_DB_SHEET_NAME_);
  assert.deepEqual(created.sheet._appended[0], NAMESPACE_DB_HEADERS_, 'header row seeded first');
  assert.deepEqual(created.sheet._appended[1], ['boot-env', 'tmpl-boot', 'smoke', '', '', '', '']);
  assert.equal(result.nameSpace, 'boot-env');
})();

// Copilot review (PR #2): a sheet that exists but is empty (or has a blank/malformed header
// row) must not silently accept a headerless append — seed/repair the header row first, or
// throw when data already exists under a bad header, so the "always registered or throws"
// contract in the docstring actually holds.
function fakeEmptyButExistingSheet_() {
  var data = [];
  return {
    getDataRange: function() { return { getValues: function() { return data.slice(); } }; },
    getLastRow: function() { return data.length; },
    clear: function() { data.length = 0; },
    appendRow: function(row) { data.push(row); }
  };
}

(function testAppendNamespaceRegistryRowSeedsHeaderWhenSheetExistsButEmpty() {
  var sheet = fakeEmptyButExistingSheet_();
  var registrySpreadsheet = { getSheetByName: function(name) { return name === NAMESPACE_DB_SHEET_NAME_ ? sheet : null; } };
  var result = appendNamespaceRegistryRow_(registrySpreadsheet, { nameSpace: 'empty-sheet-env', templateId: 'tmpl-empty', kind: 'smoke' });
  var written = sheet.getDataRange().getValues();
  assert.deepEqual(written[0], NAMESPACE_DB_HEADERS_, 'header row should be seeded before append');
  assert.deepEqual(written[1], ['empty-sheet-env', 'tmpl-empty', 'smoke', '', '', '', '']);
  assert.equal(result.nameSpace, 'empty-sheet-env');
})();

(function testAppendNamespaceRegistryRowThrowsWhenHeaderMalformedButDataExists() {
  var sheet = fakeEmptyButExistingSheet_();
  sheet.appendRow(['NotAHeader', 'AlsoNotAHeader']);
  sheet.appendRow(['some', 'stale-data']);
  var registrySpreadsheet = { getSheetByName: function(name) { return name === NAMESPACE_DB_SHEET_NAME_ ? sheet : null; } };
  assert.throws(function() {
    appendNamespaceRegistryRow_(registrySpreadsheet, { nameSpace: 'wont-register', templateId: 'tmpl-x' });
  }, /malformed/);
})();

function fakeMutableSheet_(headers, rows) {
  var data = [headers].concat(rows.map(function(r) { return r.slice(); }));
  return {
    getDataRange: function() { return { getValues: function() { return data.map(function(r) { return r.slice(); }); } }; },
    deleteRow: function(rowNumber) { data.splice(rowNumber - 1, 1); },
    _data: data
  };
}

// removeNamespaceRegistryRow_ is the teardown-half counterpart of appendNamespaceRegistryRow_
// (i5md.4/ADR-014 D6) — deletes only the matching NameSpace row, leaving others untouched.
(function testRemoveNamespaceRegistryRowDeletesMatchingRowOnly() {
  var sheet = fakeMutableSheet_(['NameSpace', 'TemplateId'], [['sit-env', 'tmpl-1'], ['other-env', 'tmpl-2']]);
  var registrySpreadsheet = { getSheetByName: function(name) { return name === NAMESPACE_DB_SHEET_NAME_ ? sheet : null; } };
  var removed = removeNamespaceRegistryRow_(registrySpreadsheet, 'sit-env');
  assert.equal(removed, true);
  assert.deepEqual(sheet._data, [['NameSpace', 'TemplateId'], ['other-env', 'tmpl-2']]);
})();

(function testRemoveNamespaceRegistryRowReturnsFalseWhenNsNotFound() {
  var sheet = fakeMutableSheet_(['NameSpace', 'TemplateId'], [['other-env', 'tmpl-2']]);
  var registrySpreadsheet = { getSheetByName: function(name) { return name === NAMESPACE_DB_SHEET_NAME_ ? sheet : null; } };
  var removed = removeNamespaceRegistryRow_(registrySpreadsheet, 'missing');
  assert.equal(removed, false);
  assert.deepEqual(sheet._data, [['NameSpace', 'TemplateId'], ['other-env', 'tmpl-2']]);
})();

// Never throws on missing sheet/rows — teardown must be safely retriable after a partial failure.
(function testRemoveNamespaceRegistryRowReturnsFalseWhenSheetMissing() {
  var registrySpreadsheet = { getSheetByName: function() { return null; } };
  assert.equal(removeNamespaceRegistryRow_(registrySpreadsheet, 'sit-env'), false);
})();

console.log('test_resolve_template_spreadsheet.js: PASS');
