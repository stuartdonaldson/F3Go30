const assert = require('node:assert/strict');

// F3Go30-1pqo.2: handleCheckinLogout_ (script/dashboardWebapp.js) — the server-side half of
// Logout. Coverage inventory (test-functional Step 1): deleteCheckinSessionsByIdentity_ itself
// (the primitive this handler calls) is already fully covered by test_checkin_sessions.js —
// removal scope, no-op-on-miss, roster-index rebuild. Nothing existing covers the NEW surface
// this bead adds: the webapp entry point that authenticates a logout request BY TOKEN (never by
// a client-supplied name) and wires it to that primitive. This file is that new coverage.
//
// Same fixture shapes as test_checkin_sessions.js (fake PropertiesService + CheckinSessions
// sheet) plus the minimal global surface test_dashboard_webapp.js installs before requiring
// dashboardWebapp.js (CacheService/GasLogger/LockService/resolveContextDate_) — dashboardWebapp.js
// pulls in several gasRequire_'d sibling modules that need those globals to exist, even though
// this file only exercises handleCheckinLogout_ itself.

function makeFakeScriptCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
    _store: store,
  };
}
global.CacheService = { getScriptCache: function() { return makeFakeScriptCache_(); } };

var loggedEvents_ = [];
global.GasLogger = {
  log: function(tag, data) { loggedEvents_.push({ tag: tag, data: data || {} }); },
  logError: function() {},
  run: function(name, fn) { return fn(); },
};

function makeFakeProperties_() {
  var store = {};
  return {
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setProperty: function(key, value) { store[key] = String(value); },
    setProperties: function(batch) { Object.keys(batch || {}).forEach(function(k) { store[k] = String(batch[k]); }); },
    deleteProperty: function(key) { delete store[key]; },
    deleteAllProperties: function() { Object.keys(store).forEach(function(k) { delete store[k]; }); },
    getKeys: function() { return Object.keys(store); },
    getProperties: function() { return Object.assign({}, store); },
    _store: store,
  };
}
var fakeProps_;
global.PropertiesService = { getScriptProperties: function() { return fakeProps_; } };
global.LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
global.resolveContextDate_ = function() { return new Date(); };
global.Utilities = { getUuid: function() { return 'fake-uuid-' + Math.random().toString(16).slice(2); } };

const { handleCheckinLogout_ } = require('../script/dashboardWebapp.js');
const { createOrTouchCheckinSession_, resolveCheckinSession_ } = require('../script/CheckinSessions.js');

// Same fake CheckinSessions sheet/spreadsheet shape as test_checkin_sessions.js.
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
    insertSheet: function() {
      created = makeFakeSessionsSheet_([]);
      return created;
    },
  };
}

function freshExecution_() {
  fakeProps_ = makeFakeProperties_();
  loggedEvents_.length = 0;
  require('../script/ScriptProperties.js').resetScriptPropertiesSnapshot_();
}

// A valid token resolves to a live session, that identity's session row(s) are removed, and the
// success is reported {ok:true, loggedOut:true} plus one Axiom event naming the outcome.
(function testLogoutWithValidTokenRemovesSessionAndReports() {
  freshExecution_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  createOrTouchCheckinSession_(ss, 'guid-anchor', 'Anchor', 'anchor@example.com');
  assert.ok(resolveCheckinSession_(ss, 'guid-anchor'), 'sanity: session exists before logout');

  var res = handleCheckinLogout_(ss, { token: 'guid-anchor' });

  assert.deepEqual(res, { ok: true, loggedOut: true });
  assert.equal(resolveCheckinSession_(ss, 'guid-anchor'), null, 'the token must no longer resolve to an identity');
  var resultEvent = loggedEvents_.find(function(e) { return e.tag === 'checkinWebapp.logout.result'; });
  assert.ok(resultEvent, 'must log a checkinWebapp.logout.result event');
  assert.equal(resultEvent.data.matched, true);
  assert.equal(resultEvent.data.removed, 1);
  assert.equal(resultEvent.data.f3Name, 'Anchor');
})();

// A missing/unknown/already-invalid token is not an error: nothing to invalidate, reported
// {ok:true, loggedOut:false}, no PaxCache/spreadsheet mutation attempted.
(function testLogoutWithUnknownOrMissingTokenIsANoOp() {
  freshExecution_();
  var sheet = makeFakeSessionsSheet_([
    ['guid-other', 'Someone Else', 'else@example.com', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
  ]);
  var ss = makeFakeSpreadsheet_(sheet);

  var resUnknown = handleCheckinLogout_(ss, { token: 'never-issued' });
  assert.deepEqual(resUnknown, { ok: true, loggedOut: false });

  var resMissing = handleCheckinLogout_(ss, {});
  assert.deepEqual(resMissing, { ok: true, loggedOut: false });

  // Unrelated identity's session must be untouched by either no-op call.
  assert.ok(resolveCheckinSession_(ss, 'guid-other'), 'an unrelated session must survive a miss/no-token logout call');
})();

// SECURITY (the bead's core AC): a client-supplied f3Name/email in the payload must be IGNORED —
// only the identity the token itself resolves to may ever be logged out. This is what stops one
// PAX's device from being able to sign another PAX out by guessing/typing their name.
(function testLogoutIgnoresClientSuppliedIdentityFields() {
  freshExecution_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  createOrTouchCheckinSession_(ss, 'guid-victim', 'Victim', 'victim@example.com');
  createOrTouchCheckinSession_(ss, 'guid-attacker', 'Attacker', 'attacker@example.com');

  // Attacker's own token, but claims to be "Victim" in the payload — must only ever invalidate
  // the attacker's OWN session (the one their real token resolves to), never Victim's.
  var res = handleCheckinLogout_(ss, { token: 'guid-attacker', f3Name: 'Victim', email: 'victim@example.com' });

  assert.deepEqual(res, { ok: true, loggedOut: true });
  assert.equal(resolveCheckinSession_(ss, 'guid-attacker'), null, 'the caller\'s own session is invalidated');
  assert.ok(resolveCheckinSession_(ss, 'guid-victim'), 'a session for a name spoofed in the payload must NOT be touched');
})();

// No raw email ever reaches the logged event (maskRecipientListForLog_ convention referenced by
// this bead) — only f3Name, matching deleteCheckinSessionsByIdentity_'s own existing log call.
(function testLogoutNeverLogsRawEmail() {
  freshExecution_();
  var sheet = makeFakeSessionsSheet_([]);
  var ss = makeFakeSpreadsheet_(sheet);
  createOrTouchCheckinSession_(ss, 'guid-priv', 'Private Pax', 'private-pax@example.com');

  handleCheckinLogout_(ss, { token: 'guid-priv' });

  loggedEvents_.forEach(function(e) {
    var serialized = JSON.stringify(e.data);
    assert.ok(serialized.indexOf('private-pax@example.com') === -1,
      'event ' + e.tag + ' must never carry a raw email address');
  });
})();

console.log('test_checkin_logout.js: all assertions passed');
