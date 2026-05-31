const assert = require('node:assert/strict');

const {
  buildResponseSettingsEmailTemplate_,
} = require('../script/responseSettingsEmail.js');

const message = buildResponseSettingsEmailTemplate_({
  recipientName: 'Anchor',
  copiedSettings: [
    { header: 'WHO', value: 'Leader' },
    { header: 'WHAT', value: 'Ruck' }
  ]
});

assert.equal(message.subject, 'Your Go30 signup settings');
assert.match(message.body, /Hello Anchor,/);
assert.match(message.body, /WHO: Leader/);
assert.match(message.body, /WHAT: Ruck/);
assert.match(message.htmlBody, /Your Go30 signup settings were copied/);
assert.match(message.htmlBody, /Leader/);
assert.match(message.htmlBody, /Ruck/);

console.log('test_response_settings_email.js: PASS');
