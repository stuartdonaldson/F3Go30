const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-os03: consolidates the client's split board state (state.monthCache, state.calGridCache,
// the state.monthGrid alias, state.locallyWrittenIso's permanent overlay) into one state.board
// store, one value->status converter, and a generation-ordered write overlay. This file covers
// the acceptance criteria that need REAL extracted source executed against fakes (the same
// pattern test_dashboard_stale_while_revalidate.js/test_static_page_client_invariants.js's cal-nav
// suite use) — static-shape assertions belong in test_checkin_monthcache_invalidation.js and
// test_static_page_client_invariants.js (both already updated for the state.board rename).

function boardHelpersSrc_(src) {
  return [
    extractFunction_(src, 'valueToStatus_'),
    extractFunction_(src, 'statusToValue_'),
    extractFunction_(src, 'patchBoardDayFacts_'),
    extractFunction_(src, 'boardMonthGrid_'),
  ].join('\n');
}

// ── A4: exactly one value<->status converter, total over 1/0/null/-1 ───────────────────────────

(function testExactlyOneValueStatusConverterExistsAndIsTotal() {
  var src = readStaticPage_();
  assert.doesNotMatch(src, /function valueToCheckinStatus_/, 'valueToCheckinStatus_ must no longer exist — collapsed into valueToStatus_ (D2)');
  assert.doesNotMatch(src, /function valueToMonthGridStatus_/, 'valueToMonthGridStatus_ must no longer exist — collapsed into valueToStatus_ (D2)');
  var fn = new Function(boardHelpersSrc_(src) + '\nreturn valueToStatus_;')();
  assert.equal(fn(1), 'done');
  assert.equal(fn(0), 'missed');
  assert.equal(fn(-1), 'absent');
  assert.equal(fn(null), 'pending');
  assert.equal(fn(undefined), 'pending');
})();

// ── D1/D3: patchBoardDayFacts_/boardMonthGrid_ round-trip the string<->numeric vocabularies ─────

(function testPatchBoardDayFactsAndBoardMonthGridRoundTrip() {
  var src = readStaticPage_();
  var state = { board: {} };
  var fns = new Function('state', boardHelpersSrc_(src) +
    '\nreturn { patchBoardDayFacts_: patchBoardDayFacts_, boardMonthGrid_: boardMonthGrid_ };'
  )(state);

  fns.patchBoardDayFacts_('2026-08', [
    { dateIso: '2026-08-01', status: 'done' },
    { dateIso: '2026-08-02', status: 'missed' },
    { dateIso: '2026-08-03', status: 'pending' },
    { dateIso: '2026-08-04', status: 'absent' },
  ]);
  assert.deepEqual(state.board['2026-08'].dayValues, [1, 0, null, -1], 'day facts must be stored in the numeric vocabulary (D2)');
  assert.deepEqual(fns.boardMonthGrid_('2026-08'), [
    { dateIso: '2026-08-01', status: 'done' },
    { dateIso: '2026-08-02', status: 'missed' },
    { dateIso: '2026-08-03', status: 'pending' },
    { dateIso: '2026-08-04', status: 'absent' },
  ]);
  assert.deepEqual(fns.boardMonthGrid_('2026-09'), [], 'a monthKey with no board record is a miss, not a cached empty');
})();

(function testPatchBoardDayFactsNeverClobbersDashboardOnlyFields() {
  var src = readStaticPage_();
  var state = { board: { '2026-08': { monthKey: '2026-08', score: 12, streak: 3, myTeam: [{ name: 'X' }] } } };
  var fns = new Function('state', boardHelpersSrc_(src) + '\nreturn { patchBoardDayFacts_: patchBoardDayFacts_ };')(state);
  fns.patchBoardDayFacts_('2026-08', [{ dateIso: '2026-08-01', status: 'done' }]);
  assert.equal(state.board['2026-08'].score, 12, 'a day-facts-only patch must not erase dashboard-only fields already populated (invariant 8)');
  assert.equal(state.board['2026-08'].streak, 3);
  assert.deepEqual(state.board['2026-08'].myTeam, [{ name: 'X' }]);
})();

