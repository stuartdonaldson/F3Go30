const assert = require('node:assert/strict');

// signupEmail.js binds resolveWebAppBaseUrl_ from Utilities.js at require time, which reads the
// WEBAPP_URL script property at call time — so a PropertiesService stub set before invoking the
// builder is enough to exercise the real base-URL resolution path (no HtmlService here, so the
// builder takes its plain-DOCTYPE fallback, which is the branch these tests assert on).
const BASE = 'https://script.example.com/exec';
global.PropertiesService = {
  getScriptProperties: function() {
    return { getProperty: function(k) { return k === 'WEBAPP_URL' ? BASE : null; } };
  },
};

const signupEmail = require('../script/signupEmail.js');

// --- Check-in link is primary, personal, and bookmarkable when a session guid is supplied ---
{
  var msg = signupEmail.buildSignupReuseEmailTemplate_({
    mode: 'new_signup',
    f3Name: 'Anchor',
    trackerUrl: 'https://tracker.example.com',
    checkinSessionGuid: 'sess-123',
    summaryLines: ['Who: Leader', 'What: Ruck'],
    registrationMonth: 'July 2026',
  });

  var checkinUrl = BASE + '?cmd=checkin&id=sess-123';
  var editUrl = BASE + '?cmd=signup&id=sess-123';

  assert.ok(msg.htmlBody.indexOf(checkinUrl) !== -1, 'HTML carries the check-in link with the session guid');
  assert.ok(msg.htmlBody.indexOf(editUrl) !== -1, 'HTML carries the edit-goals signup link with the same session guid');
  assert.ok(msg.body.indexOf(checkinUrl) !== -1, 'plaintext carries the check-in link with the session guid');
  assert.ok(msg.body.indexOf(editUrl) !== -1, 'plaintext carries the edit-goals signup link with the same session guid');

  // Primary means the check-in link appears before the tracker link in both bodies.
  assert.ok(
    msg.htmlBody.indexOf(checkinUrl) < msg.htmlBody.indexOf('https://tracker.example.com'),
    'check-in link is the primary CTA (precedes the tracker link) in HTML'
  );
  assert.ok(
    msg.body.indexOf('cmd=checkin') < msg.body.indexOf('https://tracker.example.com'),
    'check-in link is the primary CTA (precedes the tracker link) in plaintext'
  );

  // Copy names it as a personal, bookmarkable link.
  assert.match(msg.htmlBody, /bookmark/i);
  assert.match(msg.body, /bookmark/i);
}

// --- Without a session guid, the links degrade to the plain webapp routes (no &id) ---
{
  var msg = signupEmail.buildSignupReuseEmailTemplate_({
    mode: 'confirmation',
    f3Name: 'Anchor',
    trackerUrl: 'https://tracker.example.com',
    summaryLines: ['Who: Leader'],
    registrationMonth: 'July 2026',
  });
  assert.ok(msg.htmlBody.indexOf(BASE + '?cmd=checkin') !== -1);
  assert.ok(msg.htmlBody.indexOf('cmd=checkin&id=') === -1, 'no session guid → no &id on the check-in link');
  assert.ok(msg.htmlBody.indexOf(BASE + '?cmd=signup') !== -1, 'edit-goals link still points at the signup webapp');
  assert.ok(msg.htmlBody.indexOf('cmd=signup&id=') === -1, 'no session guid → no &id on the edit link');
}

// --- Static host configured: both the check-in and edit-goals (signup) links point at the
// static front end instead of the bare GAS routes (F3Go30-833s.10 / ADR-018 §7) ---
{
  global.STATIC_PAGES_BASE_URL_ = 'https://pax.example.github.io/f3go30/';
  global.APP_DEPLOY_TARGET = 'TEST';
  delete require.cache[require.resolve('../script/Utilities.js')];
  delete require.cache[require.resolve('../script/signupEmail.js')];
  var staticSignupEmail = require('../script/signupEmail.js');

  var msg = staticSignupEmail.buildSignupReuseEmailTemplate_({
    mode: 'reuse',
    f3Name: 'Anchor',
    trackerUrl: 'https://tracker.example.com',
    checkinSessionGuid: 'sess-123',
    summaryLines: ['Who: Leader'],
    registrationMonth: 'July 2026',
  });

  var staticBase = 'https://pax.example.github.io/f3go30/sit/';
  assert.ok(msg.htmlBody.indexOf(staticBase + '?id=sess-123"') !== -1,
    'HTML check-in link points at the static front end when configured');
  assert.ok(msg.htmlBody.indexOf(staticBase + '?cmd=signup&id=sess-123') !== -1,
    'HTML edit-goals (signup) link points at the static front end when configured');
  assert.ok(msg.body.indexOf(staticBase + '?cmd=signup&id=sess-123') !== -1,
    'plaintext edit-goals (signup) link points at the static front end when configured');

  delete global.STATIC_PAGES_BASE_URL_;
  delete global.APP_DEPLOY_TARGET;
  delete require.cache[require.resolve('../script/Utilities.js')];
  delete require.cache[require.resolve('../script/signupEmail.js')];
}

// --- F3Go30-1f75: terminology that is true for a NEXT-month signup too -----------------------
// The same confirmation email goes out whether the PAX registered for the month underway or the
// one ahead. Copy that presumes they can check in today is wrong half the time, and the done
// card now shares this vocabulary, so it has to hold on both surfaces.
{
  const copy = require('../script/signupEmail.js').CHECKIN_EMAIL_COPY_;

  assert.ok(copy, 'CHECKIN_EMAIL_COPY_ must be exported so the done card can be checked against it');

  var joined = [copy.checkinHeading, copy.checkinIntro, copy.checkinLabel, copy.dashboardNote].join(' ');
  assert.doesNotMatch(joined, /\btoday\b/i,
    'check-in copy must not say "today" — a next-month registration has nothing to record yet');
  assert.doesNotMatch(joined, /Continue to check in/i,
    '"continue to check in" asserts the page is usable right now, which is not always true');

  assert.ok(copy.notYetNote, 'copy must explain the case where the month has not started yet');
  assert.match(copy.notYetNote, /month/i, 'the not-yet note must name the month as what it waits on');

  var msg = signupEmail.buildSignupReuseEmailTemplate_({
    mode: 'new_signup',
    f3Name: 'Anchor',
    trackerUrl: 'https://tracker.example.com',
    checkinSessionGuid: 'sess-123',
    registrationMonth: 'August 2026',
  });
  assert.ok(msg.htmlBody.indexOf(copy.notYetNote) !== -1, 'HTML body carries the not-yet note');
  assert.ok(msg.body.indexOf(copy.notYetNote) !== -1, 'plaintext body carries the not-yet note');
}

console.log('test_signup_email.js: all assertions passed');
