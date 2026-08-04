const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// F3Go30-833s.16: at save time, a bonus entry that lands counts=false (already credited this
// weekly period — the "Crazy Ivan" scenario in this issue's WHY) must tell the PAX immediately
// that it added no points, not just show up subdued in the list on next glance. This extracts
// the real hideBonusSaveNotice_/showBonusSaveNotice_/reportBonusSaveOutcome_ block out of
// index.html and runs it in a same-realm `Function` sandbox (same technique
// test_static_page_client_invariants.js uses for the cal-nav block) so these tests execute the
// SAME source the browser does, not just pattern-match tokens.

function readSrc_(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

function extractNoticeBlock_(src) {
  var startMarker = 'function hideBonusSaveNotice_()';
  var endMarker = /\n  function openBonusForm_/;
  var startIdx = src.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'hideBonusSaveNotice_ not found');
  var endMatch = src.slice(startIdx).match(endMarker);
  assert.ok(endMatch, 'openBonusForm_ marker not found after hideBonusSaveNotice_');
  return src.slice(startIdx, startIdx + endMatch.index);
}

function isoDate_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function makeNoticeHarness_(src, state) {
  var notice = { hidden: true, text: '' };
  function fakeEl_(id) {
    assert.equal(id, 'bonusSaveNotice', 'notice block must only touch #bonusSaveNotice');
    return {
      get textContent() { return notice.text; },
      set textContent(v) { notice.text = v; },
      classList: {
        add: function(c) { if (c === 'hidden') notice.hidden = true; },
        remove: function(c) { if (c === 'hidden') notice.hidden = false; },
      },
    };
  }
  var factory = new Function('state', '$', 'isoDate_',
    extractNoticeBlock_(src) + '\nreturn { hideBonusSaveNotice_: hideBonusSaveNotice_, showBonusSaveNotice_: showBonusSaveNotice_, reportBonusSaveOutcome_: reportBonusSaveOutcome_ };'
  );
  var fns = factory(state, fakeEl_, isoDate_);
  return { fns: fns, notice: notice };
}

function runNoticeTests_(label, src) {
  // Capped save (weekly cap already credited) — must surface an explicit notice.
  (function testCappedSaveShowsNotice() {
    var state = {
      viewDate: new Date(2026, 6, 22), // 2026-07-22
      bonusEntries: [
        { rowIndex: 5, type: 'Fellowship', complete: true, counts: false },
        { rowIndex: 3, type: 'Fellowship', complete: true, counts: true },
      ],
    };
    var h = makeNoticeHarness_(src, state);
    h.fns.reportBonusSaveOutcome_(5, '2026-07-20');
    assert.equal(h.notice.hidden, false, label + ': notice must be shown for a capped save');
    assert.match(h.notice.text, /Fellowship/, label + ": notice must name the bonus type");
    assert.match(h.notice.text, /won.t add points|does not add points|no points/i, label + ': notice must say plainly it adds no points');
  })();

  // Uncounted-but-uncapped save (normal, counting entry) — must NOT show a notice.
  (function testCountingSaveHidesNotice() {
    var state = {
      viewDate: new Date(2026, 6, 22),
      bonusEntries: [
        { rowIndex: 3, type: 'Fellowship', complete: true, counts: true },
      ],
    };
    var h = makeNoticeHarness_(src, state);
    h.notice.hidden = false; // simulate a stale notice left over from a prior save
    h.fns.reportBonusSaveOutcome_(3, '2026-07-22');
    assert.equal(h.notice.hidden, true, label + ': notice must be hidden when the saved entry counts');
  })();

  // Cross-month save: rowIndex is only unique within one month's sheet, so a save that lands in
  // a different month's sheet than the one currently viewed must not trust a rowIndex match
  // against the *viewed* month's list — it could coincidentally collide with an unrelated entry.
  (function testCrossMonthSaveDoesNotTrustRowIndexCollision() {
    var state = {
      viewDate: new Date(2026, 6, 22), // viewing July
      bonusEntries: [
        // An entry that happens to share rowIndex 5 in the viewed (July) month's list, and would
        // incorrectly read as "capped" if the guard were missing.
        { rowIndex: 5, type: 'Fellowship', complete: true, counts: false },
      ],
    };
    var h = makeNoticeHarness_(src, state);
    // Saved entry's whenIso is in August — a different month than the one currently viewed.
    h.fns.reportBonusSaveOutcome_(5, '2026-08-03');
    assert.equal(h.notice.hidden, true, label + ': must not show a notice built from a different month\'s list');
  })();

  // Incomplete entries (needs link) never count regardless of the weekly cap — must not be
  // mislabeled as a capped/"extra" notice.
  (function testIncompleteSaveHidesNotice() {
    var state = {
      viewDate: new Date(2026, 6, 22),
      bonusEntries: [
        { rowIndex: 9, type: 'Q Point', complete: false, counts: true },
      ],
    };
    var h = makeNoticeHarness_(src, state);
    h.fns.reportBonusSaveOutcome_(9, '2026-07-22');
    assert.equal(h.notice.hidden, true, label + ': an incomplete entry must not trigger the capped-save notice');
  })();
}

runNoticeTests_('index.html', readSrc_(path.join('static-pages', 'src', 'index.html')));

console.log('test_bonus_save_notice.js OK');
