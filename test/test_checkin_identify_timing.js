const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

// F3Go30-276s: checkinWebapp.identify.result's child timers (resolveMonths, resolveIdentity,
// buildMonthNavigationPayload) accounted for only ~58% of the parent's durationMs on PROD.
// Instrumentation-only fix (no behaviour change, no optimisation): handleCheckinIdentify_
// (script/dashboardWebapp.js) now also times the token-resolution step, the block between
// identity resolution and buildMonthNavigationPayload_dw_ (resolveCheckinDayTarget_'s yesterday
// lookup, checkNextMonthRegistration_, resolveSignupReminder_dw_), and the CheckinSessions
// write — closing the unattributed gap for the matched-identity path.
//
// This test proves the new spans actually fire, with correct field shapes, on a fully matched
// identify() call — the case the PROD numbers in the bead were measured against.

var fakeScriptCache_ = (function() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
  };
})();
global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

var loggedEvents_ = [];
global.GasLogger = {
  log: function(name, payload) { loggedEvents_.push({ name: name, payload: payload }); },
  logError: function() {},
  run: function(name, fn) { return fn(); },
};

var fakeProps_ = {};
global.PropertiesService = {
  getScriptProperties: function() {
    return {
      getProperty: function(k) { return Object.prototype.hasOwnProperty.call(fakeProps_, k) ? fakeProps_[k] : null; },
      setProperty: function(k, v) { fakeProps_[k] = String(v); },
      deleteProperty: function(k) { delete fakeProps_[k]; },
      getProperties: function() { return Object.assign({}, fakeProps_); },
      getKeys: function() { return Object.keys(fakeProps_); },
      setProperties: function(batch) { Object.keys(batch).forEach(function(k) { fakeProps_[k] = String(batch[k]); }); },
    };
  },
};
require('../script/ScriptProperties.js').resetScriptPropertiesSnapshot_();

global.LockService = {
  getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; },
};

// Pinned "today" — the fixture's Tracker only has July day columns, and pinning avoids this
// test's next-month nudge logic (checkNextMonthRegistration_/resolveSignupReminder_dw_) ever
// reaching a real SpreadsheetApp.openById call keyed off the actual system date.
global.resolveContextDate_ = function(spreadsheet, contextDateOverride) {
  return contextDateOverride ? new Date(contextDateOverride) : new Date(2026, 6, 15, 9, 0);
};

const { handleCheckinIdentify_ } = require('../script/dashboardWebapp.js');

// ── Fixture ──────────────────────────────────────────────────────────────────────────────────
// TrackerDB: July only (no next month), so checkNextMonthRegistration_/resolveSignupReminder_dw_
// both short-circuit on `!months.next` without opening a second spreadsheet — keeps this test
// about identify's OWN unattributed time, not the separately-flagged duplicate-open issue.
var LINKS_HEADERS = ['Date Modified', 'StartDate', 'SpreadsheetName', 'TrackerURL', 'SheetId'];
function linksRow(sheetId, startDate) {
  var row = new Array(LINKS_HEADERS.length).fill('');
  row[LINKS_HEADERS.indexOf('StartDate')] = startDate;
  row[LINKS_HEADERS.indexOf('SheetId')] = sheetId;
  row[LINKS_HEADERS.indexOf('TrackerURL')] = 'https://x/' + sheetId;
  return row;
}
function makeFakeDataRangeSheet(rows) {
  return { getDataRange: function() { return { getValues: function() { return rows; } }; } };
}

