const assert = require('node:assert/strict');
const {
  readStaticPage_, extractTransportBlock_, extractFunction_, makeFakeLocalStorage_, makeFakeClock_,
} = require('./helpers/staticPageExtract');

// F3Go30-5c2a.7: a transport failure on a check-in POST is not evidence the write failed (ADR-022:
// doPost runs to completion before the redirect hop the response is lost on). The client keeps
// the optimistic value, asks the server what it holds (a monthGrid read-back), and only shows the
// failure banner when the server says the write is not there.
//
// Runs the REAL confirmWrite_ (transport block), the REAL submitCheckinWrite_/ackCheckinWrite_/
// checkinProbe_/confirmCheckinWrite_, and the REAL showApiError_/captureClientError_ against
// injected fetch / clock stand-ins — same extraction pattern as test_client_transport_resilience.js
// and test_client_reconnect_telemetry.js, no re-implementations.

var CHECKIN_FUNCTIONS_ = [
  'hideApiError_', 'setButtonLoading_', 'valueToStatus_', 'monthKeyOf_', 'parseIsoDate_', 'showApiError_',
  'submitCheckinWrite_', 'ackCheckinWrite_', 'checkinProbe_', 'confirmCheckinWrite_', 'setWriteConfirmNotice_',
];

function makeHarness_(opts) {
  opts = opts || {};
  var src = readStaticPage_();
  var body = extractFunction_(src, 'hashString_') + '\n' + extractTransportBlock_(src) + '\n' +
    CHECKIN_FUNCTIONS_.map(function(n) { return extractFunction_(src, n); }).join('\n');

  var clock = makeFakeClock_();
  var fetchCalls = [];
  var els = {};
  function el(id) {
    if (!els[id]) {
      els[id] = {
        id: id, textContent: '', href: '', hidden: true, dataset: {}, disabled: false,
        classList: {
          add: function(c) { if (c === 'hidden') els[id].hidden = true; },
          remove: function(c) { if (c === 'hidden') els[id].hidden = false; },
          toggle: function(c, on) { if (c === 'hidden') els[id].hidden = !!on; },
        },
      };
    }
    return els[id];
  }
  var state = {
    currentStep: 'checkin', f3Name: 'Little John', email: 'lj@example.test', resolvedContext: null,
    locallyWrittenIso: {}, writeGenByIso_: {}, board: {}, pendingSelfWrites: {}, calMonthKey: '2026-09',
    monthGrid: [], lastEditedDayIso: null,
  };
  var calls = { revert: [], apply: [], boardMonthGrid: 0 };
  var fakeLocalStorage = makeFakeLocalStorage_();

  var factory = new Function(
    'WEBAPP_URL', 'CMD_', 'NS_', 'CONTEXT_DATE_', 'STATIC_BUILD_VERSION_',
    'fetch', 'setTimeout', 'clearTimeout', 'Date', 'AbortController', '$', 'window', 'localStorage', 'navigator',
    'state', 'SITE_Q_NAME', 'SITE_Q_EMAIL', 'applyOwnDayWrite_', 'revertOwnDayWrite_', 'boardMonthGrid_',
    'loadDashboard_', 'loadCalMonth_', 'loadBonusList_', 'isoDate_',
    body +
    '\nreturn { confirmWrite_: confirmWrite_, submitCheckinWrite_: submitCheckinWrite_, checkinProbe_: checkinProbe_,' +
    '\n  hideApiError_: hideApiError_, setWriteConfirmNotice_: setWriteConfirmNotice_ };'
  );
  var fns = factory(
    'https://example.test/exec', 'checkin', 'testns', '', '2.6.6.0',
    function(url, fetchOpts) {
      var call = { url: url, body: JSON.parse(fetchOpts.body) };
      fetchCalls.push(call);
      return opts.fetchImpl(call, fetchCalls.length);
    },
    clock.setTimeout, clock.clearTimeout, clock.Date, AbortController, el,
    { addEventListener: function() {} }, fakeLocalStorage, { onLine: true },
    state, 'Test Q', 'q@example.test',
    function(dateIso, value) { calls.apply.push([dateIso, value]); },
    function(dateIso) { calls.revert.push(dateIso); },
    function() { calls.boardMonthGrid++; return []; },
    function() {}, function() {}, function() {}, String
  );

  return Object.assign(fns, {
    clock: clock, fetchCalls: fetchCalls, el: el, state: state, calls: calls,
    /** Every kind:'error' telemetry record captured (still queued — nothing here acks them). */
    errorRecords: function() {
      return JSON.parse(fakeLocalStorage.getItem('go30ClientTelemetryQueue:v1') || '[]')
        .filter(function(r) { return r.kind === 'error'; });
    },
    fetchCallsFor: function(action) { return fetchCalls.filter(function(c) { return c.body.action === action; }); },
  });
}

