const assert = require('node:assert/strict');

function makeFakeScriptCache_() {
  var store = {};
  return {
    get: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    put: function(key, value) { store[key] = value; },
    remove: function(key) { delete store[key]; },
    _store: store,
  };
}

var fakeScriptCache_ = makeFakeScriptCache_();
global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

// In-memory stand-in for LockService.getScriptLock() — single-process tests never contend, so
// this just needs to satisfy the waitLock/releaseLock contract addBonusEntry_/editBonusEntry_/
// clearBonusEntry_ rely on.
global.LockService = {
  getScriptLock: function() {
    return { waitLock: function() {}, releaseLock: function() {} };
  },
};
global.GasLogger = { log: function() {}, run: function(name, fn) { return fn(); } };

const {
  BONUS_TYPE_RULES_,
  validateBonusEntry_,
  formatBonusRowForClient_,
  findNextBonusRow_,
  addBonusEntry_,
  editBonusEntry_,
  clearBonusEntry_,
  findBonusRowByIdentity_,
  readAllBonusEntries_,
  serializeBonusEntriesForCache_,
  deserializeBonusEntriesFromCache_,
  getCachedBonusEntriesOnly_,
  getAllBonusEntriesCached_,
  getAllBonusRowsCached_,
  listBonusEntriesForPax_,
  invalidateBonusEntriesCache_,
  bonusEntriesCacheKey_,
  bonusRowsCacheKey_,
} = require('../script/bonusWebapp.js');

// Minimal mock of the Bonus Tracker sheet shape needed by addBonusEntry_/findNextBonusRow_/
// editBonusEntry_/clearBonusEntry_. maxRows mirrors a real Bonus Tracker sheet's pre-formatted
// physical row count (e.g. 892), which getLastRow() can equal even when every data row is still
// blank (leftover formatting from the template) — see F3Go30-yj53. names holds column-A values
// only (other columns blank), 0-indexed from row 2 — for tests that don't care about the rest of
// the row. fullRows (optional) backs the full row shape [name, period, uncapped, multiplier,
// complete, type, when, what, link] — needed by tests that read/match beyond column A (including
// findBonusRowByIdentity_'s content match). Single backing store (rows) so single-cell and
// multi-column reads/writes stay consistent with each other, matching real Sheet semantics.
function makeMockBonusSheet_(maxRows, names, fullRows) {
  var rows = (fullRows || names.map(function(n) { return [n]; })).map(function(r) { return r.slice(); });
  function cell(r, c) {
    var row = rows[r - 2];
    if (!row) return '';
    var v = row[c - 1];
    return v === undefined ? '' : v;
  }
  function setCell(r, c, v) {
    if (!rows[r - 2]) rows[r - 2] = [];
    rows[r - 2][c - 1] = v;
  }
  return {
    getMaxRows: function() { return maxRows; },
    getLastRow: function() { return rows.length + 1; }, // +1: header row
    getParent: function() { return { getId: function() { return 'sheet-under-test'; } }; },
    getRange: function(row, col, numRows, numCols) {
      var nR = numRows || 1, nC = numCols || 1;
      return {
        getValues: function() {
          var out = [];
          for (var i = 0; i < nR; i++) {
            var line = [];
            for (var c = 0; c < nC; c++) line.push(cell(row + i, col + c));
            out.push(line);
          }
          return out;
        },
        getValue: function() { return cell(row, col); },
        setValue: function(v) { setCell(row, col, v); },
        clearContent: function() { setCell(row, col, ''); },
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

// ── readAllBonusEntries_ ─────────────────────────────────────────────────
(function testReadAllBonusEntriesParsesEveryPaxAndSkipsBlankRows() {
  var when1 = new Date(2026, 6, 2);
  var when2 = new Date(2026, 6, 3);
  var fullRows = [
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', when1, 'Coffee', ''],
    ['', '', '', '', '', '', '', '', ''], // blank row, must be skipped
    ['Little John', 1, 5, 5, true, 'EHing FNG', when2, 'Brought a friend', 'https://slack.example/1'],
  ];
  var sheet = makeMockBonusSheet_(892, ['Crazy Ivan', '', 'Little John'], fullRows);
  var entries = readAllBonusEntries_(sheet);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'Crazy Ivan');
  assert.equal(entries[0].nameNorm, 'crazy ivan');
  assert.equal(entries[0].date.getTime(), when1.getTime());
  assert.equal(entries[0].type, 'Fellowship');
  assert.equal(entries[0].complete, true);
  assert.equal(entries[1].name, 'Little John');
  assert.equal(entries[1].type, 'EHing FNG');
})();

(function testReadAllBonusEntriesSkipsRowsWithoutAValidDate() {
  var fullRows = [
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', '', 'Coffee', ''],
  ];
  var sheet = makeMockBonusSheet_(892, ['Crazy Ivan'], fullRows);
  assert.equal(readAllBonusEntries_(sheet).length, 0);
})();

// ── serialize/deserialize round-trip ──────────────────────────────────────
(function testBonusEntriesCacheRoundTripsDatesAndFields() {
  var entries = [
    { name: 'Crazy Ivan', nameNorm: 'crazy ivan', date: new Date(2026, 6, 2), type: 'Fellowship', complete: true },
  ];
  var restored = deserializeBonusEntriesFromCache_(serializeBonusEntriesForCache_(entries));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].date.getTime(), entries[0].date.getTime());
  assert.deepEqual(restored[0], entries[0]);
})();

// ── getAllBonusEntriesCached_ / invalidateBonusEntriesCache_ ──────────────
(function testGetAllBonusEntriesCachedReadsSheetOnceThenServesFromCache() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var when = new Date(2026, 6, 2);
  var fullRows = [['Crazy Ivan', 1, '', 1, true, 'Fellowship', when, 'Coffee', '']];
  var sheet = makeMockBonusSheet_(892, ['Crazy Ivan'], fullRows);
  var readSpy = sheet.getRange;
  var readCount = 0;
  sheet.getRange = function() { readCount++; return readSpy.apply(sheet, arguments); };

  var first = getAllBonusEntriesCached_(sheet, 'sheet-x');
  assert.equal(first.length, 1);
  var readsAfterFirst = readCount;

  // Second call for the same sheetId must be served from cache — no additional getRange calls.
  var second = getAllBonusEntriesCached_(sheet, 'sheet-x');
  assert.equal(second.length, 1);
  assert.equal(second[0].date.getTime(), when.getTime());
  assert.equal(readCount, readsAfterFirst);
})();

