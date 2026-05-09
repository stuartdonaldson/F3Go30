const assert = require('node:assert/strict');

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

assert.equal(message.subject, 'Go30 Reminder | Team Test | Missing check-ins for 05/08/2026');
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

console.log('test_nag.js: PASS');