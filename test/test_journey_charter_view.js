// Stops docs/atdd/project-testing-guide.md §6 drifting from test/contract/journeyCharter.js
// (F3Go30-emwk.9 — T1/T15/T17/T21/T22, ADR-0011 §Decision 5, I6). Network-free: reads one
// checked-in markdown file and three data modules.
//
// §6 is the charter a [TST] author reads and test-functional Step 1 selects a disposition against.
// It is a VIEW of the module — the module is the source. Three failure modes are covered, and the
// last matters as much as the first two:
//
//   1. the doc names a journey, AC id, entry point or tier the module does not      -> fail
//   2. the module names one the doc does not                                        -> fail
//   3. the table was reworded so the rows can no longer be parsed                   -> ALSO fail
//
// (3) is why nothing here matches optionally. A check that quietly passes when it can no longer
// find what it is checking is worse than no check — the reference implementation's §7 view drifted
// silently (32/22 stated against an actual 37/13) exactly that way.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const charterPath = path.join(__dirname, 'contract', 'journeyCharter.js');
const {
  JOURNEY_CHARTER,
  MERGE_CANDIDATES,
  TIER_EXCLUDED,
  claimedEntryPoints,
  coveredEntryPoints,
  charterCounts,
  assertCharterWellFormed,
  assertDeferralIsComputed,
  assertNoUnrecordedMergeCandidates,
} = require(charterPath);

const guidePath = path.join(__dirname, '..', 'docs', 'atdd', 'project-testing-guide.md');
const guide = fs.readFileSync(guidePath, 'utf8');

// --- the charter is internally well formed ------------------------------------------------------

assertCharterWellFormed();

// Every entry point a journey claims exists, is not deferred, and together they are EXACTLY the
// registry's covered set. This is the join F3Go30-emwk.9 exists to close: before it,
// ENTRY_POINT_DEFERRED's complement was authored, with nothing asserting a journey drives it.
assertDeferralIsComputed();

assert.deepEqual(
  claimedEntryPoints(),
  coveredEntryPoints(),
  'the set of entry points journeys drive must equal the registry\'s covered set'
);

// A journey whose ACs are a subset of another's is a merge candidate. It is RECORDED, never merged
// by this check — see journeyCharter.js MERGE_CANDIDATES.
assertNoUnrecordedMergeCandidates();

// The subset detector has to actually fire, or it is decoration. Run its predicate over a poisoned
// pair rather than mutating the live charter.
{
  const a = new Set(['checkin submit-writes-day']);
  const b = new Set(['checkin submit-writes-day', 'checkin write-through-overlay']);
  assert.ok(
    [...a].every((id) => b.has(id)) && a.size < b.size,
    'the merge-candidate predicate must detect a strict AC subset — a guard that never fires is decoration'
  );
}

for (const [key, reason] of Object.entries(MERGE_CANDIDATES)) {
  assert.match(reason, /F3Go30-[a-z0-9]+(\.\d+)?/, `merge candidate "${key}" carries no bead id`);
}

// --- §6's journey table is a view of the module -------------------------------------------------

/**
 * Parse §6's charter table into {journey: {entryPoints, acIds, tier, status}}.
 * Cells are backticked lists joined by " · "; the AC-ids and entry-point cells use "—" for none.
 */
function parseCharterTable(text) {
  const section = text.split('\n## 6.')[1];
  assert.ok(section, 'project-testing-guide.md has no §6 — the charter section was renamed or removed');
  const body = section.split('\n## ')[0];

  const rows = {};
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    const journey = cells[0].replace(/`/g, '').trim();
    if (!journey || journey === 'Journey (spec)' || /^-+$/.test(journey)) continue;
    const list = (cell) =>
      cell === '—' || cell === ''
        ? []
        : cell.split('·').map((c) => c.replace(/`/g, '').trim()).filter(Boolean);
    rows[journey] = {
      entryPoints: list(cells[2]),
      acIds: list(cells[3]),
      tier: cells[5].replace(/\*\*/g, '').trim(),
      status: cells[6].trim(),
    };
  }
  return rows;
}

const docRows = parseCharterTable(guide);

assert.deepEqual(
  Object.keys(docRows).sort(),
  Object.keys(JOURNEY_CHARTER).sort(),
  'project-testing-guide.md §6 lists different journeys than journeyCharter.js — regenerate the ' +
    'table; do not relax this check'
);

