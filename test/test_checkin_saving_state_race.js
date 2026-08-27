const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-5c2a.5: live HAR evidence (2026-08-26, SIT v2.5.0.20) showed "Missed it" (todayNoBtn/
// yesterdayNoBtn) getting permanently stuck showing "Saving…" while its disabled state and the
// day's status note/`.current` class kept correctly tracking the true server state — only the
// button's own label was wrong, forever, with no recovery short of a reload.
//
// Root cause: renderCheckinStatus_ unconditionally raw-assigns `.disabled` on all three day
// buttons (an unrelated availability check), which can land WHILE one of those buttons has a
// checkin submit genuinely in flight (silentResumeRefresh_'s visibilitychange handler is the
// most direct trigger; a same-day coalesced tap's own settle-time call into this same function is
// another). setButtonLoading_ used `if (!btn.disabled)` as its own "am I currently loading" check
// — so the external re-enable made a SECOND tap on that button believe it was starting fresh,
// and it captured `dataset.originalText` off whatever textContent happened to be at that instant:
// this function's own 'Saving…' placeholder. Every later settle then "restored" that stuck
// placeholder as if it were the real label.
//
// Extracts the REAL setButtonLoading_ and renderCheckinStatus_ (plus the status-text tables and
// pickInspireLine_ they depend on) — same extraction pattern as test_client_transport_resilience.js.

function makeCheckinStatusHarness_() {
  var src = readStaticPage_();
  var checkinStatusText = src.match(/var CHECKIN_STATUS_TEXT_ = \{[\s\S]*?\n {2}\};/);
  assert.ok(checkinStatusText, 'CHECKIN_STATUS_TEXT_ not found in index.html');
  var inspireLines = src.match(/var INSPIRE_LINES_ = \{[\s\S]*?\n {2}\};/);
  assert.ok(inspireLines, 'INSPIRE_LINES_ not found in index.html');

  var body = checkinStatusText[0] + '\n' + inspireLines[0] + '\n' +
    extractFunction_(src, 'pickInspireLine_') + '\n' +
    extractFunction_(src, 'setButtonLoading_') + '\n' +
    extractFunction_(src, 'renderCheckinStatus_') +
    '\nreturn { setButtonLoading_: setButtonLoading_, renderCheckinStatus_: renderCheckinStatus_ };';

  var els = {};
  function makeButton_(initialText) {
    return { textContent: initialText, disabled: false, dataset: {}, classList: { toggle: function() {} } };
  }
  els.todayYesBtn = makeButton_('✓ I Hit it!');
  els.todayNoBtn = makeButton_('✗ Missed it');
  els.todayNoneBtn = makeButton_('No Check-in');
  els.todayStatusNote = { textContent: '', classList: { toggle: function() {} } };

  var factory = new Function('YESTERDAY_CHECKIN_WARNING_HOUR_', '$', body);
  var fns = factory(10, function(id) { return els[id]; });

  return { setButtonLoading_: fns.setButtonLoading_, renderCheckinStatus_: fns.renderCheckinStatus_, els: els };
}

function testRenderCheckinStatusDoesNotClobberAButtonMidSubmit() {
  var h = makeCheckinStatusHarness_();
  // Simulate submitCheckin_ having started a request for "Missed it" — still in flight.
  h.setButtonLoading_(h.els.todayNoBtn, true, 'Saving…');
  assert.equal(h.els.todayNoBtn.disabled, true);
  assert.equal(h.els.todayNoBtn.textContent, 'Saving…');

  // A concurrent render lands (e.g. silentResumeRefresh_ on a visibilitychange) while that
  // submit is still pending.
  h.renderCheckinStatus_('today', 'missed');

  assert.equal(h.els.todayNoBtn.disabled, true, 'a button mid-submit must not be re-enabled by an unrelated render');
  assert.equal(h.els.todayNoBtn.textContent, 'Saving…', 'the loading label must survive an unrelated render');
  // The OTHER two buttons for the same day are not mid-submit — they still get the normal
  // availability update.
  assert.equal(h.els.todayYesBtn.disabled, false);
  assert.equal(h.els.todayNoneBtn.disabled, false);

  // The submit finally settles — its own settle handler must still restore the real label, not
  // whatever the concurrent render's raw stomp would have left behind.
  h.setButtonLoading_(h.els.todayNoBtn, false);
  assert.equal(h.els.todayNoBtn.textContent, '✗ Missed it', 'the real original label must be restored, not the "Saving…" placeholder');
  assert.equal(h.els.todayNoBtn.disabled, false);
}

function testSetButtonLoadingSurvivesAnExternalDisabledClobberEvenIfOneOccurs() {
  var h = makeCheckinStatusHarness_();
  var btn = h.els.todayNoBtn;
  h.setButtonLoading_(btn, true, 'Saving…');

  // Some other, not-yet-audited code path raw-stomps `.disabled` mid-flight (the exact bug
  // renderCheckinStatus_ used to have, kept here as a defense-in-depth check independent of that
  // one call site's own fix above).
  btn.disabled = false;

  // A second tap on what now looks like an enabled button re-enters setButtonLoading_. Because
  // the loading flag is dataset.saving (not `.disabled`), this must NOT be treated as a fresh
  // start — it must not recapture 'Saving…' as the original label.
  h.setButtonLoading_(btn, true, 'Saving…');
  h.setButtonLoading_(btn, false);
  assert.equal(btn.textContent, '✗ Missed it', 'dataset.saving must prevent the original label from ever being overwritten by the loading placeholder');
}

function run() {
  var tests = [
    testRenderCheckinStatusDoesNotClobberAButtonMidSubmit,
    testSetButtonLoadingSurvivesAnExternalDisabledClobberEvenIfOneOccurs,
  ];
  tests.forEach(function(test) {
    test();
    console.log('  ok - ' + test.name);
  });
  console.log('test_checkin_saving_state_race.js: all tests passed');
}

run();