// getCachedBonusEntriesOnly_ (F3Go30-440b.6) — cache-only half, so a caller (handleCheckinDashboard_)
// can find out whether it can skip opening the spreadsheet for the Bonus Tracker sheet entirely
// before paying for that open. Miss returns null (never a bonusSheet param needed to check).
(function testGetCachedBonusEntriesOnlyMissThenHitAfterWarm() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };
  assert.equal(getCachedBonusEntriesOnly_('sheet-z'), null);

  var when = new Date(2026, 6, 2);
  var fullRows = [['Crazy Ivan', 1, '', 1, true, 'Fellowship', when, 'Coffee', '']];
  var sheet = makeMockBonusSheet_(892, ['Crazy Ivan'], fullRows);
  getAllBonusEntriesCached_(sheet, 'sheet-z');

  var cached = getCachedBonusEntriesOnly_('sheet-z');
  assert.equal(cached.length, 1);
  assert.equal(cached[0].date.getTime(), when.getTime());
})();

(function testInvalidateBonusEntriesCacheForcesFreshReadOnNextCall() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var fullRows = [['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 6, 2), 'Coffee', '']];
  var sheet = makeMockBonusSheet_(892, ['Crazy Ivan'], fullRows);
  getAllBonusEntriesCached_(sheet, 'sheet-y');
  assert.ok(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-y')));

  invalidateBonusEntriesCache_('sheet-y');
  assert.equal(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-y')), null);
})();

// ── getAllBonusRowsCached_ / listBonusEntriesForPax_ ──────────────────────
(function testGetAllBonusRowsCachedReadsSheetOnceThenServesFromCache() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var fullRows = [
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 6, 2), 'Coffee', ''],
    ['Little John', 1, 5, 5, true, 'EHing FNG', new Date(2026, 6, 3), 'Brought a friend', 'https://slack.example/1'],
  ];
  var sheet = makeMockBonusSheet_(892, null, fullRows);
  var readSpy = sheet.getRange;
  var readCount = 0;
  sheet.getRange = function() { readCount++; return readSpy.apply(sheet, arguments); };

  var first = getAllBonusRowsCached_(sheet, 'sheet-rows');
  assert.equal(first.length, 2);
  assert.equal(first[0].name, 'Crazy Ivan');
  assert.equal(first[0].rowIndex, 2);
  var readsAfterFirst = readCount;

  var second = getAllBonusRowsCached_(sheet, 'sheet-rows');
  assert.equal(second.length, 2);
  assert.equal(readCount, readsAfterFirst); // served from cache — no additional getRange calls
})();

