const assert = require('node:assert/strict');

// In-memory stand-in for PropertiesService.getScriptProperties() — same contract as
// test_pax_cache.js's fake.
function makeFakeProperties_() {
  var store = {};
  return {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setProperty: function(key, value) { store[key] = value; },
    deleteProperty: function(key) { delete store[key]; },
    getKeys: function() { return Object.keys(store); },
    _store: store,
  };
}

var fakeProps;
global.PropertiesService = { getScriptProperties: function() { return fakeProps; } };
global.LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

// A GUID-only stand-in for Utilities.getUuid() so tests can assert on predictable values where
// needed — CheckinSessions.js itself never calls Utilities directly (callers pass their own
// guid in), so this is only here in case a future test needs it.
global.Utilities = { getUuid: function() { return 'fake-uuid-' + Math.random().toString(16).slice(2); } };

// Fake CheckinSessions sheet — same row/range contract as test_go30tools.js's
// makeFakePaxDbSheet, sized for CHECKIN_SESSIONS_HEADERS_ (5 columns).
function makeFakeSessionsSheet_(initialRows) {
  var headers = ['Session Id', 'F3 Name', 'Email', 'Created At', 'Last Used At'];
  var rows = (initialRows || []).map(function(r) { return r.slice(); });

  function rangeAt(row, col, numRows, numCols) {
    numRows = numRows || 1;
    numCols = numCols || 1;
    return {
      getValues: function() {
        var out = [];
        for (var r = 0; r < numRows; r++) {
          var rowIndex = row + r;
          var sourceRow = rowIndex === 1 ? headers : rows[rowIndex - 2];
          var slice = (sourceRow || []).slice(col - 1, col - 1 + numCols);
          while (slice.length < numCols) slice.push('');
          out.push(slice);
        }
        return out;
      },
      setValues: function(values) {
        for (var r = 0; r < values.length; r++) {
          var rowIndex = row + r;
          var target;
          if (rowIndex === 1) {
            target = headers;
          } else {
            var bodyIdx = rowIndex - 2;
            while (rows.length <= bodyIdx) rows.push(new Array(headers.length).fill(''));
            target = rows[bodyIdx];
          }
          for (var c = 0; c < values[r].length; c++) target[col - 1 + c] = values[r][c];
        }
        return this;
      },
      setValue: function(value) { return this.setValues([[value]]); },
      setFontWeight: function() { return this; },
      clearContent: function() {
        for (var i = 0; i < numRows; i++) {
          var bodyIdx = (row - 2) + i;
          if (bodyIdx >= 0 && bodyIdx < rows.length) rows[bodyIdx] = new Array(headers.length).fill('');
        }
        return this;
      },
    };
  }

  return {
    getLastRow: function() { return rows.length + 1; },
    getLastColumn: function() { return headers.length; },
    getRange: rangeAt,
    _rows: rows,
    _headers: headers,
  };
}

function makeFakeSpreadsheet_(sheet) {
  var created = null;
  return {
    getSheetByName: function(name) {
      if (name !== 'CheckinSessions') return null;
      return created || sheet || null;
    },
    insertSheet: function(name) {
      created = makeFakeSessionsSheet_([]);
      return created;
    },
  };
}

const {
  resolveCheckinSession_,
  touchCheckinSession_,
  createOrTouchCheckinSession_,
  cleanupStaleCheckinSessions_,
} = require('../script/CheckinSessions.js');

// resolveCheckinSession_ returns null for a guid that's never existed.
{
  fakeProps = makeFakeProperties_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  assert.equal(resolveCheckinSession_(ss, 'nope'), null);
}

// createOrTouchCheckinSession_ creates a new row + roster index entry on first use; a second
// call for the same guid touches instead of duplicating.
{
  fakeProps = makeFakeProperties_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);

  createOrTouchCheckinSession_(ss, 'guid-1', 'Anchor', 'anchor@example.com');
  assert.equal(sheet._rows.length, 1);
  assert.deepEqual(sheet._rows[0].slice(0, 3), ['guid-1', 'Anchor', 'anchor@example.com']);
  assert.equal(sheet._rows[0][3], sheet._rows[0][4]); // createdAt === lastUsedAt on first bind

  var resolved = resolveCheckinSession_(ss, 'guid-1');
  assert.equal(resolved.f3Name, 'Anchor');
  assert.equal(resolved.row, 2);

  createOrTouchCheckinSession_(ss, 'guid-1', 'Anchor', 'anchor@example.com');
  assert.equal(sheet._rows.length, 1, 'second call for the same guid must not duplicate the row');
}

