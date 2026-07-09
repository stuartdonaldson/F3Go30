const assert = require('node:assert/strict');

const {
  prepareOutboundEmailDelivery_,
  readEmailDeliveryPolicy_,
  readEmailDeliveryPolicyFromSheet_,
} = require('../script/Utilities.js');

global.PropertiesService = {
  getScriptProperties: function() {
    return { getProperty: function() { return null; } };
  }
};

global.HtmlService = {
  createTemplateFromFile: function(fileName) {
    assert.equal(fileName, 'ReminderEmailTemplate');
    return {
      evaluate: function() {
        var template = this;
        return {
          getContent: function() {
            return [
              '<html><body>',
              '<h1>Go30 Reminder</h1>',
              '<p>' + template.funFact + '</p>',
              '<p>Team: ' + template.teamName + '</p>',
              '<p>Date: ' + template.targetDateString + '</p>',
              '<ul>',
              template.missing.map(function(member) {
                return '<li>' + member.name + (member.who ? ' - goal: ' + member.who : '') + '</li>';
              }).join(''),
              '</ul>',
              '<a href="' + template.trackerUrl + '">Tracker</a>',
              '</body></html>'
            ].join('');
          }
        };
      }
    };
  }
};

const {
  buildTrackerUrl_,
  pickFunFactFromValues_,
  sanitizeNagDisplayName_,
  buildNagRecipientList_,
  buildReminderEmailTemplate_,
  getNagDisplayNameFromResponse_,
} = require('../script/nag.js');

assert.equal(
  buildTrackerUrl_(
    { getUrl: function() { return 'https://docs.google.com/spreadsheets/d/mock/edit'; } },
    { getSheetId: function() { return 456; } }
  ),
  'https://docs.google.com/spreadsheets/d/mock/edit#gid=456'
);

assert.equal(
  pickFunFactFromValues_(
    [
      ['Prompt', 'Answer'],
      ['Favorite CSAUP', 'Murph'],
      ['Best excuse for missing a workout', 'Travel'],
    ],
    function(max) {
      assert.equal(max, 2);
      return 0;
    }
  ),
  'Fun fact: Favorite CSAUP - Murph'
);

assert.equal(
  pickFunFactFromValues_([
    ['Prompt', 'Answer'],
  ]),
  ''
);

assert.equal(sanitizeNagDisplayName_('Güéŕó 🌮'), 'Guero');

assert.equal(
  getNagDisplayNameFromResponse_(['05/31/2026', 'littlejohn@example.com', 'Little John'], { F3_NAME: 2 }, 'Tracker Name'),
  'Little John'
);

assert.equal(
  getNagDisplayNameFromResponse_(['05/31/2026', 'littlejohn@example.com', ''], { F3_NAME: 2 }, 'Tracker Name'),
  'Tracker Name'
);

assert.equal(
  buildNagRecipientList_([
    { name: 'Little John', email: 'stuart.donaldson+Go30@gmail.com' },
    { name: 'Güéŕó 🌮', email: 'stuart.donaldson+Go30@gmail.com\n' },
    { name: 'Bad', email: 'Bad <stuart.donaldson+Go30@gmail.com>' },
    { name: 'Pogo', email: 'second@example.com' }
  ]),
  'Little John <stuart.donaldson+go30@gmail.com>,Guero <stuart.donaldson+go30@gmail.com>,Pogo <second@example.com>'
);

const message = buildReminderEmailTemplate_({
  teamName: 'Team Test',
  targetDateString: '05/08/2026',
  trackerUrl: 'https://docs.google.com/spreadsheets/d/mock/edit#gid=456',
  funFact: 'Fun fact: Favorite CSAUP - Murph',
  missing: [
    { name: 'Anchor', who: 'Leader' },
    { name: 'Torch', who: '' },
  ],
});

