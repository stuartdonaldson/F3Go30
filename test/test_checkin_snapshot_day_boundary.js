const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-833s.17: the instant-paint snapshot (localStorage go30CheckinSnapshot:v1) used to replay
// the date-free scalars todayStatus/yesterdayStatus exactly as saved, while the TODAY/YESTERDAY
// headings are recomputed from the live client clock — so a cold launch the day after the snapshot
// was written painted YESTERDAY's status under TODAY until (or unless) the live identify landed.
// This harness extracts the REAL snapshot block (not a re-implementation) and runs it against a
// stand-in localStorage + a pinned Date, the same extraction pattern
// test_session_resume_refresh.js uses for silentResumeRefresh_.

function readStaticPage_() {
  return fs.readFileSync(path.join(__dirname, '..', 'static-pages', 'src', 'index.html'), 'utf8');
}

function extractBlock_(src, startMarker, endMarker) {
  var startIdx = src.indexOf(startMarker);
  var endIdx = src.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx,
    'snapshot block markers not found in index.html: ' + startMarker);
  return src.slice(startIdx, endIdx);
}

/** `new Date()` (no args) pins to nowIso; every other construction behaves normally, so the
 * yesterday arithmetic inside the block under test stays real. */
function makeFakeDate_(nowIso) {
  const RealDate = Date;
  function FakeDate() {
    if (arguments.length === 0) return new RealDate(nowIso + 'T12:00:00');
    return new RealDate(...arguments);
  }
  FakeDate.now = function() { return new RealDate(nowIso + 'T12:00:00').getTime(); };
  FakeDate.prototype = RealDate.prototype;
  return FakeDate;
}

function makeHarness_(opts) {
  opts = opts || {};
  var src = readStaticPage_();
  var body =
    extractBlock_(src, '  function isoDate_(d) {', '  function monthKeyOf_(d) {') +
    extractBlock_(src, '  var CHECKIN_SNAPSHOT_KEY_', '  // F3Go30-833s.1: the check-in token itself');

  var store = {};
  var fakeLocalStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; },
  };

  var factory = new Function(
    'localStorage', 'Date', 'clearTokenFromStorage_',
    body + '\nreturn { saveCheckinSnapshot_: saveCheckinSnapshot_, loadCheckinSnapshot_: loadCheckinSnapshot_, clearCheckinSnapshot_: clearCheckinSnapshot_ };'
  );
  return {
    fns: factory(fakeLocalStorage, makeFakeDate_(opts.nowIso || '2026-07-15'), function() {}),
    store: store,
    reload: function(nowIso) {
      return factory(fakeLocalStorage, makeFakeDate_(nowIso), function() {}).loadCheckinSnapshot_;
    },
  };
}

function monthGrid_(statusByIso) {
  return Object.keys(statusByIso).sort().map(function(iso) {
    return { dateIso: iso, status: statusByIso[iso] };
  });
}

function identifyResponse_(overrides) {
  return Object.assign({
    f3Name: 'Splinter', email: 'splinter@example.com', team: 'Red', monthLabel: 'July 2026',
    goals: ['30 min a day'], resolvedContext: { sheetId: 'sheet1' },
    nextMonthRegistered: null, nextMonthLabel: null,
    monthGrid: monthGrid_({ '2026-07-14': 'done', '2026-07-15': 'missed', '2026-07-16': 'pending' }),
    todayStatus: 'missed', yesterdayStatus: 'done', yesterdayAvailable: true,
    config: { siteQName: 'Turbine' },
  }, overrides || {});
}