// Legacy-token migration: createOrTouchCheckinSession_'s createdAtIsoOverride seeds Created At
// with the token's own original mint time instead of "now" — this is the entire migration path
// for a pre-rollout signed IdentityToken.js token (dashboardWebapp.js's handleCheckinIdentify_
// passes the token string itself as the guid, and its decoded mintedAtMs as this override).
{
  fakeProps = makeFakeProperties_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  var originalMintIso = '2026-05-01T00:00:00.000Z'; // a link bookmarked two months ago

  createOrTouchCheckinSession_(ss, 'legacy-token-abc', 'Old Timer', 'old@example.com', originalMintIso);
  assert.equal(sheet._rows[0][3], originalMintIso, 'Created At must reflect the original mint time, not migration time');
  assert.notEqual(sheet._rows[0][4], originalMintIso, 'Last Used At must be "now" (the migration moment)');

  // A second use (an already-migrated session) must ignore any override and just touch —
  // Created At must never change once the row exists.
  createOrTouchCheckinSession_(ss, 'legacy-token-abc', 'Old Timer', 'old@example.com', '2020-01-01T00:00:00.000Z');
  assert.equal(sheet._rows.length, 1);
  assert.equal(sheet._rows[0][3], originalMintIso, 'Created At must not be overwritten on a touch');
}

// resolveCheckinSession_ self-heals a missing/stale roster-index entry via a full scan.
{
  fakeProps = makeFakeProperties_(); // empty index, but the row already exists in the sheet
  var sheet = makeFakeSessionsSheet_([
    ['guid-2', 'Crazy Ivan', 'ivan@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var resolved = resolveCheckinSession_(ss, 'guid-2');
  assert.equal(resolved.f3Name, 'Crazy Ivan');
  assert.equal(resolved.row, 2);

  // Index should now be self-healed — a second resolve must not need the full-scan fallback.
  var index = JSON.parse(fakeProps.getProperty('CHECKIN_SESSION_ROSTER_INDEX'));
  assert.equal(index['guid-2'], 2);
}

// touchCheckinSession_ bumps Last Used At without touching Created At or any other row.
{
  fakeProps = makeFakeProperties_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-3', 'Little John', 'lj@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  touchCheckinSession_(ss, 2);
  assert.equal(sheet._rows[0][3], '2026-06-01T00:00:00.000Z', 'Created At must not change');
  assert.notEqual(sheet._rows[0][4], '2026-06-01T00:00:00.000Z', 'Last Used At must be bumped');
}

// cleanupStaleCheckinSessions_ purges a never-revisited row past the abandoned threshold and a
// long-unused row past the stale threshold, keeping a recently-used one, then rebuilds the index.
{
  fakeProps = makeFakeProperties_();
  var now = new Date('2026-07-06T00:00:00.000Z');
  var sheet = makeFakeSessionsSheet_([
    // Never revisited, 20 days old — past CHECKIN_SESSION_ABANDONED_DAYS_ (14) — purge.
    ['abandoned', 'Ghost', 'ghost@example.com', '2026-06-16T00:00:00.000Z', '2026-06-16T00:00:00.000Z'],
    // Revisited, but not for 70 days — past CHECKIN_SESSION_STALE_DAYS_ (60) — purge.
    ['stale', 'OldTimer', 'old@example.com', '2026-01-01T00:00:00.000Z', '2026-04-27T00:00:00.000Z'],
    // Used yesterday — keep.
    ['fresh', 'Current', 'current@example.com', '2026-06-01T00:00:00.000Z', '2026-07-05T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);
  global.SpreadsheetApp = { getActiveSpreadsheet: function() { return ss; } };

  var result = cleanupStaleCheckinSessions_(now);
  assert.deepEqual(result, { checked: 3, purged: 2, kept: 1 });
  assert.equal(sheet._rows.filter(function(r) { return r[0]; }).length, 1);
  assert.equal(sheet._rows[0][0], 'fresh');

  var index = JSON.parse(fakeProps.getProperty('CHECKIN_SESSION_ROSTER_INDEX'));
  assert.deepEqual(index, { fresh: 2 });
}

console.log('test_checkin_sessions.js: all assertions passed');