function transportError_() { return Object.assign(new Error('Failed to fetch'), { isTransport: true }); }
function json_(body) {
  return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve(body); } });
}
function flush_() { return new Promise(function(r) { setImmediate(r); }); }
function grid_(dateIso, status) { return { ok: true, registered: true, monthGrid: [{ dateIso: dateIso, status: status }] }; }

/** A probe stub: `steps` is consumed one per call; an Error rejects, a function runs (and may
 * advance the clock), anything else resolves. Records the call count. */
function scriptedProbe_(steps) {
  var p = { calls: 0 };
  p.probe = function() {
    var step = steps[Math.min(p.calls, steps.length - 1)];
    p.calls++;
    if (typeof step === 'function') return step();
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
  return p;
}
var landedIfTrue_ = function(json) { return json === true; };

// ── AC1: confirmWrite_'s loop ─────────────────────────────────────────────────────────────────

async function testLanded_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var p = scriptedProbe_([true]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'landed');
  assert.equal(r.attempts, 1);
  assert.equal(r.elapsedMs, 0);
}

async function testMissing_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var p = scriptedProbe_([false]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'missing', 'an answer that says the write is absent is terminal');
  assert.equal(p.calls, 1);
}

async function testLostProbesThenLanded_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var p = scriptedProbe_([transportError_(), transportError_(), true]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'landed', 'a lost probe is not an answer — try again');
  assert.equal(r.attempts, 3);
  assert.equal(r.elapsedMs, 8000, 'two lost probes wait WRITE_CONFIRM_INTERVAL_MS_ (4s) each');
}

async function testAttemptCapIsUnknownNeverMissing_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var p = scriptedProbe_([transportError_()]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'unknown', 'every probe lost must never read as "missing" (Little John case)');
  assert.equal(r.attempts, 3);
  assert.equal(p.calls, 3);
}

async function testDeadlineIsUnknown_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  // Each lost probe burns 40s (a read that ran its retries): 40s, wait 4s, 40s more = 84s > 60s.
  var p = scriptedProbe_([function() { h.clock.advance(40000); return Promise.reject(transportError_()); }]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.attempts, 2, 'the deadline stops a third probe even though the attempt cap is not reached');
}

// Spec clarification (post F3Go30-5c2a.9): the deadline is checked only BEFORE starting a probe;
// a probe already in flight when it passes is allowed to finish and its answer is honoured.
async function testInFlightProbeAnswerHonouredAfterDeadline_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var p = scriptedProbe_([function() { h.clock.advance(70000); return Promise.resolve(true); }]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'landed', 'a probe that answers after the deadline elapsed still counts');
  assert.equal(r.attempts, 1);
  assert.equal(r.elapsedMs, 70000);
}

async function testServerErrorProbeIsUnknownImmediately_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var p = scriptedProbe_([new Error('Server reported an error')]);
  var r = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: p.probe, landed: landedIfTrue_ }));
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.attempts, 1, 'a server that answered with an error is not re-asked');
}

