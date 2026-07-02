const assert = require('node:assert/strict');

const {
  BONUS_TYPE_RULES_,
  validateBonusEntry_,
  formatBonusRowForClient_,
  findNextBonusRow_,
  addBonusEntry_,
} = require('../script/bonusWebapp.js');

// Minimal mock of the Bonus Tracker sheet shape needed by addBonusEntry_/findNextBonusRow_.
// maxRows mirrors a real Bonus Tracker sheet's pre-formatted physical row count (e.g. 892),
// which getLastRow() can equal even when every data row is still blank (leftover formatting from
// the template) — see F3Go30-yj53. names holds column-A values only, 0-indexed from row 2.
function makeMockBonusSheet_(maxRows, names) {
  var nameCol = names.slice();
  return {
    getMaxRows: function() { return maxRows; },
    getRange: function(row, col, numRows, numCols) {
      return {
        getValues: function() {
          var out = [];
          for (var i = 0; i < (numRows || 1); i++) {
            out.push([nameCol[row - 2 + i] || '']);
          }
          return out;
        },
        setValue: function(v) {
          if (col === 1) nameCol[row - 2] = v;
        },
      };
    },
  };
}

// ── validateBonusEntry_ ──────────────────────────────────────────────────
(function testValidateBonusEntryRejectsUnknownType() {
  var result = validateBonusEntry_({ type: 'Made Up Type', whenIso: '2026-06-01', message: 'did a thing' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_type');
})();

(function testValidateBonusEntryRejectsBadDate() {
  var result = validateBonusEntry_({ type: 'Fellowship', whenIso: 'not-a-date', message: 'did a thing' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_when');
})();

(function testValidateBonusEntryRejectsEmptyMessage() {
  var result = validateBonusEntry_({ type: 'Fellowship', whenIso: '2026-06-01', message: '   ' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'message_required');
})();

(function testValidateBonusEntryFellowshipNeedsNoLink() {
  var result = validateBonusEntry_({ type: 'Fellowship', whenIso: '2026-06-01', message: 'gathered with PAX' });
  assert.equal(result.ok, true);
})();

['EHing FNG', 'Q Point', 'Inspire'].forEach(function(type) {
  (function testLinkRequiredTypeRejectsMissingLink() {
    var result = validateBonusEntry_({ type: type, whenIso: '2026-06-01', message: 'did the thing' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'link_required');
  })();

  (function testLinkRequiredTypeRejectsMalformedLink() {
    var result = validateBonusEntry_({ type: type, whenIso: '2026-06-01', message: 'did the thing', link: 'not a url' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_link');
  })();

  (function testLinkRequiredTypeAcceptsValidLink() {
    var result = validateBonusEntry_({ type: type, whenIso: '2026-06-01', message: 'did the thing', link: 'https://f3nation.slack.com/archives/C1/p1234' });
    assert.equal(result.ok, true);
  })();
});

(function testBonusTypeRulesHasAllFourTypesWithExpectedLinkRequirement() {
  assert.deepEqual(Object.keys(BONUS_TYPE_RULES_).sort(), ['EHing FNG', 'Fellowship', 'Inspire', 'Q Point'].sort());
  assert.equal(BONUS_TYPE_RULES_['EHing FNG'].requiresLink, true);
  assert.equal(BONUS_TYPE_RULES_['Fellowship'].requiresLink, false);
  assert.equal(BONUS_TYPE_RULES_['Q Point'].requiresLink, true);
  assert.equal(BONUS_TYPE_RULES_['Inspire'].requiresLink, true);
})();

// ── formatBonusRowForClient_ ─────────────────────────────────────────────
(function testFormatBonusRowForClientMapsColumnsAndSerializesDate() {
  var when = new Date(2026, 5, 15);
  var row = ['Crazy Ivan', 3, '', 1, true, 'Fellowship', when, 'Coffee with PAX', ''];
  var formatted = formatBonusRowForClient_(row, 7);
  assert.equal(formatted.rowIndex, 7);
  assert.equal(formatted.type, 'Fellowship');
  assert.equal(formatted.whenIso, '2026-06-15'); // local calendar date, not when.toISOString() (UTC would shift it)
  assert.equal(formatted.message, 'Coffee with PAX');
  assert.equal(formatted.link, '');
  assert.equal(formatted.complete, true);
})();

(function testFormatBonusRowForClientPassesThroughIncompleteAndLink() {
  var when = new Date(2026, 5, 16);
  var row = ['Little John', 3, '', 1, false, 'Q Point', when, 'Led the workout', 'https://slack.example/backblast'];
  var formatted = formatBonusRowForClient_(row, 12);
  assert.equal(formatted.complete, false);
  assert.equal(formatted.link, 'https://slack.example/backblast');
})();

// ── findNextBonusRow_ / addBonusEntry_ ───────────────────────────────────
(function testFindNextBonusRowOnFreshSheetWithNoRealDataReturnsRow2() {
  // Reproduces F3Go30-yj53: a freshly-reset Bonus Tracker has no real data, but its formatted
  // extent (maxRows) equals what getLastRow() would report — findNextBonusRow_ must not treat
  // that as "sheet full of data" the way the old getLastRow()-based append logic did.
  var sheet = makeMockBonusSheet_(892, []);
  assert.equal(findNextBonusRow_(sheet), 2);
})();

(function testFindNextBonusRowSkipsExistingEntries() {
  var sheet = makeMockBonusSheet_(892, ['Little John', 'Crazy Ivan']);
  assert.equal(findNextBonusRow_(sheet), 4);
})();

(function testFindNextBonusRowReturnsNullWhenSheetFull() {
  var sheet = makeMockBonusSheet_(3, ['Little John', 'Crazy Ivan']);
  assert.equal(findNextBonusRow_(sheet), null);
})();

(function testAddBonusEntryOnFreshLargeSheetDoesNotThrowOutOfBounds() {
  // Before the fix, addBonusEntry_ used bonusSheet.getLastRow() (here indistinguishable from a
  // sheet whose 892 rows are all pre-formatted but empty) to compute nextRow = lastRow + 1,
  // landing one row past the sheet's real bounds and throwing on getRange().
  var sheet = makeMockBonusSheet_(892, []);
  var result = addBonusEntry_(sheet, 'Little John', {
    type: 'Fellowship', whenIso: '2026-06-01', message: 'gathered with PAX',
  });
  assert.equal(result.ok, true);
  assert.equal(result.rowIndex, 2);
})();

(function testAddBonusEntryReturnsErrorWhenSheetFull() {
  var sheet = makeMockBonusSheet_(2, ['Little John']);
  var result = addBonusEntry_(sheet, 'Crazy Ivan', {
    type: 'Fellowship', whenIso: '2026-06-01', message: 'gathered with PAX',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'bonus_sheet_full');
})();

console.log('test_bonus_webapp.js: all assertions passed');