// ── A1 (CORRECTION 2 / P1): a write made while the calendar is parked on a DIFFERENT month is ──
//    reflected when the PAX pages back to the written date's month. Repro from the DESIGN field:
//    open the calendar, page back a month, close it, tap Yes for today, reopen and page forward.
//    Exercises the REAL applyOwnDayWrite_/patchOwnDayIntoPayload_ (the write path) together with
//    loadCalMonth_'s cache-hit branch (the read path) — the P1 bug was that these used to go
//    through two different, unmerged stores (state.monthCache vs. the state.monthGrid alias into
//    state.calGridCache), so a write to one never reached the other unless the aliased month
//    happened to match by luck.

function makeBoardWriteAndCalNavHarness_(state, callApiImpl) {
  var elements = {};
  function fakeEl_(id) {
    if (!elements[id]) {
      var classes = {};
      elements[id] = {
        disabled: false, textContent: '', innerHTML: '',
        classList: {
          add: function(c) { classes[c] = true; },
          remove: function(c) { delete classes[c]; },
          has: function(c) { return !!classes[c]; },
          contains: function(c) { return !!classes[c]; },
        },
        querySelector: function() { return null; },
      };
    }
    return elements[id];
  }
  var src = readStaticPage_();
  var body = boardHelpersSrc_(src) + '\n' +
    extractFunction_(src, 'monthKeyOf_') + '\n' +
    extractFunction_(src, 'parseIsoDate_') + '\n' +
    extractFunction_(src, 'invalidateMonthCacheFor_') + '\n' +
    extractFunction_(src, 'patchOwnDayIntoPayload_') + '\n' +
    extractFunction_(src, 'applyOwnDayWrite_') + '\n' +
    (function() {
      var startMarker = '// ── Step: checkin — Month-to-month navigation (F3Go30-k5fn.2) ──────────';
      var endMarker = "$('calPrevMonthBtn').addEventListener";
      var startIdx = src.indexOf(startMarker);
      var endIdx = src.indexOf(endMarker);
      assert.ok(startIdx !== -1 && endIdx !== -1, 'cal-nav block markers not found in index.html');
      return src.slice(startIdx, endIdx);
    })();
  var factory = new Function('state', '$', 'callApi', 'hideApiError_', 'renderCalendar_', 'renderSelectionPanel_', 'showApiError_',
    body + '\nreturn { applyOwnDayWrite_: applyOwnDayWrite_, loadCalMonth_: loadCalMonth_ };'
  );
  var fns = factory(
    state, fakeEl_,
    callApiImpl || function() { throw new Error('callApi should not have been called — the written month must already be cache-hit'); },
    function() {}, function() {}, function() {},
    function(action, err) { throw err; }
  );
  return { fns: fns, elements: elements };
}

(function testWriteMadeWhileCalendarParkedOnAnotherMonthIsReflectedOnPagingBack() {
  var state = {
    board: {},
    registeredMonthKeys: ['2026-07', '2026-08'],
    todayIso: '2026-08-15',
    selectedDateIso: null,
    calMonthKey: '2026-07', // parked on a DIFFERENT (previous) month, as if the PAX paged back then closed the calendar
    monthGrid: [],
    pendingSelfWrites: {},
  };
  var h = makeBoardWriteAndCalNavHarness_(state);

  // Seed both months' board records exactly as identify/loadCalMonth_ would have (full day-value
  // grids), so this test isolates the write-then-page-back regression, not a cache-miss.
  h.fns.applyOwnDayWrite_; // no-op reference to satisfy lint-style "used" — real call below
  var src = readStaticPage_();
  var seed = new Function('state', boardHelpersSrc_(src) + '\nreturn patchBoardDayFacts_;')(state);
  seed('2026-07', [{ dateIso: '2026-07-15', status: 'pending' }]);
  seed('2026-08', [
    { dateIso: '2026-08-14', status: 'pending' },
    { dateIso: '2026-08-15', status: 'pending' },
    { dateIso: '2026-08-16', status: 'pending' },
  ]);

  // Tap "Yes" for today (2026-08-15) while calMonthKey is still parked on 2026-07 (calendar closed).
  h.fns.applyOwnDayWrite_('2026-08-15', 1);

  // The write must have landed in AUGUST's board record regardless of what's parked — this is the
  // actual P1 fix (D3: applyOwnDayWrite_ always targets monthKeyOf_(dateIso), never whatever
  // state.monthGrid/state.calMonthKey happens to be aliased to).
  assert.equal(state.board['2026-08'].dayValues[state.board['2026-08'].dayDates.indexOf('2026-08-15')], 1,
    'the write must patch state.board for the WRITTEN date\'s month, not the parked month');

  // Reopen the calendar and page forward to August — must be a cache HIT (board already has full
  // day facts for 2026-08), so no monthGrid RPC, and the derived grid must show the write.
  return h.fns.loadCalMonth_('2026-08').then(function() {
    assert.deepEqual(state.monthGrid, [
      { dateIso: '2026-08-14', status: 'pending' },
      { dateIso: '2026-08-15', status: 'done' },
      { dateIso: '2026-08-16', status: 'pending' },
    ], 'paging forward to the written month must show the write — this is the A1/CORRECTION 2 scenario');
  });
})();