var RESPONSES_HEADERS = [
  'Timestamp', 'Email Address', 'Are you currently participating in Go30?', 'F3 Name',
  'Team type', 'Team', 'Goal or other team name', 'WHO do you ultimately want to become?',
  'WHAT is your Go30 Challenge?', 'HOW are you going to be successful this month?',
  'Cell Phone Number', 'NAG email?', 'Constructive Comments',
];
function responsesRow(f3Name, email) {
  var row = new Array(RESPONSES_HEADERS.length).fill('');
  row[RESPONSES_HEADERS.indexOf('Email Address')] = email;
  row[RESPONSES_HEADERS.indexOf('Are you currently participating in Go30?')] = 'Yes';
  row[RESPONSES_HEADERS.indexOf('F3 Name')] = f3Name;
  row[RESPONSES_HEADERS.indexOf('Team')] = 'Crucible';
  row[RESPONSES_HEADERS.indexOf('WHO do you ultimately want to become?')] = 'w';
  row[RESPONSES_HEADERS.indexOf('WHAT is your Go30 Challenge?')] = 'wh';
  row[RESPONSES_HEADERS.indexOf('HOW are you going to be successful this month?')] = 'ho';
  return row;
}
function makeFakeResponsesSheet(dataRows) {
  var rows = [RESPONSES_HEADERS].concat(dataRows);
  return {
    getLastRow: function() { return rows.length; },
    getLastColumn: function() { return RESPONSES_HEADERS.length; },
    getRange: function(row, col, numRows) {
      return { getValues: function() { return rows.slice(row - 1, row - 1 + (numRows || 1)); } };
    },
  };
}
function makeFakeTrackerSheet(row2, row3, paxRows) {
  var width = [row2, row3].concat(paxRows).reduce(function(m, r) { return Math.max(m, r.length); }, 0);
  return {
    getLastRow: function() { return 3 + paxRows.length; },
    getLastColumn: function() { return width; },
    getRange: function(row, col, numRows) {
      return {
        getValues: function() {
          if (row === 2) return [row2.slice()];
          if (row === 3) return [row3.slice()];
          var out = [];
          for (var i = 0; i < (numRows || 1); i++) out.push((paxRows[row - 4 + i] || []).slice());
          return out;
        },
        setValue: function() {},
        clearContent: function() {},
      };
    },
  };
}

// Minimal in-sheet-order-preserving CheckinSessions fixture, so createOrTouchCheckinSession_
// (CheckinSessions.js) hits a real (already-provisioned) sheet rather than needing insertSheet.
function makeFakeCheckinSessionsSheet() {
  var headers = ['Session Id', 'F3 Name', 'Email', 'Created At', 'Last Used At'];
  var rows = [];
  return {
    getLastRow: function() { return 1 + rows.length; },
    getRange: function(row, col, numRows) {
      return {
        getValues: function() {
          if (row === 1) return [headers.slice()];
          var out = [];
          for (var i = 0; i < (numRows || 1); i++) out.push((rows[row - 2 + i] || []).slice());
          return out;
        },
        setValues: function(values) {
          if (row === 1) return { setFontWeight: function() {} };
          rows[row - 2] = values[0];
          return { setFontWeight: function() {} };
        },
        setValue: function(v) { if (rows[row - 2]) rows[row - 2][col - 1] = v; },
      };
    },
  };
}

function buildFixture() {
  var trackerDbSheet = makeFakeDataRangeSheet([LINKS_HEADERS, linksRow('sheet-jul', new Date(2026, 6, 1))]);
  var paxDbSheet = makeFakeDataRangeSheet([['F3 Name', 'Email', 'SheetId', 'Team', 'WHO', 'WHAT', 'HOW', 'Team Type', 'Other Team', 'Phone', 'NAG Email']]);
  var checkinSessionsSheet = makeFakeCheckinSessionsSheet();
  var templateSpreadsheet = {
    getSheetByName: function(name) {
      if (name === 'TrackerDB') return trackerDbSheet;
      if (name === 'PaxDB') return paxDbSheet;
      if (name === 'CheckinSessions') return checkinSessionsSheet;
      return null;
    },
  };

  var row2 = ['', '', '', '', '', '', '', '', '', ''];
  var row3 = ['F3 Name', 'Goal / Team', '', '', '', '', 'Raw Score', 'Score', new Date(2026, 6, 14), new Date(2026, 6, 15)];
  var paxRows = [
    ['Anchor', 'Crucible', '', '', '', '', 5, 0.5, 1, ''], // Jul14 checked in, Jul15 (today) pending
  ];
  var julSpreadsheet = {
    getSheetByName: function(name) {
      if (name === 'Tracker') return makeFakeTrackerSheet(row2, row3, paxRows);
      if (name === 'Responses') return makeFakeResponsesSheet([responsesRow('Anchor', 'anchor@example.com')]);
      return null;
    },
  };

  global.SpreadsheetApp = {
    openById: function(id) {
      if (id === 'sheet-jul') return julSpreadsheet;
      throw new Error('unexpected openById: ' + id);
    },
    flush: function() {},
  };

  return templateSpreadsheet;
}

