const assert = require('node:assert/strict');

// In-memory stand-in for PropertiesService.getScriptProperties() — same contract as
// test_pax_cache.js's fake.
function makeFakeProperties_() {
  var store = {};
  return {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    getProperties: function() { return Object.assign({}, store); },
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

const { invalidateScriptPropertiesSnapshot_ } = require('../script/ScriptProperties.js');

// F3Go30-ptbf: _getCheckinSessionRosterIndex_ now reads through the per-execution whole-store
// memo (getScriptPropertiesSnapshot_) instead of calling PropertiesService directly (AC4) — so
// every time this file swaps in a fresh fakeProps (a new test "execution"'s empty store), the
// memo from the PREVIOUS fakeProps object must be dropped too, exactly like test_pax_cache.js
// does after a facade-bypassing write. Centralized here so every block below just calls this one
// helper instead of repeating both lines.
function resetFakeProps_() {
  fakeProps = makeFakeProperties_();
  invalidateScriptPropertiesSnapshot_();
}

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
  resolveCheckinSessionUncached_,
  resetCheckinSessionResolveMemo_,
  touchCheckinSession_,
  createOrTouchCheckinSession_,
  cleanupStaleCheckinSessions_,
  findCheckinSessionByIdentity_,
  deleteCheckinSessionsByIdentity_,
  resolveOrCreateCheckinSessionGuid_,
  listActiveCheckinSessionF3Names_,
  _getCheckinSessionRosterIndex_,
} = require('../script/CheckinSessions.js');

// resolveCheckinSession_ returns null for a guid that's never existed.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  assert.equal(resolveCheckinSession_(ss, 'nope'), null);
}

// createOrTouchCheckinSession_ creates a new row + roster index entry on first use; a second
// call for the same guid touches instead of duplicating.
{
  resetFakeProps_();
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
  resetFakeProps_();
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
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-2', 'Crazy Ivan', 'ivan@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var resolved = resolveCheckinSession_(ss, 'guid-2');
  assert.equal(resolved.f3Name, 'Crazy Ivan');
  assert.equal(resolved.row, 2);

  // Index should now be self-healed into the widened full-row shape (F3Go30-ptbf AC1/AC2) — a
  // later hit needs no sheet access at all, not just a cheaper full-scan fallback.
  var index = JSON.parse(fakeProps.getProperty('CHECKIN_SESSION_ROSTER_INDEX'));
  assert.deepEqual(index['guid-2'], {
    row: 2, f3Name: 'Crazy Ivan', email: 'ivan@example.com',
    createdAt: '2026-06-01T00:00:00.000Z', lastUsedAt: '2026-06-01T00:00:00.000Z',
  });
}

// touchCheckinSession_ bumps Last Used At without touching Created At or any other row.
{
  resetFakeProps_();
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
  resetFakeProps_();
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
  assert.deepEqual(index, {
    fresh: {
      row: 2, f3Name: 'Current', email: 'current@example.com',
      createdAt: '2026-06-01T00:00:00.000Z', lastUsedAt: '2026-07-05T00:00:00.000Z',
    },
  });
}