(function testListBonusEntriesForPaxFiltersToOwnRowsOnlyAndOmitsNameFields() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var fullRows = [
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 6, 2), 'Coffee', ''],
    ['Little John', 1, 5, 5, true, 'EHing FNG', new Date(2026, 6, 3), 'Brought a friend', 'https://slack.example/1'],
  ];
  var sheet = makeMockBonusSheet_(892, null, fullRows);
  var entries = listBonusEntriesForPax_(sheet, 'Little John', 'sheet-rows-2');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rowIndex, 3);
  assert.equal(entries[0].type, 'EHing FNG');
  assert.equal(entries[0].link, 'https://slack.example/1');
  assert.equal('name' in entries[0], false);
})();

(function testListBonusEntriesForPaxReusesCacheAcrossCallsForDifferentPax() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var fullRows = [makeLittleJohnFellowshipRow_(), ['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 5, 5), 'ruck', '']];
  var sheet = makeMockBonusSheet_(892, null, fullRows);
  var readSpy = sheet.getRange;
  var readCount = 0;
  sheet.getRange = function() { readCount++; return readSpy.apply(sheet, arguments); };

  listBonusEntriesForPax_(sheet, 'Little John', 'sheet-rows-3');
  var readsAfterFirst = readCount;
  // A different PAX opening the same month's bonus page right after should also hit the cache.
  var crazyIvanEntries = listBonusEntriesForPax_(sheet, 'Crazy Ivan', 'sheet-rows-3');
  assert.equal(crazyIvanEntries.length, 1);
  assert.equal(readCount, readsAfterFirst);
})();

(function testInvalidateBonusEntriesCacheClearsBothCacheKeys() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  getAllBonusEntriesCached_(sheet, 'sheet-both');
  getAllBonusRowsCached_(sheet, 'sheet-both');
  assert.ok(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-both')));
  assert.ok(fakeScriptCache_.get(bonusRowsCacheKey_('sheet-both')));

  invalidateBonusEntriesCache_('sheet-both');
  assert.equal(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-both')), null);
  assert.equal(fakeScriptCache_.get(bonusRowsCacheKey_('sheet-both')), null);
})();

// ── write-through cache patching (F3Go30-o39s.6) ──────────────────────────
// addBonusEntry_/editBonusEntry_/clearBonusEntry_ now patch go30dash:bonusRows and
// go30dash:bonusEntries in place instead of deleting them on every write — the next read for the
// same sheet must be a cache HIT reflecting the write, proven below by stubbing the underlying
// sheet read to throw so any accidental reread fails the test loudly.

(function testAddBonusEntryPatchesBothCachesWithoutRereadingSheet() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  // Warm both caches with real pre-write data (Little John's existing row only).
  getAllBonusEntriesCached_(sheet, 'sheet-under-test');
  getAllBonusRowsCached_(sheet, 'sheet-under-test');

  var result = addBonusEntry_(sheet, 'Crazy Ivan', { type: 'Fellowship', whenIso: '2026-06-02', message: 'gathered with PAX' });
  assert.equal(result.ok, true);
  assert.equal(result.rowIndex, 3); // Little John occupies row 2 — next blank pre-formatted row is 3

  sheet.getRange = function() { throw new Error('must not reread the sheet — cache should be patched'); };

  var rows = getAllBonusRowsCached_(sheet, 'sheet-under-test');
  assert.equal(rows.length, 2);
  var addedRow = rows.filter(function(r) { return r.name === 'Crazy Ivan'; })[0];
  assert.ok(addedRow);
  assert.equal(addedRow.rowIndex, 3);
  assert.equal(addedRow.type, 'Fellowship');
  assert.equal(addedRow.whenIso, '2026-06-02');
  assert.equal(addedRow.complete, true);

  var entries = getAllBonusEntriesCached_(sheet, 'sheet-under-test');
  assert.equal(entries.length, 2);
  var addedEntry = entries.filter(function(e) { return e.name === 'Crazy Ivan'; })[0];
  assert.ok(addedEntry);
  assert.equal(addedEntry.nameNorm, 'crazy ivan');
  assert.equal(addedEntry.type, 'Fellowship');
  assert.equal(addedEntry.date.getTime(), new Date(2026, 5, 2).getTime());
  assert.equal(addedEntry.complete, true);
})();

(function testAddBonusEntryFallsBackToInvalidateOnRowIndexCollision() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, []);
  // Simulate a corrupt/stale bonusRows cache that already claims row 2 — the row findNextBonusRow_
  // is about to hand out — so the patch's own-collision guard must trip instead of silently
  // clobbering or duplicating that entry.
  fakeScriptCache_.put(bonusRowsCacheKey_('sheet-under-test'), JSON.stringify([{ rowIndex: 2, name: 'Ghost', type: 'Fellowship' }]));
  fakeScriptCache_.put(bonusEntriesCacheKey_('sheet-under-test'), JSON.stringify([{ name: 'Ghost', nameNorm: 'ghost', type: 'Fellowship', dateIso: '2026-06-01', complete: true }]));

  var result = addBonusEntry_(sheet, 'Little John', { type: 'Fellowship', whenIso: '2026-06-01', message: 'gathered with PAX' });
  assert.equal(result.ok, true);
  assert.equal(fakeScriptCache_.get(bonusRowsCacheKey_('sheet-under-test')), null);
  assert.equal(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-under-test')), null);
})();