// ── A5: a re-identify as a DIFFERENT PAX in the same pageview leaks no prior write state ───────
//    (D6) — static-shape check that the !opts.preserveView reset resets state.board AND every
//    piece of write-tracking state on the SAME branch (applyIdentifySuccess_ itself is not
//    extracted/executed here — it reaches too many DOM/history/location globals for a narrow unit
//    test to be worth the mock surface; every other test in this suite that touches it follows the
//    same precedent, see test_session_resume_refresh.js's fully-faked applyIdentifySuccess_).

(function testFreshIdentifyResetsBoardAndAllWriteTrackingStateOnTheSameBranch() {
  var src = readStaticPage_();
  var fnMatch = src.match(/function applyIdentifySuccess_\([\s\S]*?\n  \}\n\n  \/\*\* Applies a resolved typed-identify/);
  assert.ok(fnMatch, 'applyIdentifySuccess_ not found in index.html');
  var body = fnMatch[0];
  var resetBlockMatch = body.match(/if \(!opts\.preserveView\) \{[\s\S]*?\n    \}\n    updateHeaderIdentity_/);
  assert.ok(resetBlockMatch, 'applyIdentifySuccess_\'s !opts.preserveView reset block not found');
  var resetBlock = resetBlockMatch[0];
  assert.match(resetBlock, /state\.board = \{\}/, 'a fresh identify must reset state.board');
  assert.match(resetBlock, /state\.pendingSelfWrites = \{\}/, 'a fresh identify must reset state.pendingSelfWrites (D6)');
  assert.match(resetBlock, /state\.locallyWrittenIso = \{\}/, 'a fresh identify must reset state.locallyWrittenIso (D6)');
  assert.match(resetBlock, /state\.writeGenByIso_ = \{\}/, 'a fresh identify must reset state.writeGenByIso_ (D6)');
})();

// ── A7/A8/A9/A10: generation-ordered overlay expiry (D5, Addendum 2-3, Finding A) ───────────────

function makeReconcileHarness_() {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'reconcileWithLocalWrites_');
  var factory = new Function('state', 'isoDate_', body + '\nreturn reconcileWithLocalWrites_;');
  return factory;
}

(function testA10OverlayExpiryUsesAMonotonicCounterNotDateNow() {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'reconcileWithLocalWrites_');
  assert.doesNotMatch(body, /Date\.now\(\)/, 'reconcileWithLocalWrites_ must compare requestGen_ generations, not Date.now() (Addendum 3 — a wall clock is not monotonic)');
  assert.match(body, /writeGen\b.*issuedGen|issuedGen.*writeGen\b/, 'reconcileWithLocalWrites_ must compare a write\'s generation against the read\'s issuedGen');
})();

