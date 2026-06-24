const assert = require('node:assert/strict');

const {
  _mergeTrackerDbRowsForScan_,
  _carryForwardLifecycleFields_,
  resolveTrackerDbRowForContextDate_
} = require('../script/go30tools.js');

// Scanned row wins over an existing row for the same SheetId.
assert.deepEqual(
  _mergeTrackerDbRowsForScan_(
    { 'sheet-a': { sheetId: 'sheet-a', totalPax: 5 } },
    [{ sheetId: 'sheet-a', totalPax: 12 }]
  ),
  [{ sheetId: 'sheet-a', totalPax: 12 }]
);

// A pre-existing row not touched by this scan (e.g. upserted directly by
// CreateNewTracker.js for a spreadsheet outside the scanned folder) survives.
assert.deepEqual(
  _mergeTrackerDbRowsForScan_(
    {
      'sheet-a': { sheetId: 'sheet-a', totalPax: 5 },
      'sheet-b': { sheetId: 'sheet-b', totalPax: 0, lastSignupAt: '2026-06-01' }
    },
    [{ sheetId: 'sheet-a', totalPax: 12 }]
  ),
  [
    { sheetId: 'sheet-a', totalPax: 12 },
    { sheetId: 'sheet-b', totalPax: 0, lastSignupAt: '2026-06-01' }
  ]
);

// No pre-existing rows -> scanned rows pass through unchanged.
assert.deepEqual(
  _mergeTrackerDbRowsForScan_({}, [{ sheetId: 'sheet-a', totalPax: 12 }]),
  [{ sheetId: 'sheet-a', totalPax: 12 }]
);

// Lifecycle timestamps carry forward unchanged when a tracker is re-scanned for an
// unrelated reason (e.g. its Tracker sheet was modified) — the scan itself never sets them.
assert.deepEqual(
  _carryForwardLifecycleFields_({
    sheetId: 'sheet-a',
    lastSignupAt: '2026-06-01',
    triggersInitializedAt: '2026-05-15',
    lastMinusOneRunAt: '2026-06-22',
    lastNagRunAt: '2026-06-20'
  }),
  {
    lastSignupAt: '2026-06-01',
    triggersInitializedAt: '2026-05-15',
    lastMinusOneRunAt: '2026-06-22',
    lastNagRunAt: '2026-06-20'
  }
);

// Missing existing row or missing fields default to '' rather than throwing.
assert.deepEqual(
  _carryForwardLifecycleFields_(null),
  { lastSignupAt: '', triggersInitializedAt: '', lastMinusOneRunAt: '', lastNagRunAt: '' }
);
assert.deepEqual(
  _carryForwardLifecycleFields_({ sheetId: 'sheet-a', lastSignupAt: '2026-06-01' }),
  { lastSignupAt: '2026-06-01', triggersInitializedAt: '', lastMinusOneRunAt: '', lastNagRunAt: '' }
);

// resolveTrackerDbRowForContextDate_ — ADR-010 TrackerDB date-range matching rule (F3Go30-vr80)

const TRACKER_ROWS = [
  { sheetId: 'sheet-april', startDate: '2026-04-01' },
  { sheetId: 'sheet-may', startDate: '2026-05-01' },
  { sheetId: 'sheet-june', startDate: '2026-06-01' }
];

// Exact match: a context date inside a row's active range (its StartDate up to the
// next row's StartDate) resolves to that single row.
assert.equal(
  resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2026, 4, 15)).sheetId,
  'sheet-may'
);

// Exact match on the boundary date itself.
assert.equal(
  resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2026, 5, 1)).sheetId,
  'sheet-june'
);

// Exact match: the latest row's range is open-ended (no later row to bound it).
assert.equal(
  resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2027, 0, 1)).sheetId,
  'sheet-june'
);

// No match: a context date before the earliest row's StartDate fails loudly.
assert.throws(
  function() { resolveTrackerDbRowForContextDate_(TRACKER_ROWS, new Date(2026, 2, 1)); },
  /no TrackerDB row matches/
);

// No match: empty TrackerDB.
assert.throws(
  function() { resolveTrackerDbRowForContextDate_([], new Date(2026, 4, 15)); },
  /no TrackerDB row matches/
);

// Overlapping-range ambiguity: two rows share the same StartDate (e.g. a tracker was
// re-created for the same month) — any context date in that range must fail loudly,
// never silently pick one.
const AMBIGUOUS_ROWS = [
  { sheetId: 'sheet-may', startDate: '2026-05-01' },
  { sheetId: 'sheet-may-v2', startDate: '2026-05-01' },
  { sheetId: 'sheet-june', startDate: '2026-06-01' }
];
assert.throws(
  function() { resolveTrackerDbRowForContextDate_(AMBIGUOUS_ROWS, new Date(2026, 4, 15)); },
  /ambiguous match/
);

console.log('test_go30tools.js: PASS');