function makeLittleJohnFellowshipRow_() {
  return ['Little John', 1, '', 1, true, 'Fellowship', new Date(2026, 5, 1), 'old message', ''];
}
var LITTLE_JOHN_SNAPSHOT_ = { type: 'Fellowship', whenIso: '2026-06-01', message: 'old message', link: '' };

(function testEditBonusEntryInvalidatesCacheForItsSheet() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  fakeScriptCache_.put(bonusEntriesCacheKey_('sheet-under-test'), JSON.stringify([{ stale: true }]));
  var result = editBonusEntry_(sheet, 'Little John', 2, { type: 'Fellowship', whenIso: '2026-06-01', message: 'updated' }, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, true);
  assert.equal(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-under-test')), null);
})();

(function testEditBonusEntryPatchesBothCachesWithoutRereadingSheet() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  getAllBonusEntriesCached_(sheet, 'sheet-under-test');
  getAllBonusRowsCached_(sheet, 'sheet-under-test');

  var result = editBonusEntry_(sheet, 'Little John', 2, { type: 'Q Point', whenIso: '2026-06-01', message: 'updated', link: 'https://f3nation.slack.com/archives/C1/p1' }, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, true);

  sheet.getRange = function() { throw new Error('must not reread the sheet — cache should be patched'); };

  var rows = getAllBonusRowsCached_(sheet, 'sheet-under-test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowIndex, 2);
  assert.equal(rows[0].type, 'Q Point');
  assert.equal(rows[0].message, 'updated');
  assert.equal(rows[0].link, 'https://f3nation.slack.com/archives/C1/p1');

  var entries = getAllBonusEntriesCached_(sheet, 'sheet-under-test');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'Q Point');
  assert.equal(entries[0].nameNorm, 'little john');
})();

(function testEditBonusEntryFallsBackToScanWhenRowIndexHintIsStale() {
  // Simulates a manually re-sorted sheet: the entry the client loaded at row 2 is now at row 3,
  // and row 2 holds someone else's entry. The stale hint must not be trusted — the write should
  // land on the row that actually matches the pre-edit snapshot.
  var sheet = makeMockBonusSheet_(892, null, [
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 5, 5), 'ruck', ''],
    makeLittleJohnFellowshipRow_(),
  ]);
  var result = editBonusEntry_(sheet, 'Little John', 2, { type: 'Fellowship', whenIso: '2026-06-01', message: 'updated' }, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, true);
  assert.equal(result.rowIndex, 3);
  assert.equal(sheet.getRange(3, 8).getValue(), 'updated');
  assert.equal(sheet.getRange(2, 8).getValue(), 'ruck'); // Crazy Ivan's row untouched
})();

