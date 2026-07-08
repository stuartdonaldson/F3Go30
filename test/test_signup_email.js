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

console.log('test_signup_email.js: all assertions passed');