async function testNeverThrows_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var r1 = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: function() { throw new Error('sync'); }, landed: landedIfTrue_ }));
  assert.equal(r1.outcome, 'unknown');
  var r2 = await h.clock.drain(h.confirmWrite_({ action: 'checkin', probe: function() { return Promise.resolve(1); }, landed: function() { throw new Error('bad'); } }));
  assert.equal(r2.outcome, 'unknown');
  assert.equal(h.errorRecords().length, 0, 'confirmWrite_ never captures telemetry itself');
}

// ── AC2: the check-in prober ──────────────────────────────────────────────────────────────────

async function testCheckinProbeReadsMonthGridLiveAndMatchesDateAndStatus_() {
  var h = makeHarness_({ fetchImpl: function() { return json_(grid_('2026-09-14', 'done')); } });
  h.state.board['2026-09'] = { stale: true }; // must never be consulted
  var d = h.checkinProbe_('2026-09-14', 'done');
  assert.equal(d.action, 'checkin');
  assert.equal(d.landed(await d.probe()), true);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].body.action, 'monthGrid');
  assert.equal(h.fetchCalls[0].body.monthKey, '2026-09');
  assert.equal(h.fetchCalls[0].body.f3Name, 'Little John');
  assert.equal(d.landed(grid_('2026-09-14', 'missed')), false, 'the old value is "missing"');
  assert.equal(d.landed(grid_('2026-09-13', 'done')), false, 'a different day does not count');
  assert.equal(d.landed({ ok: true, registered: false, monthGrid: [{ dateIso: '2026-09-14', status: 'done' }] }), false);
}

// ── AC3-AC7: the wired-in behaviour, through the real submitCheckinWrite_ ───────────────────────

/** checkin POST is dropped (a transport error); monthGrid is answered by `monthGridImpl`. */
function makeCheckinHarness_(monthGridImpl) {
  return makeHarness_({ fetchImpl: function(call) {
    if (call.body.action === 'checkin') return Promise.reject(new TypeError('Failed to fetch'));
    return monthGridImpl(call);
  } });
}

function makeBtn_() {
  return { dataset: {}, textContent: 'Yes', disabled: false };
}

function submit_(h, dateIso, value, onLanded) {
  var btn = makeBtn_();
  var landed = [];
  h.submitCheckinWrite_({ btn: btn, dayArg: 'today', dateIso: dateIso, value: value,
    onLanded: function(status) { landed.push(status); if (onLanded) onLanded(status); } });
  return { btn: btn, landed: landed };
}

async function settle_(h) {
  // Drives the clock until nothing scheduled by the confirmation is left before a poll timer.
  for (var i = 0; i < 40; i++) {
    await flush_();
    if (h.clock.pending().length === 0) return;
    var pending = h.clock.pending().sort(function(a, b) { return a.due - b.due; });
    // Do not run the reconnect poll (10s) — only the confirmation's own 4s waits.
    if (pending[0].ms !== 4000) return;
    h.clock.advance(pending[0].ms);
    h.clock.clearTimeout(pending[0].id);
    pending[0].fn();
  }
}

