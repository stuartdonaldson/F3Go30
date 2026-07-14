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

// In-memory stand-in for CacheService.getScriptCache() — same contract as test_dashboard_webapp.js's
// fake (put/get only, no TTL enforcement needed for these tests).
function makeFakeScriptCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
  };
}
var fakeCache_ = makeFakeScriptCache_();
global.CacheService = { getScriptCache: function() { return fakeCache_; } };

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
  findCheckinSessionByIdentity_,
  resolveOrCreateCheckinSessionGuid_,
  getCachedCheckinSessionTitle_,
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

// findCheckinSessionByIdentity_ matches on F3 Name + Email case-insensitively, prefers the most
// recent (bottom-most) matching row, and returns null on no match or a missing sheet.
{
  fakeProps = makeFakeProperties_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-old', 'Anchor', 'anchor@example.com', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'],
    ['guid-new', 'Anchor', 'anchor@example.com', '2026-06-01T00:00:00.000Z', '2026-06-10T00:00:00.000Z'],
    ['guid-ivan', 'Crazy Ivan', 'ivan@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var hit = findCheckinSessionByIdentity_(ss, '  anchor ', 'ANCHOR@example.com');
  assert.equal(hit.guid, 'guid-new', 'prefers the most recent matching session row');
  assert.equal(hit.row, 3);

  assert.equal(findCheckinSessionByIdentity_(ss, 'Anchor', 'wrong@example.com'), null, 'email must also match');
  assert.equal(findCheckinSessionByIdentity_(ss, 'Nobody', 'ivan@example.com'), null, 'f3Name must also match');
  assert.equal(findCheckinSessionByIdentity_(makeFakeSpreadsheet_(makeFakeSessionsSheet_([])), 'Anchor', 'anchor@example.com'), null);
}

// resolveOrCreateCheckinSessionGuid_ returns an existing identity's guid (and touches it), and
// on a miss logs a warning then mints + stores a fresh session, returning its guid.
{
  fakeProps = makeFakeProperties_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-existing', 'Anchor', 'anchor@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var reused = resolveOrCreateCheckinSessionGuid_(ss, 'Anchor', 'anchor@example.com');
  assert.equal(reused, 'guid-existing', 'reuses the existing session guid for a known identity');
  assert.equal(sheet._rows.length, 1, 'reuse must not append a new row');
  assert.notEqual(sheet._rows[0][4], '2026-06-01T00:00:00.000Z', 'reuse bumps Last Used At to keep the bookmark alive');

  var warnings = [];
  var savedLog = global.GasLogger.log;
  global.GasLogger.log = function(tag, data) { warnings.push({ tag: tag, data: data || {} }); };
  var minted = resolveOrCreateCheckinSessionGuid_(ss, 'Fresh Meat', 'fng@example.com');
  global.GasLogger.log = savedLog;

  assert.ok(minted, 'mints a guid on a miss');
  assert.equal(sheet._rows.length, 2, 'creates a new session row on a miss');
  assert.equal(sheet._rows[1][0], minted);
  assert.deepEqual(sheet._rows[1].slice(1, 3), ['Fresh Meat', 'fng@example.com']);
  assert.ok(
    warnings.some(function(w) { return /warn/i.test(w.data.level || '') || /warn/i.test(w.tag); }),
    'logs a warning when no existing session was found'
  );

  // Missing identity fields → no guid, no row.
  assert.equal(resolveOrCreateCheckinSessionGuid_(ss, '', 'x@example.com'), null);
  assert.equal(resolveOrCreateCheckinSessionGuid_(ss, 'X', ''), null);
  assert.equal(sheet._rows.length, 2, 'missing identity must not create a row');
}

// createOrTouchCheckinSession_ writes the guid->f3Name title cache on both the new-row and
// touch paths, and getCachedCheckinSessionTitle_ reads it back without any spreadsheet access
// at all (F3Go30-qi26.3 — this is what lets a doGet skip the CheckinSessions sheet open).
{
  fakeProps = makeFakeProperties_();
  fakeCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeCache_; } };
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);

  assert.equal(getCachedCheckinSessionTitle_('guid-cache'), null, 'nothing cached yet');

  createOrTouchCheckinSession_(ss, 'guid-cache', 'Anchor', 'anchor@example.com');
  assert.equal(getCachedCheckinSessionTitle_('guid-cache'), 'Anchor');

  // A later touch (existing row) must refresh the cache too, e.g. after a corrected/re-typed name.
  createOrTouchCheckinSession_(ss, 'guid-cache', 'Anchor Renamed', 'anchor@example.com');
  assert.equal(getCachedCheckinSessionTitle_('guid-cache'), 'Anchor Renamed');

  assert.equal(getCachedCheckinSessionTitle_(''), null, 'no guid is always a miss');
}

console.log('test_checkin_sessions.js: all assertions passed');