(function testEditBonusEntryReturnsNotFoundWhenSnapshotDoesNotMatchAnyRow() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  var staleSnapshot = { type: 'Fellowship', whenIso: '2026-05-01', message: 'gone', link: '' };
  var result = editBonusEntry_(sheet, 'Little John', 2, { type: 'Fellowship', whenIso: '2026-06-01', message: 'updated' }, staleSnapshot);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_found');
})();

(function testEditBonusEntryReturnsNotFoundForWrongOwnerEvenWithMatchingContent() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  var result = editBonusEntry_(sheet, 'Crazy Ivan', 2, { type: 'Fellowship', whenIso: '2026-06-01', message: 'updated' }, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_found');
})();

// ── clearBonusEntry_ ─────────────────────────────────────────────────────
(function testClearBonusEntryRejectsWrongOwner() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  var result = clearBonusEntry_(sheet, 'Crazy Ivan', 2, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_found');
})();

(function testClearBonusEntryRejectsMissingSnapshot() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  assert.equal(clearBonusEntry_(sheet, 'Little John', 2, null).error, 'not_found');
})();

(function testClearBonusEntryClearsRowForOwner() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  var result = clearBonusEntry_(sheet, 'Little John', 2, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, true);
  assert.equal(sheet.getRange(2, 1).getValue(), '');
})();

(function testClearBonusEntryInvalidatesCacheForItsSheet() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  fakeScriptCache_.put(bonusEntriesCacheKey_('sheet-under-test'), JSON.stringify([{ stale: true }]));
  var result = clearBonusEntry_(sheet, 'Little John', 2, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, true);
  assert.equal(fakeScriptCache_.get(bonusEntriesCacheKey_('sheet-under-test')), null);
})();

(function testClearBonusEntryPatchesBothCachesWithoutRereadingSheet() {
  fakeScriptCache_ = makeFakeScriptCache_();
  global.CacheService = { getScriptCache: function() { return fakeScriptCache_; } };

  var sheet = makeMockBonusSheet_(892, null, [
    makeLittleJohnFellowshipRow_(),
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 5, 5), 'ruck', ''],
  ]);
  getAllBonusEntriesCached_(sheet, 'sheet-under-test');
  getAllBonusRowsCached_(sheet, 'sheet-under-test');

  var result = clearBonusEntry_(sheet, 'Little John', 2, LITTLE_JOHN_SNAPSHOT_);
  assert.equal(result.ok, true);

  sheet.getRange = function() { throw new Error('must not reread the sheet — cache should be patched'); };

  var rows = getAllBonusRowsCached_(sheet, 'sheet-under-test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Crazy Ivan');

  var entries = getAllBonusEntriesCached_(sheet, 'sheet-under-test');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].nameNorm, 'crazy ivan');
})();

// ── findBonusRowByIdentity_ ──────────────────────────────────────────────
(function testFindBonusRowByIdentityUsesHintFastPathWhenItMatches() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  assert.equal(findBonusRowByIdentity_(sheet, 'Little John', LITTLE_JOHN_SNAPSHOT_, 2), 2);
})();

(function testFindBonusRowByIdentityScansWhenHintIsWrong() {
  var sheet = makeMockBonusSheet_(892, null, [
    ['Crazy Ivan', 1, '', 1, true, 'Fellowship', new Date(2026, 5, 5), 'ruck', ''],
    makeLittleJohnFellowshipRow_(),
  ]);
  assert.equal(findBonusRowByIdentity_(sheet, 'Little John', LITTLE_JOHN_SNAPSHOT_, 2), 3);
})();

(function testFindBonusRowByIdentityReturnsNullWithoutSnapshot() {
  var sheet = makeMockBonusSheet_(892, null, [makeLittleJohnFellowshipRow_()]);
  assert.equal(findBonusRowByIdentity_(sheet, 'Little John', null, 2), null);
  assert.equal(findBonusRowByIdentity_(sheet, 'Little John', {}, 2), null);
})();

console.log('test_bonus_webapp.js: all assertions passed');