async function testTransportFailedButLandedShowsNoBannerAndKeepsValue_() {
  var h = makeCheckinHarness_(function() { return json_(grid_('2026-09-14', 'done')); });
  var s = submit_(h, '2026-09-14', 1);
  await settle_(h);
  assert.equal(h.el('apiErrorBanner').hidden, true, 'no error banner at any point');
  assert.deepEqual(h.calls.revert, [], 'the optimistic value is kept');
  assert.equal(h.state.locallyWrittenIso['2026-09-14'], 'done');
  assert.deepEqual(s.landed, ['done'], 'the landed write runs the same ack + render as a normal success');
  assert.equal(h.state.lastEditedDayIso, '2026-09-14');
  assert.equal(h.state.writeGenByIso_['2026-09-14'], 0);
  assert.equal(h.el('writeConfirmNotice').hidden, true, 'the confirming notice is hidden again');
  assert.equal(s.btn.dataset.saving, undefined, 'the button is released');
  var recs = h.errorRecords();
  assert.equal(recs.length, 1, 'exactly one kind:error record');
  assert.equal(recs[0].action, 'checkin');
  assert.equal(recs[0].isTransport, true);
  assert.equal(recs[0].confirmOutcome, 'landed');
  assert.equal(recs[0].confirmAttempts, 1);
  assert.equal(typeof recs[0].confirmElapsedMs, 'number');
  ['errorText', 'elapsedMs', 'abortedAtTimeout', 'echoKeyHash', 'clientRequestId', 'redirected'].forEach(function(f) {
    assert.ok(Object.prototype.hasOwnProperty.call(recs[0], f), 'the record keeps its existing field ' + f);
  });
}

async function testButtonReleasedAndNoticeShownWhileConfirming_() {
  var release;
  var h = makeCheckinHarness_(function() {
    return new Promise(function(resolve) { release = function() { resolve({ ok: true, status: 200, json: function() { return Promise.resolve(grid_('2026-09-14', 'done')); } }); }; });
  });
  var s = submit_(h, '2026-09-14', 1);
  await flush_(); await flush_();
  assert.equal(s.btn.dataset.saving, undefined, 'the loading state ends when the POST settles, not when the confirmation does');
  assert.equal(h.el('writeConfirmNotice').hidden, false, 'the calm notice shows while confirming');
  assert.equal(h.el('apiErrorBanner').hidden, true);
  release();
  await settle_(h);
  assert.equal(h.el('writeConfirmNotice').hidden, true);
}

async function testTransportFailedAndNotLandedShowsTheSameBannerAndReverts_() {
  var h = makeCheckinHarness_(function() { return json_(grid_('2026-09-14', 'pending')); });
  var s = submit_(h, '2026-09-14', 1);
  await settle_(h);
  assert.equal(h.el('apiErrorBanner').hidden, false);
  assert.equal(h.el('apiErrorHeadline').textContent, 'Couldn’t reach the server.', 'the original transport banner copy');
  assert.match(h.el('apiErrorDetail').textContent, /Error: .*/);
  assert.deepEqual(h.calls.revert, ['2026-09-14']);
  assert.equal(h.state.locallyWrittenIso['2026-09-14'], undefined);
  assert.deepEqual(s.landed, []);
  assert.equal(h.el('writeConfirmNotice').hidden, true);
  var recs = h.errorRecords();
  assert.equal(recs.length, 1, 'showApiError_ captures it — no double capture');
  assert.equal(recs[0].confirmOutcome, 'missing');
  assert.equal(recs[0].confirmAttempts, 1);
  assert.equal(recs[0].isTransport, true);
}

async function testConfirmationExhaustedIsConservative_() {
  var h = makeCheckinHarness_(function() { return Promise.reject(new TypeError('Failed to fetch')); });
  submit_(h, '2026-09-14', 1);
  await settle_(h);
  assert.equal(h.el('apiErrorBanner').hidden, false, 'unknown behaves like missing');
  assert.deepEqual(h.calls.revert, ['2026-09-14']);
  var recs = h.errorRecords();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].confirmOutcome, 'unknown');
  assert.equal(recs[0].confirmAttempts, 3);
  assert.equal(h.fetchCallsFor('checkin').length, 1, 'the write is never replayed');
}