// A8 (both directions) + A7's repro: an unacked write always outranks a stale response; an ACKED
// write is dropped only once a read issued AFTER the ack lands — never by a read issued before it
// (the T0/T1/T3/T4 race D5's docstring warns "clear on ack alone" would reintroduce).
(function testA7A8UnackedWriteAlwaysWinsAckedWriteWinsOnlyAgainstAResponseIssuedBeforeIt() {
  var reconcileFactory = makeReconcileHarness_();
  var isoDate_ = function(d) { return d.toISOString().slice(0, 10); };

  // Case 1: unacked write (no writeGenByIso_ entry at all) — must survive regardless of issuedGen.
  var state1 = {
    locallyWrittenIso: { '2026-08-15': 'done' },
    writeGenByIso_: {},
    todayIso: '2026-08-15', yesterdayIso: '2026-08-14',
  };
  var reconcile1 = reconcileFactory(state1, isoDate_);
  var res1 = { monthGrid: [{ dateIso: '2026-08-15', status: 'missed' }], todayStatus: 'missed' };
  reconcile1(res1, /* issuedGen */ 5);
  assert.equal(res1.todayStatus, 'done', 'an unacked write must win over a response issued at any generation');
  assert.equal(res1.monthGrid[0].status, 'done');
  assert.ok(Object.prototype.hasOwnProperty.call(state1.locallyWrittenIso, '2026-08-15'), 'an unacked overlay entry must not be dropped');

  // Case 2 (T0/T1/T3/T4 race, D5's docstring): the write acked at generation 1 (no read had been
  // issued between the read at T0 and the ack at T3), and T0's OWN read — issued at generation 1
  // — is the one now landing. "Clear on ack" would have already deleted the overlay by now and
  // let this stale response clobber the write; the generation comparison must not.
  var state2 = {
    locallyWrittenIso: { '2026-08-15': 'done' },
    writeGenByIso_: { '2026-08-15': 1 },
    todayIso: '2026-08-15', yesterdayIso: '2026-08-14',
  };
  var reconcile2 = reconcileFactory(state2, isoDate_);
  var res2 = { monthGrid: [{ dateIso: '2026-08-15', status: 'pending' }], todayStatus: 'pending' };
  reconcile2(res2, /* issuedGen */ 1); // T0's own read — issued at the SAME generation as the ack
  assert.equal(res2.todayStatus, 'done', 'a response whose read predates (or is concurrent with) the ack must not clobber the write');
  assert.ok(Object.prototype.hasOwnProperty.call(state2.locallyWrittenIso, '2026-08-15'), 'the overlay must survive a same-generation read');

  // Case 3 (Finding A's actual cross-device repro): the write acked at generation 1, and a LATER
  // read (e.g. a resumed PWA's silentResumeRefresh_) is issued at generation 2, strictly after the
  // ack. F3Go30-xg8f already guarantees that response reflects the write (or, cross-device, a
  // newer server truth) — the overlay must step aside.
  var state3 = {
    locallyWrittenIso: { '2026-08-15': 'done' },
    writeGenByIso_: { '2026-08-15': 1 },
    todayIso: '2026-08-15', yesterdayIso: '2026-08-14',
  };
  var reconcile3 = reconcileFactory(state3, isoDate_);
  var res3 = { monthGrid: [{ dateIso: '2026-08-15', status: 'missed' }], todayStatus: 'missed' };
  reconcile3(res3, /* issuedGen */ 2);
  assert.equal(res3.todayStatus, 'missed', 'a response issued strictly after the ack must win — this is Finding A\'s fix');
  assert.equal(res3.monthGrid[0].status, 'missed');
  assert.ok(!Object.prototype.hasOwnProperty.call(state3.locallyWrittenIso, '2026-08-15'), 'a superseded overlay entry must be dropped once a later-issued response reflects it');
})();

// A9: the check-in status line and the dashboard/calendar must not disagree after the Finding A
// drop — both are shown to derive from the SAME post-reconcile value once patched into the board.
(function testA9CheckinAndBoardAgreeAfterACrossDeviceOverwriteIsReconciled() {
  var reconcileFactory = makeReconcileHarness_();
  var isoDate_ = function(d) { return d.toISOString().slice(0, 10); };
  var state = {
    locallyWrittenIso: { '2026-08-15': 'done' }, // this device's stale local write
    writeGenByIso_: { '2026-08-15': 1 },
    todayIso: '2026-08-15', yesterdayIso: '2026-08-14',
    board: {},
  };
  var reconcile = reconcileFactory(state, isoDate_);
  // A later-issued read returns the OTHER device's overwrite.
  var res = { monthGrid: [{ dateIso: '2026-08-15', status: 'missed' }], todayStatus: 'missed' };
  reconcile(res, /* issuedGen */ 2);

  var src = readStaticPage_();
  var patch = new Function('state', boardHelpersSrc_(src) + '\nreturn { patchBoardDayFacts_: patchBoardDayFacts_, boardMonthGrid_: boardMonthGrid_ };')(state);
  patch.patchBoardDayFacts_('2026-08', res.monthGrid);

  assert.equal(res.todayStatus, 'missed', 'the check-in status line source must show the fresh server truth');
  assert.equal(patch.boardMonthGrid_('2026-08')[0].status, 'missed', 'the board (dashboard/calendar source) must show the SAME value — no split-brain');
})();

console.log('test_checkin_board_consolidation.js: all assertions passed');