// findCheckinSessionByIdentity_ matches on F3 Name + Email case-insensitively, prefers the most
// recent (bottom-most) matching row, and returns null on no match or a missing sheet.
{
  resetFakeProps_();
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

// deleteCheckinSessionsByIdentity_ removes every row bound to {f3Name, email} (case-insensitive),
// leaves other identities' rows and row order untouched, rebuilds the roster index from what's
// left, and no-ops on a miss, missing sheet, or incomplete identity.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-old', 'Anchor', 'anchor@example.com', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'],
    ['guid-new', 'Anchor', 'anchor@example.com', '2026-06-01T00:00:00.000Z', '2026-06-10T00:00:00.000Z'],
    ['guid-ivan', 'Crazy Ivan', 'ivan@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var removed = deleteCheckinSessionsByIdentity_(ss, '  anchor ', 'ANCHOR@example.com');
  assert.equal(removed, 2, 'removes both of Anchor\'s rows');
  // Same clear-then-rewrite shape as cleanupStaleCheckinSessions_: the sheet keeps its old row
  // count with trailing rows blanked out, rather than physically shrinking.
  assert.equal(sheet._rows[0][0], 'guid-ivan', 'the non-matching row survives, moved to the top');
  assert.equal(sheet._rows[1][0], '', 'the rest is blanked, not left with stale data');

  var index = JSON.parse(fakeProps.getProperty('CHECKIN_SESSION_ROSTER_INDEX'));
  assert.deepEqual(index, {
    'guid-ivan': {
      row: 2, f3Name: 'Crazy Ivan', email: 'ivan@example.com',
      createdAt: '2026-06-01T00:00:00.000Z', lastUsedAt: '2026-06-01T00:00:00.000Z',
    },
  }, 'roster index rebuilt from surviving rows only');

  assert.equal(deleteCheckinSessionsByIdentity_(ss, 'Nobody', 'nobody@example.com'), 0, 'no-op on a miss');
  assert.equal(deleteCheckinSessionsByIdentity_(ss, '', 'x@example.com'), 0, 'no-op on incomplete identity');
  assert.equal(
    deleteCheckinSessionsByIdentity_(makeFakeSpreadsheet_(makeFakeSessionsSheet_([])), 'Anchor', 'anchor@example.com'),
    0, 'no-op when the sheet has no rows'
  );
}

// resolveOrCreateCheckinSessionGuid_ returns an existing identity's guid (and touches it), and
// on a miss logs a warning then mints + stores a fresh session, returning its guid.
{
  resetFakeProps_();
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

// listActiveCheckinSessionF3Names_ (F3Go30-440b.2) — normalized {name: true} set from whatever
// currently lives in the sheet; empty (never throws) when the sheet is missing/empty.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-1', 'Crazy Ivan', 'ivan@example.com', 't1', 't2'],
    ['guid-2', '  Little John  ', 'lj@example.com', 't1', 't2'], // whitespace must be normalized
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var names = listActiveCheckinSessionF3Names_(ss);
  assert.deepEqual(names, { 'crazy ivan': true, 'little john': true });

  var emptySheet = makeFakeSpreadsheet_(makeFakeSessionsSheet_([]));
  assert.deepEqual(listActiveCheckinSessionF3Names_(emptySheet), {});

  var noSheet = { getSheetByName: function() { return null; } };
  assert.deepEqual(listActiveCheckinSessionF3Names_(noSheet), {});
}

// F3Go30-ptbf AC1: a roster-index hit performs NO Sheets API access at all — the whole point of
// widening the index to store the full row, not just a row number (the old design still had to
// getSheetByName/getLastRow/getRange to learn f3Name/email on every "hit", which is why the
// measured floor was never under ~400ms).
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  createOrTouchCheckinSession_(ss, 'guid-fast', 'Speedy', 'speedy@example.com');
  resetCheckinSessionResolveMemo_(); // force a genuinely fresh resolve, not the create call's own memo

  var sheetAccessed = false;
  var spySpreadsheet = makeFakeSpreadsheet_(sheet);
  var realGetSheetByName = spySpreadsheet.getSheetByName;
  spySpreadsheet.getSheetByName = function() {
    sheetAccessed = true;
    return realGetSheetByName.apply(this, arguments);
  };

  var resolved = resolveCheckinSession_(spySpreadsheet, 'guid-fast');
  assert.equal(sheetAccessed, false, 'a roster-index hit must never call getSheetByName (or, transitively, getLastRow/getRange)');
  assert.equal(resolved.f3Name, 'Speedy');
  assert.equal(resolved.row, 2);
}

// F3Go30-ptbf AC2: a legacy-shape index entry (a bare row number, from before this widening) must
// never be trusted directly — even when it points at a row that, on the live sheet, belongs to a
// DIFFERENT guid. resolveCheckinSession_ must ignore it and fall back to a live scan, which finds
// the right row by guid and self-heals the index into the new full shape. A stale index can never
// resolve a token to the wrong PAX's identity.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-real', 'Real Deal', 'real@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);
  // Poison the index: a legacy bare-row-number entry pointing at a row that doesn't even hold
  // this guid (row 999 doesn't exist) — the old design would have blindly re-read whatever row
  // it pointed at; this design must not trust a non-object entry as a hit at all.
  fakeProps.setProperty('CHECKIN_SESSION_ROSTER_INDEX', JSON.stringify({ 'guid-real': 999 }));

  var resolved = resolveCheckinSession_(ss, 'guid-real');
  assert.ok(resolved, 'must still resolve via the live-scan fallback');
  assert.equal(resolved.f3Name, 'Real Deal');
  assert.equal(resolved.row, 2);

  var index = JSON.parse(fakeProps.getProperty('CHECKIN_SESSION_ROSTER_INDEX'));
  assert.deepEqual(index['guid-real'], {
    row: 2, f3Name: 'Real Deal', email: 'real@example.com',
    createdAt: '2026-06-01T00:00:00.000Z', lastUsedAt: '2026-06-01T00:00:00.000Z',
  }, 'self-healed into the new full-row shape');
}