describe('F3Go30-276s: handleCheckinIdentify_ timing coverage', function() {
  it('logs tokenResolve, postIdentityPrep and checkinSession spans on a matched identify with a session guid', function() {
    var templateSpreadsheet = buildFixture();
    loggedEvents_ = [];

    var res = handleCheckinIdentify_(templateSpreadsheet, {
      f3Name: 'Anchor', email: 'anchor@example.com', guid: 'test-guid-1',
    });

    assert.equal(res.ok, true);
    assert.equal(res.matched, true, 'fixture must resolve to a matched identity for this test to be meaningful');

    var byName = {};
    loggedEvents_.forEach(function(e) { (byName[e.name] = byName[e.name] || []).push(e.payload); });

    assert.ok(byName['checkinWebapp.resolveMonths.timing'], 'resolveMonths.timing must still fire');
    assert.ok(byName['checkinWebapp.resolveIdentity.timing'], 'resolveIdentity.timing must still fire');
    assert.ok(byName['checkinWebapp.buildMonthNavigationPayload.timing'], 'buildMonthNavigationPayload.timing must still fire');

    var postIdentityPrep = byName['checkinWebapp.postIdentityPrep.timing'];
    assert.ok(postIdentityPrep, 'checkinWebapp.postIdentityPrep.timing must be logged (new span)');
    assert.equal(typeof postIdentityPrep[0].durationMs, 'number');
    assert.ok(postIdentityPrep[0].durationMs >= 0);
    assert.equal(postIdentityPrep[0].hasNextMonth, false);

    var checkinSession = byName['checkinWebapp.checkinSession.timing'];
    assert.ok(checkinSession, 'checkinWebapp.checkinSession.timing must be logged when a sessionGuid is present (new span)');
    assert.equal(typeof checkinSession[0].durationMs, 'number');
    assert.ok(checkinSession[0].durationMs >= 0);

    // No payload.token on this call, so tokenResolve.timing must NOT fire — it's scoped to the
    // saved-link/bookmark path only.
    assert.equal(byName['checkinWebapp.tokenResolve.timing'], undefined);

    // AC3: no request/response shape change — the matched-identity response shape is unchanged.
    assert.equal(res.f3Name, 'Anchor');
    assert.equal(res.team, 'Crucible');
    assert.equal(typeof res.monthGrid, 'object');

    // AC1 spirit: every span this identify() call can log is now covered by SOME timing event —
    // resolveMonths + resolveIdentity + buildMonthNavigationPayload (pre-existing) plus
    // postIdentityPrep + checkinSession (new). This fixture is in-memory (all fake-sheet reads
    // resolve in <1ms), so exact percentage-of-durationMs isn't meaningful here — see AC4, which
    // is explicitly deferred to a real post-deploy PROD measurement. What this test CAN prove is
    // that no phase of the matched-identity path runs with no span at all.
    var timingEventNames = Object.keys(byName).filter(function(n) { return /\.timing$/.test(n); });
    assert.deepEqual(
      timingEventNames.sort(),
      [
        'checkinWebapp.buildMonthNavigationPayload.timing',
        'checkinWebapp.checkinSession.timing',
        'checkinWebapp.postIdentityPrep.timing',
        'checkinWebapp.resolveIdentity.timing',
        'checkinWebapp.resolveMonths.timing',
      ].sort()
    );
  });

  it('skips checkinSession.timing when there is no sessionGuid (no token, no guid)', function() {
    var templateSpreadsheet = buildFixture();
    loggedEvents_ = [];

    var res = handleCheckinIdentify_(templateSpreadsheet, { f3Name: 'Anchor', email: 'anchor@example.com' });
    assert.equal(res.matched, true);

    var names = loggedEvents_.map(function(e) { return e.name; });
    assert.ok(names.indexOf('checkinWebapp.checkinSession.timing') === -1);
  });
});