for (const [journey, spec] of Object.entries(JOURNEY_CHARTER)) {
  const row = docRows[journey];
  assert.deepEqual(
    row.entryPoints,
    spec.entryPoints,
    `§6's entry-point cell for "${journey}" disagrees with journeyCharter.js ` +
      `(doc: ${JSON.stringify(row.entryPoints)}, module: ${JSON.stringify(spec.entryPoints)})`
  );
  assert.deepEqual(
    row.acIds.slice().sort(),
    spec.acIds.slice().sort(),
    `§6's AC-ids cell for "${journey}" disagrees with journeyCharter.js ` +
      `(doc: ${JSON.stringify(row.acIds)}, module: ${JSON.stringify(spec.acIds)})`
  );
  assert.equal(row.tier, spec.tier, `§6's tier for "${journey}" disagrees with journeyCharter.js`);
  assert.equal(row.status, spec.status, `§6's status for "${journey}" disagrees with journeyCharter.js`);

  // No row may still be carrying a Phase-2 placeholder. This is the AC of F3Go30-emwk.9 stated as
  // an assertion, so the stage cannot silently regress.
  assert.ok(
    !/‹pending›/.test(row.entryPoints.join(' ') + row.acIds.join(' ')),
    `§6 row "${journey}" still carries a ‹pending› placeholder`
  );
}

assert.ok(
  !/‹pending›/.test(guide.split('\n## 6.')[1].split('\n## ')[0]),
  'project-testing-guide.md §6 still contains a ‹pending› placeholder somewhere in the section'
);

// --- §6's per-journey invariants list ------------------------------------------------------------
// T18 + the AC's words: every journey states the invariants it asserts, or states it asserts none.

{
  const section = guide.split('\n### Per-journey invariants')[1];
  assert.ok(
    section,
    'project-testing-guide.md §6 no longer has a "Per-journey invariants" subsection — the AC ' +
      'requires every journey to state its invariants or state that it asserts none'
  );
  const body = section.split('\n## ')[0];
  for (const journey of Object.keys(JOURNEY_CHARTER)) {
    assert.ok(
      body.includes('`' + journey + '`'),
      `the per-journey invariants list does not mention "${journey}"`
    );
  }
  const declared = Object.entries(JOURNEY_CHARTER).filter(([, j]) => j.invariants);
  for (const [journey] of declared) {
    assert.ok(
      body.includes('`' + journey + '`'),
      `"${journey}" declares an invariant in the module but is absent from the doc list`
    );
  }
}

// --- §6's stated counts --------------------------------------------------------------------------

{
  const counts = charterCounts();
  const m = guide.match(
    /\*\*(\d+)\*\*\s+journeys,\s+of\s+which\s+\*\*(\d+)\*\*\s+are\s+tier\s+members[^.]*?drain\s+\*\*(\d+)\*\*\s+of\s+the\s+registry's\s+acceptance\s+criteria\s+and\s+drive\s+\*\*(\d+)\*\*\s+state-modifying\s+entry\s+points/
  );
  assert.ok(
    m,
    'project-testing-guide.md §6 no longer states its journey/AC/entry-point counts in the ' +
      'expected form — reword this check together with the doc rather than letting it pass vacuously'
  );
  assert.deepEqual(
    { journeys: Number(m[1]), tiered: Number(m[2]), acIds: Number(m[3]), entryPoints: Number(m[4]) },
    {
      journeys: counts.journeys,
      tiered: counts.tiered,
      acIds: counts.acIds,
      entryPoints: counts.entryPoints,
    },
    'project-testing-guide.md §6 counts disagree with journeyCharter.js. Regenerate with: ' +
      'node test/contract/journeyCharter.js --counts'
  );
}

// --- the CLI enumeration --------------------------------------------------------------------------

{
  const lines = execFileSync(process.execPath, [charterPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(
    lines,
    Object.keys(JOURNEY_CHARTER).sort(),
    'the CLI enumeration must list exactly the charter keys'
  );

  const pairs = execFileSync(process.execPath, [charterPath, '--acs'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const expectedPairs = [];
  for (const key of Object.keys(JOURNEY_CHARTER).sort()) {
    for (const id of JOURNEY_CHARTER[key].acIds) expectedPairs.push([key, id]);
  }
  assert.deepEqual(pairs, expectedPairs, '--acs must emit every journey/AC pair');
}

const c = charterCounts();
console.log(
  `test_journey_charter_view: OK — ${c.journeys} journeys (${c.tiered} tiered, ` +
    `${Object.values(JOURNEY_CHARTER).filter((j) => j.tier === TIER_EXCLUDED).length} excluded), ` +
    `${c.acIds} ACs drained, ${c.entryPoints} entry points driven (= the registry's covered set), ` +
    `${c.invariants} journey(s) declaring an invariant; guide §6 agrees`
);