// F3Go30-ptbf AC3: resolveCheckinSession_ is memoized per (spreadsheet, guid) for the lifetime of
// one execution — a second call for the same guid on the same spreadsheet object must not touch
// the sheet again.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-memo', 'Memo Test', 'memo@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);
  resetCheckinSessionResolveMemo_();

  var scanCount = 0;
  var realGetRange = sheet.getRange;
  sheet.getRange = function() { scanCount++; return realGetRange.apply(this, arguments); };

  var first = resolveCheckinSession_(ss, 'guid-memo');
  var second = resolveCheckinSession_(ss, 'guid-memo');
  sheet.getRange = realGetRange;

  assert.equal(scanCount, 1, 'the live scan must only run once — the second call is served from the per-execution memo');
  assert.equal(first.f3Name, 'Memo Test');
  assert.deepEqual(second, first);
}

// F3Go30-ptbf AC3: the in-lock re-check inside createOrTouchCheckinSession_ must see live state,
// never a memo taken before the lock — this simulates a concurrent request creating the session
// between this call's own unlocked resolve (which memoizes the miss) and the lock's re-check, and
// also proves the outer memo gets corrected afterward rather than being left at the stale miss.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  resetCheckinSessionResolveMemo_();

  // Memoize a miss for this guid, as createOrTouchCheckinSession_'s own top-of-function resolve
  // would do in the real race.
  assert.equal(resolveCheckinSession_(ss, 'guid-race'), null);

  // Simulate a concurrent request winning the race and creating the row + index entry directly.
  sheet.getRange(2, 1, 1, 5).setValues([
    ['guid-race', 'Racer', 'racer@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  fakeProps.setProperty('CHECKIN_SESSION_ROSTER_INDEX', JSON.stringify({
    'guid-race': { row: 2, f3Name: 'Racer', email: 'racer@example.com', createdAt: '2026-06-01T00:00:00.000Z', lastUsedAt: '2026-06-01T00:00:00.000Z' },
  }));
  invalidateScriptPropertiesSnapshot_(); // the direct fakeProps write above bypasses the facade

  createOrTouchCheckinSession_(ss, 'guid-race', 'Racer', 'racer@example.com');

  assert.equal(sheet._rows.filter(function(r) { return r[0]; }).length, 1, 'must not create a duplicate row for a guid a concurrent request just created');
  assert.equal(resolveCheckinSession_(ss, 'guid-race').f3Name, 'Racer', 'the outer memo must be corrected, not left at the stale pre-lock miss');
}

// F3Go30-ptbf AC4: _getCheckinSessionRosterIndex_ must read through the per-execution whole-store
// snapshot memo (getScriptPropertiesSnapshot_), not call PropertiesService directly — proven by
// writing straight to the fake store (bypassing the invalidating facade, exactly the failure mode
// AC4 guards against) and confirming a subsequent read still serves the memoized value until the
// memo is explicitly invalidated.
{
  resetFakeProps_();
  assert.deepEqual(_getCheckinSessionRosterIndex_(), {}); // warms the memo with an empty store

  fakeProps._store['CHECKIN_SESSION_ROSTER_INDEX'] = JSON.stringify({ ghost: { row: 2 } });
  assert.deepEqual(_getCheckinSessionRosterIndex_(), {}, 'a direct store write must not be visible until the memo is invalidated');

  invalidateScriptPropertiesSnapshot_();
  assert.deepEqual(_getCheckinSessionRosterIndex_(), { ghost: { row: 2 } });
}

// touchCheckinSession_ patches the roster index's cached lastUsedAt in place when given a guid
// (F3Go30-ptbf) — without this, the widened index (which now answers hits without touching the
// sheet) would go stale on the very first bookmarked revisit, and firstUse (createdAt ===
// lastUsedAt) would wrongly read true forever after.
{
  resetFakeProps_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  createOrTouchCheckinSession_(ss, 'guid-touch', 'Toucher', 'toucher@example.com');
  resetCheckinSessionResolveMemo_();

  var before = resolveCheckinSession_(ss, 'guid-touch');
  assert.equal(before.createdAt, before.lastUsedAt, 'brand new session: firstUse is true');

  resetCheckinSessionResolveMemo_();
  var forcedLastUsedAt = '2099-01-01T00:00:00.000Z'; // far from "now" so it can't collide with createdAt by timing luck
  var realDate = Date;
  global.Date = function() { return new realDate(forcedLastUsedAt); };
  global.Date.now = realDate.now;
  try {
    touchCheckinSession_(ss, before.row, 'guid-touch');
  } finally {
    global.Date = realDate;
  }
  resetCheckinSessionResolveMemo_();

  var after = resolveCheckinSession_(ss, 'guid-touch');
  assert.equal(after.lastUsedAt, forcedLastUsedAt, 'a revisit must be reflected in the roster-index hit path too, not just the sheet cell');
  assert.notEqual(after.lastUsedAt, after.createdAt);
}

console.log('test_checkin_sessions.js: all assertions passed');