assert.equal(message.subject, 'Go30 Reminder; Missing check-in for 05/08/2026');
assert.match(message.body, /Fun fact: Favorite CSAUP - Murph/);
assert.match(message.body, /This is a quick reminder that the following teammates have not yet checked in for 05\/08\/2026:/);
assert.match(message.body, /- Anchor \(goal: Leader\)/);
assert.match(message.body, /- Torch/);
assert.match(message.body, /Open the tracker here:/);
assert.match(message.body, /https:\/\/docs.google.com\/spreadsheets\/d\/mock\/edit#gid=456/);
assert.match(message.body, /This reminder was sent only to teammates who explicitly opted in to nag emails\./);
assert.ok(message.htmlBody);
assert.match(message.htmlBody, /<h1>Go30 Reminder<\/h1>/);
assert.match(message.htmlBody, /<li>Anchor - goal: Leader<\/li>/);
assert.match(message.htmlBody, /<li>Torch<\/li>/);
assert.match(message.htmlBody, /Tracker/);

// When a web app URL is configured, the check-in page becomes the primary CTA and the
// Tracker sheet is demoted to the "older sheet interface" fallback.
const savedPropertiesService = global.PropertiesService;
global.PropertiesService = {
  getScriptProperties: function() {
    return { getProperty: function(key) { return key === 'WEBAPP_URL' ? 'https://webapp.example/exec' : null; } };
  }
};

const checkinMessage = buildReminderEmailTemplate_({
  teamName: 'Team Test',
  targetDateString: '05/08/2026',
  trackerUrl: 'https://docs.google.com/spreadsheets/d/mock/edit#gid=456',
  funFact: '',
  missing: [{ name: 'Anchor', who: 'Leader' }],
});

// Primary CTA: the check-in page, described as bookmarkable.
assert.match(checkinMessage.body, /the Go30 check-in page/);
assert.match(checkinMessage.body, /bookmark it/);
assert.match(checkinMessage.body, /https:\/\/webapp\.example\/exec\?cmd=checkin/);
// Tracker demoted below the check-in CTA.
assert.match(checkinMessage.body, /Prefer the older sheet interface\?/);
const checkinIdx = checkinMessage.body.indexOf('cmd=checkin');
const trackerIdx = checkinMessage.body.indexOf('spreadsheets/d/mock');
assert.ok(checkinIdx > -1 && trackerIdx > checkinIdx, 'check-in link should precede the tracker link');
// No longer leads with the tracker.
assert.doesNotMatch(checkinMessage.body, /Open the tracker here:/);

global.PropertiesService = savedPropertiesService;

const liveDelivery = prepareOutboundEmailDelivery_({
  policy: {},
  recipientList: 'alpha@example.com,beta@example.com',
  subject: 'Reminder Subject',
  body: 'Body line',
  htmlBody: '<html><body><p>Body line</p></body></html>'
});

assert.equal(liveDelivery.ok, true);
assert.equal(liveDelivery.message.to, 'alpha@example.com,beta@example.com');
assert.equal(liveDelivery.message.subject, 'Reminder Subject');
assert.equal(liveDelivery.message.body, 'Body line');
assert.equal(liveDelivery.message.htmlBody, '<html><body><p>Body line</p></body></html>');

const testDelivery = prepareOutboundEmailDelivery_({
  policy: {
    emailTestMode: true,
    siteQEmail: 'siteq@example.com'
  },
  recipientList: 'alpha@example.com,beta@example.com',
  subject: 'Reminder Subject',
  body: 'Body line',
  htmlBody: '<html><body><p>Body line</p></body></html>'
});

assert.equal(testDelivery.ok, true);
assert.equal(testDelivery.message.to, 'siteq@example.com');
assert.equal(testDelivery.message.subject, '[TEST MODE] Reminder Subject');
assert.match(testDelivery.message.body, /TEST MODE - Intended Recipients: alpha@example.com,beta@example.com/);
assert.match(testDelivery.message.body, /Body line/);
assert.match(testDelivery.message.htmlBody, /TEST MODE - Intended Recipients: alpha@example.com,beta@example.com/);
assert.match(testDelivery.message.htmlBody, /<p>Body line<\/p>/);

const blockedDelivery = prepareOutboundEmailDelivery_({
  policy: {
    emailTestMode: true,
    siteQEmail: ''
  },
  recipientList: 'alpha@example.com',
  subject: 'Reminder Subject',
  body: 'Body line',
  htmlBody: '<html><body><p>Body line</p></body></html>'
});

assert.equal(blockedDelivery.ok, false);
assert.match(blockedDelivery.error, /site q/i);

const aliasPolicy = readEmailDeliveryPolicy_(null, [
  ['Site Q', 'Little John', 'siteq@example.com'],
  ['Email Test', 'Yes', '']
]);

assert.equal(aliasPolicy.emailTestMode, true);
assert.equal(aliasPolicy.siteQEmail, 'siteq@example.com');

// readEmailDeliveryPolicyFromSheet_ — uses ManagedConfigSheet.getValue()/getPair()
const { ManagedConfigSheet } = require('../script/libSheets.js');

function makeMockConfigSheet(rows) {
  const sheet = {
    getDataRange: () => ({ getValues: () => rows })
  };
  return new ManagedConfigSheet(sheet);
}

const testModeSheet = makeMockConfigSheet([
  ['Email Test Mode', 'Yes', ''],
  ['Site Q', 'Little John', 'siteq@example.com'],
]);
const policyFromSheet = readEmailDeliveryPolicyFromSheet_(testModeSheet);
assert.equal(policyFromSheet.emailTestMode, true);
assert.equal(policyFromSheet.siteQEmail, 'siteq@example.com');
assert.equal(policyFromSheet.siteQName, 'Little John');

const noTestModeSheet = makeMockConfigSheet([
  ['Email Test Mode', 'No', ''],
  ['Site Q', 'Little John', 'siteq@example.com'],
]);
const livePolicy = readEmailDeliveryPolicyFromSheet_(noTestModeSheet);
assert.equal(livePolicy.emailTestMode, false);

// Legacy 'Email Test' key fallback
const legacySheet = makeMockConfigSheet([
  ['Email Test', 'Yes', ''],
  ['Site Q', 'Little John', 'siteq@example.com'],
]);
const legacyPolicy = readEmailDeliveryPolicyFromSheet_(legacySheet);
assert.equal(legacyPolicy.emailTestMode, true);

// null configSheet (no Config sheet found) → safe defaults
const nullPolicy = readEmailDeliveryPolicyFromSheet_(null);
assert.equal(nullPolicy.emailTestMode, false);
assert.equal(nullPolicy.siteQEmail, '');

// ManagedConfigSheet.getValue() returns scalar; getPair() returns {primary, secondary}
const directSheet = makeMockConfigSheet([
  ['NameSpace', 'F3 Go30', ''],
  ['Site Q', 'Iron Pax', 'ironpax@example.com'],
]);
assert.equal(directSheet.getValue('NameSpace'), 'F3 Go30');
assert.equal(directSheet.getValue('Site Q'), 'Iron Pax');
assert.deepEqual(directSheet.getPair('Site Q'), { primary: 'Iron Pax', secondary: 'ironpax@example.com' });
assert.equal(directSheet.getValue('Missing Key'), null);
assert.equal(directSheet.getPair('Missing Key'), null);

console.log('test_nag.js: PASS');