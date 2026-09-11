const assert = require('node:assert/strict');

const {
  TRACKER_DATA_SHEET_NAMES_,
  planTrackerDataSheetCopy_,
  planTrackerDataColumnOverlay_,
  copyCurrentMonthTrackerDataFromSource_
} = require('../script/CopyTemplate.js');

// F3Go30-956l AC5: fixed sheet set is Tracker, Bonus Tracker, Responses (source-of-truth for
// what gets replaced).
assert.deepEqual(TRACKER_DATA_SHEET_NAMES_, ['Tracker', 'Bonus Tracker', 'Responses']);

// All three present on source -> all planned to copy.
assert.deepEqual(
  planTrackerDataSheetCopy_(TRACKER_DATA_SHEET_NAMES_, { 'Tracker': true, 'Bonus Tracker': true, 'Responses': true }),
  [
    { name: 'Tracker', action: 'copy' },
    { name: 'Bonus Tracker', action: 'copy' },
    { name: 'Responses', action: 'copy' }
  ]
);

// AC5: a sheet missing from the source is planned to skip, not a hard failure.
assert.deepEqual(
  planTrackerDataSheetCopy_(TRACKER_DATA_SHEET_NAMES_, { 'Tracker': true, 'Bonus Tracker': true }),
  [
    { name: 'Tracker', action: 'copy' },
    { name: 'Bonus Tracker', action: 'copy' },
    { name: 'Responses', action: 'skip' }
  ]
);

// Empty/undefined presence map -> everything skipped, no throw.
assert.deepEqual(
  planTrackerDataSheetCopy_(TRACKER_DATA_SHEET_NAMES_, {}),
  [
    { name: 'Tracker', action: 'skip' },
    { name: 'Bonus Tracker', action: 'skip' },
    { name: 'Responses', action: 'skip' }
  ]
);

// F3Go30-956l live-fix: an all-plain column on both sides is safe to copy whole.
assert.deepEqual(
  planTrackerDataColumnOverlay_(
    [['', ''], ['', '']],
    [['', ''], ['', '']],
    2, 2
  ),
  [{ col: 0, action: 'copy' }, { col: 1, action: 'copy' }]
);

// A column containing a formula ANYWHERE in the destination (e.g. one row's calculated total)
// is skipped in its entirety -- never partially overwritten, which would have destroyed the
// formula when written back via one Range.setValues() call (the bug this replaces).
assert.deepEqual(
  planTrackerDataColumnOverlay_(
    [['', ''], ['', '']],
    [['', ''], ['', '=SUM(A1:A1)']],
    2, 2
  ),
  [{ col: 0, action: 'copy' }, { col: 1, action: 'skip' }]
);

// A column containing a formula anywhere in the SOURCE is likewise skipped entirely -- its
// formula text must never be copied in literally.
assert.deepEqual(
  planTrackerDataColumnOverlay_(
    [['', ''], ['', '=SUM(A1:A1)']],
    [['', ''], ['', '']],
    2, 2
  ),
  [{ col: 0, action: 'copy' }, { col: 1, action: 'skip' }]
);

// Source has more columns than destination -> plan extends to cover the extra column(s).
assert.deepEqual(
  planTrackerDataColumnOverlay_(
    [['', '', '']],
    [['', '']],
    3, 2
  ),
  [{ col: 0, action: 'copy' }, { col: 1, action: 'copy' }, { col: 2, action: 'copy' }]
);

// copyCurrentMonthTrackerDataFromSource_ validates sourceTemplateId before touching any
// Drive/Sheets API (AC2's missing-id guard) — checkable without a live GAS environment.
assert.throws(
  function() { copyCurrentMonthTrackerDataFromSource_('', {}, null, function() {}); },
  /sourceTemplateId is required/
);
assert.throws(
  function() { copyCurrentMonthTrackerDataFromSource_(null, {}, null, function() {}); },
  /sourceTemplateId is required/
);

console.log('test_copy_prod_tracker_to_sit.js: all assertions passed');