// AC1/AC2: saved on day N, loaded on day N+1 in the same month — TODAY and YESTERDAY both come
// from the monthGrid cell for the live date, not from the scalars saved a day earlier.
(function testDayBoundaryDerivesFromMonthGrid() {
  var h = makeHarness_({ nowIso: '2026-07-15' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_());

  var loadNextDay = h.reload('2026-07-16');
  var snap = loadNextDay('tok123');

  assert.ok(snap, 'snapshot should still load the next day within the same month');
  assert.equal(snap.todayStatus, 'pending', 'TODAY must come from the 2026-07-16 cell, not the saved scalar');
  assert.equal(snap.yesterdayStatus, 'missed', 'YESTERDAY must come from the 2026-07-15 cell');
  assert.equal(snap.yesterdayAvailable, true);
  console.log('✓ day-boundary load derives today/yesterday from monthGrid');
})();

// AC3a: month boundary, SAME day — a snapshot taken on the 1st carries only THIS month's grid, so
// yesterday (the prior month's tracker, which the server resolves via resolveCheckinDayTarget_)
// has no cell. Nothing has gone stale though, and the saved scalar is the only copy of that
// cross-month value the client holds, so it must be replayed verbatim rather than dropped.
(function testMonthBoundarySameDayReplaysYesterday() {
  var h = makeHarness_({ nowIso: '2026-08-01' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_({
    monthGrid: monthGrid_({ '2026-08-01': 'pending', '2026-08-02': 'pending' }),
    todayStatus: 'pending', yesterdayStatus: 'missed', yesterdayAvailable: true,
  }));

  var snap = h.fns.loadCheckinSnapshot_('tok123');

  assert.ok(snap, 'snapshot whose grid covers the live today must still load');
  assert.equal(snap.todayStatus, 'pending');
  assert.equal(snap.yesterdayAvailable, true, 'same day — the cross-month yesterday must survive');
  assert.equal(snap.yesterdayStatus, 'missed', 'replayed verbatim: monthGrid cannot represent 2026-07-31');
  console.log('✓ month-boundary same-day load replays the cross-month YESTERDAY');
})();

// AC3b: the day HAS rolled and the grid has no cell for the live yesterday. Unreachable in normal
// operation (a snapshot only loads when its grid holds the live today, which puts the live
// yesterday in that same grid) — this is the defensive branch for a jumped device clock or a
// contextDate dev override. Hidden beats wrong.
(function testRolledDayWithoutYesterdayCellHidesBlock() {
  var h = makeHarness_({ nowIso: '2026-08-04' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_({
    monthGrid: monthGrid_({ '2026-08-05': 'pending' }),
    todayStatus: 'done', yesterdayStatus: 'missed', yesterdayAvailable: true,
  }));

  var snap = h.reload('2026-08-05')('tok123');

  assert.ok(snap, 'grid covers the live today, so it still loads');
  assert.equal(snap.todayStatus, 'pending', 'derived from the grid, not the saved scalar');
  assert.equal(snap.yesterdayAvailable, false, 'no grid cell for 2026-08-04 after a roll — hide the block');
  assert.equal(snap.yesterdayStatus, null);
  console.log('✓ rolled day without a yesterday cell hides YESTERDAY rather than replaying it');
})();

// AC4: the same-day case is unchanged — derived values equal the saved scalars.
(function testSameDayUnchanged() {
  var h = makeHarness_({ nowIso: '2026-07-15' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_());

  var snap = h.fns.loadCheckinSnapshot_('tok123');

  assert.equal(snap.todayStatus, 'missed');
  assert.equal(snap.yesterdayStatus, 'done');
  assert.equal(snap.yesterdayAvailable, true);
  assert.equal(snap.f3Name, 'Splinter', 'non-date fields still replay verbatim');
  assert.deepEqual(snap.config, { siteQName: 'Turbine' });
  console.log('✓ same-day load is unchanged');
})();

// AC5: a snapshot whose grid has no cell for the live today is still rejected outright.
(function testRejectsWhenGridMissesToday() {
  var h = makeHarness_({ nowIso: '2026-07-15' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_());

  assert.equal(h.reload('2026-08-05')('tok123'), null, 'grid has no cell for the live today');
  console.log('✓ snapshot without a cell for the live today is rejected');
})();

// Existing guards must survive the change.
(function testTokenAndTtlGuards() {
  var h = makeHarness_({ nowIso: '2026-07-15' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_());

  assert.equal(h.fns.loadCheckinSnapshot_('otherToken'), null, 'a different token must not read this snapshot');
  assert.equal(h.fns.loadCheckinSnapshot_(null), null, 'no token, no snapshot');
  assert.equal(h.reload('2026-07-16')('tok123') && true, true);

  // 14-day TTL: still inside the same month grid, but saved too long ago.
  var stale = JSON.parse(h.store['go30CheckinSnapshot:v1']);
  stale.savedAt = stale.savedAt - (15 * 24 * 60 * 60 * 1000);
  h.store['go30CheckinSnapshot:v1'] = JSON.stringify(stale);
  assert.equal(h.fns.loadCheckinSnapshot_('tok123'), null, 'snapshot older than the TTL must be rejected');
  console.log('✓ token and TTL guards still hold');
})();

(function testClearRemovesSnapshot() {
  var h = makeHarness_({ nowIso: '2026-07-15' });
  h.fns.saveCheckinSnapshot_('tok123', identifyResponse_());
  h.fns.clearCheckinSnapshot_();
  assert.equal(h.fns.loadCheckinSnapshot_('tok123'), null);
  console.log('✓ clearCheckinSnapshot_ removes the stored snapshot');
})();

console.log('All checkin snapshot day-boundary tests passed');
