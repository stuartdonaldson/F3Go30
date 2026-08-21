const assert = require('node:assert/strict');

// F3Go30-1f75 follow-up. handleSignupSave_ returned identityToken ONLY for a current-month save
// ("A next-month signup has nothing to check into yet"), which is correct for what that field
// means to an installed client — spend it now, resolve into check-in in place. But it left the
// client with no way at all to show the PAX their personal check-in link after a next-month
// signup, so the done card's whole link block came up hidden. The session guid exists in both
// cases (resolveOrCreateCheckinSessionGuid_ runs unconditionally) and the confirmation email
// already ships it as a working bookmarkable link — the client just never saw it.
//
// buildSignupSaveResponse_ is the extracted, pure response builder. It routes the URL through
// buildCheckinEmailLinks_ — the SAME function the confirmation email uses — so the card and the
// email cannot drift apart, which is the actual requirement (AC10).

const BASE = 'https://script.example.com/exec';
global.PropertiesService = {
  getScriptProperties: function() {
    return { getProperty: function(k) { return k === 'WEBAPP_URL' ? BASE : null; } };
  },
};

const signupWebapp = require('../script/signupWebapp.js');
const signupEmail = require('../script/signupEmail.js');

const CURRENT = { sheetId: 'sheet-current', label: 'July 2026', trackerUrl: 'https://tracker.example.com/current' };
const NEXT = { sheetId: 'sheet-next', label: 'August 2026', trackerUrl: 'https://tracker.example.com/next' };
const MONTHS = { current: CURRENT, next: NEXT };
const GUID = 'sess-abc-123';

// ── AC10: the check-in URL comes back on EVERY successful save ───────────────────────────────

(function testCurrentMonthSaveReturnsTheCheckinUrl() {
  var res = signupWebapp.buildSignupSaveResponse_(CURRENT, MONTHS, GUID);
  assert.ok(res.checkinUrl, 'a current-month save must return the personal check-in URL');
  assert.ok(res.checkinUrl.indexOf(GUID) !== -1, 'the URL must carry the session guid so the bookmark identifies the PAX');
})();

(function testNextMonthSaveAlsoReturnsTheCheckinUrl() {
  var res = signupWebapp.buildSignupSaveResponse_(NEXT, MONTHS, GUID);
  assert.ok(res.checkinUrl, 'a NEXT-month save must return the personal check-in URL too — this is the bug');
  assert.ok(res.checkinUrl.indexOf(GUID) !== -1, 'the URL must carry the session guid');
})();

(function testTheCardsUrlIsByteIdenticalToTheEmailsUrl() {
  // The point of routing through buildCheckinEmailLinks_ rather than rebuilding the URL: one
  // link, one meaning, on both surfaces.
  var res = signupWebapp.buildSignupSaveResponse_(NEXT, MONTHS, GUID);
  var emailLinks = signupEmail.buildCheckinEmailLinks_(BASE, GUID);
  assert.equal(res.checkinUrl, emailLinks.checkinUrl,
    'the done card and the confirmation email must hand out the SAME check-in URL');
})();

(function testNoCheckinUrlWhenNoSessionGuidCouldBeMinted() {
  var res = signupWebapp.buildSignupSaveResponse_(CURRENT, MONTHS, null);
  assert.equal(res.checkinUrl, undefined, 'with no session guid there is no personal link to offer');
  assert.equal(res.ok, true, 'the save itself still succeeded');
})();

// ── AC11: identityToken keeps its existing, narrower meaning ────────────────────────────────

(function testIdentityTokenStillOnlyPresentForACurrentMonthSave() {
  var current = signupWebapp.buildSignupSaveResponse_(CURRENT, MONTHS, GUID);
  assert.equal(current.identityToken, GUID, 'a current-month save can be spent into check-in immediately');

  var next = signupWebapp.buildSignupSaveResponse_(NEXT, MONTHS, GUID);
  assert.equal(next.identityToken, undefined,
    'identityToken must NOT appear for a next-month save — an installed client resolves it straight ' +
    'into a check-in that does not exist yet (OPERATIONS.md §API compatibility)');
})();

(function testTheUnchangedFieldsAreStillThere() {
  var res = signupWebapp.buildSignupSaveResponse_(NEXT, MONTHS, GUID);
  assert.equal(res.ok, true);
  assert.equal(res.savedMonth, 'August 2026');
  assert.equal(res.trackerUrl, NEXT.trackerUrl);
})();

// ── F3Go30-uz9e.4: goalRecordSaveFailed is additive and only present on a real failure ─────────

(function testGoalRecordSaveFailedAbsentOnOrdinarySuccess() {
  var res = signupWebapp.buildSignupSaveResponse_(CURRENT, MONTHS, GUID, false);
  assert.equal('goalRecordSaveFailed' in res, false, 'must be absent, not false, on the ordinary success path');
})();

(function testGoalRecordSaveFailedSurfacedWhenTheDualWriteDropped() {
  var res = signupWebapp.buildSignupSaveResponse_(CURRENT, MONTHS, GUID, true);
  assert.equal(res.goalRecordSaveFailed, true);
  assert.equal(res.ok, true, 'the save itself (Responses cell, already written) still succeeded');
})();

(function testHandleSignupSaveCallsUpsertPaxGoalsForMonthAndThreadsItsFailureIntoTheResponse() {
  var src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'script', 'signupWebapp.js'), 'utf8'
  );
  var fn = src.match(/function handleSignupSave_\([\s\S]*?\n\}/)[0];
  assert.match(fn, /upsertPaxGoalsForMonth_sw_\(/,
    'handleSignupSave_ must dual-write the new goals record, not rely on Responses alone (§5 Slice 2)');
  assert.match(fn, /goalRecordSaveFailed/,
    'a dropped goal-record write must be threaded into the response, not swallowed');
})();

(function testHandleSignupSaveRoutesItsResponseThroughTheBuilder() {
  // The builder only means anything if the real save path actually uses it.
  const fs = require('node:fs');
  const path = require('node:path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'script', 'signupWebapp.js'), 'utf8');
  var fn = src.match(/function handleSignupSave_\([\s\S]*?\n\}/);
  assert.ok(fn, 'handleSignupSave_ not found');
  assert.match(fn[0], /buildSignupSaveResponse_\(/,
    'handleSignupSave_ must build its response via buildSignupSaveResponse_, not inline');
})();

console.log('test_signup_save_checkin_link.js: all assertions passed');