async function testSupersededWriteAbandonsItsConfirmationSilently_() {
  var release;
  var h = makeCheckinHarness_(function() {
    return new Promise(function(resolve) { release = function() { resolve({ ok: true, status: 200, json: function() { return Promise.resolve(grid_('2026-09-14', 'done')); } }); }; });
  });
  var s = submit_(h, '2026-09-14', 1);
  await flush_(); await flush_();
  h.state.locallyWrittenIso['2026-09-14'] = 'missed'; // a newer tap on the same day owns it now
  release();
  await settle_(h);
  assert.equal(h.el('apiErrorBanner').hidden, true, 'no banner');
  assert.deepEqual(h.calls.revert, [], 'no revert');
  assert.deepEqual(s.landed, [], 'no ack');
  assert.equal(h.el('writeConfirmNotice').hidden, true, 'the notice is hidden');
  assert.equal(h.errorRecords().length, 0);
}

async function testSupersededBeforeConfirmationStartsNeverProbes_() {
  var h = makeCheckinHarness_(function() { return json_(grid_('2026-09-14', 'done')); });
  submit_(h, '2026-09-14', 1);
  h.state.locallyWrittenIso['2026-09-14'] = 'missed'; // synchronous, before the POST rejection lands
  await settle_(h);
  assert.equal(h.fetchCallsFor('monthGrid').length, 0, 'no probe for a write that is already superseded');
  assert.equal(h.el('apiErrorBanner').hidden, true);
  assert.deepEqual(h.calls.revert, []);
}

async function testServerAnsweredErrorIsUnchanged_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: false, error: 'Unknown PAX' }); } });
  var s = submit_(h, '2026-09-14', 1);
  await settle_(h);
  assert.equal(h.fetchCalls.length, 1, 'a server that answered is not confirmed by read-back');
  assert.equal(h.el('apiErrorBanner').hidden, false);
  assert.equal(h.el('apiErrorHeadline').textContent, 'Something went wrong.');
  assert.deepEqual(h.calls.revert, ['2026-09-14']);
  assert.deepEqual(s.landed, []);
  var recs = h.errorRecords();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].confirmOutcome, undefined);
}

function testNoticeAndBannerAreIndependent_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  h.el('apiErrorBanner').hidden = false;
  h.setWriteConfirmNotice_(true);
  h.setWriteConfirmNotice_(false);
  assert.equal(h.el('apiErrorBanner').hidden, false, 'hiding the notice must never clear an error another action raised');
  h.setWriteConfirmNotice_(true);
  h.hideApiError_();
  assert.equal(h.el('writeConfirmNotice').hidden, false, 'hideApiError_ must not touch the notice');
}

function testSuccessfulWriteIsUnchanged_() {
  var h = makeHarness_({ fetchImpl: function() { return json_({ ok: true }); } });
  var s = submit_(h, '2026-09-14', 0);
  return flush_().then(flush_).then(function() {
    assert.deepEqual(s.landed, ['missed']);
    assert.equal(h.fetchCalls.length, 1);
    assert.equal(h.el('apiErrorBanner').hidden, true);
    assert.equal(h.errorRecords().length, 0);
  });
}

(async function main() {
  var tests = [
    testLanded_, testMissing_, testLostProbesThenLanded_, testAttemptCapIsUnknownNeverMissing_, testDeadlineIsUnknown_,
    testInFlightProbeAnswerHonouredAfterDeadline_, testServerErrorProbeIsUnknownImmediately_, testNeverThrows_,
    testCheckinProbeReadsMonthGridLiveAndMatchesDateAndStatus_,
    testTransportFailedButLandedShowsNoBannerAndKeepsValue_, testButtonReleasedAndNoticeShownWhileConfirming_,
    testTransportFailedAndNotLandedShowsTheSameBannerAndReverts_, testConfirmationExhaustedIsConservative_,
    testSupersededWriteAbandonsItsConfirmationSilently_, testSupersededBeforeConfirmationStartsNeverProbes_,
    testServerAnsweredErrorIsUnchanged_, testNoticeAndBannerAreIndependent_, testSuccessfulWriteIsUnchanged_,
  ];
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i](); } catch (e) { console.error('FAIL ' + tests[i].name); throw e; }
  }
  console.log('test_client_write_confirm.js: all assertions passed');
})().catch(function(e) { console.error(e); process.exit(1); });
