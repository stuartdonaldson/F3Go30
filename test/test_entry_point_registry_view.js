// Stops docs/atdd/project-testing-guide.md §7 (and harness-design.md §9a's H12 row) drifting from
// test/contract/entryPointRegistry.js (F3Go30-emwk.8 — H12/I6). Network-free: reads two checked-in
// markdown files and one data module.
//
// §7 and the H12 row are VIEWS of the registry — prose stating counts, not a second enumeration.
// In the reference implementation the equivalent view drifted silently (32/22 stated against an
// actual 37/13) until a check like this one was added. Two failure modes are covered, and the
// second matters as much as the first:
//
//   1. a stated number disagrees with the registry     -> fail, naming both numbers
//   2. the prose was reworded so a number can no longer be found -> ALSO fail
//
// (2) is the reason this file does not use optional matching anywhere. A check that quietly passes
// when it can no longer find what it is checking is worse than no check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const registryPath = path.join(__dirname, 'contract', 'entryPointRegistry.js');
const {
  ENTRY_POINT_REGISTRY,
  ENTRY_POINT_DEFERRED,
  ENTRY_POINT_CLASS_ORDER,
  ENTRY_POINT_READ_ONLY_EXEMPT,
  registryCounts,
  assertRegistryWellFormed,
} = require(registryPath);

const docsDir = path.join(__dirname, '..', 'docs', 'atdd');
const guide = fs.readFileSync(path.join(docsDir, 'project-testing-guide.md'), 'utf8');
const harnessDesign = fs.readFileSync(path.join(docsDir, 'harness-design.md'), 'utf8');

// --- the registry is internally well formed ----------------------------------------------------

assertRegistryWellFormed();

const counts = registryCounts();

assert.ok(counts.total > 0, 'the registry is empty');
assert.ok(
  counts.covered > 0,
  'every entry point is deferred — a registry where nothing is covered is a plan, not a record'
);

// Every deferral names a reason and a bead (assertRegistryWellFormed checks this; asserted again
// here as the AC's own words, so a future refactor of that helper cannot drop it silently).
for (const [key, reason] of Object.entries(ENTRY_POINT_DEFERRED)) {
  assert.match(reason, /F3Go30-[a-z0-9]+(\.\d+)?/, `deferred entry "${key}" carries no bead id`);
  assert.match(reason, /^\[(backlog|permanent)\]/, `deferred entry "${key}" is not labelled`);
}

// The read-only exemptions are claims; each must state why.
for (const [key, reason] of Object.entries(ENTRY_POINT_READ_ONLY_EXEMPT)) {
  assert.ok(
    typeof reason === 'string' && reason.trim().length >= 20,
    `read-only exemption "${key}" states no reason — an exemption without a justification is an omission`
  );
}

// --- the guide's §7 table is a view of the per-class counts ------------------------------------

/** Parse §7's table into {className: {total, covered, deferred}}. */
function parseGuideTable(text) {
  const rows = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const label = cells[0].replace(/`/g, '').trim().toLowerCase();
    const match = ENTRY_POINT_CLASS_ORDER.find((c) => c.toLowerCase() === label);
    if (!match) continue;
    const [total, covered, deferred] = [cells[1], cells[2], cells[3]];
    if (!/^\d+$/.test(total) || !/^\d+$/.test(covered) || !/^\d+$/.test(deferred)) continue;
    rows[match] = { total: Number(total), covered: Number(covered), deferred: Number(deferred) };
  }
  return rows;
}

const guideRows = parseGuideTable(guide);

for (const className of ENTRY_POINT_CLASS_ORDER) {
  assert.ok(
    guideRows[className],
    `project-testing-guide.md §7 has no parseable row for call-site class "${className}" — ` +
      'the table was reworded or a class was added to the registry without a row. Fix the doc; ' +
      'do not relax this check.'
  );
  assert.deepEqual(
    guideRows[className],
    counts.byClass[className],
    `project-testing-guide.md §7 disagrees with the registry for "${className}" ` +
      `(doc: ${JSON.stringify(guideRows[className])}, registry: ${JSON.stringify(counts.byClass[className])}). ` +
      'Regenerate with: node test/contract/entryPointRegistry.js --counts'
  );
}

assert.equal(
  Object.keys(guideRows).length,
  ENTRY_POINT_CLASS_ORDER.length,
  'project-testing-guide.md §7 has a class row the registry does not declare'
);

// --- the guide's bold prose totals -------------------------------------------------------------

{
  const m = guide.match(
    /registry holds \*\*(\d+)\*\* state-modifying entry points, of which \*\*(\d+)\*\* carry a charter-journey\s+call-site today and \*\*(\d+)\*\* are explicitly enumerated as \*\*deferred\*\*/
  );
  assert.ok(
    m,
    'project-testing-guide.md §7 no longer states its total/covered/deferred numbers in the ' +
      'expected form — reword this check together with the doc rather than letting it pass vacuously'
  );
  assert.deepEqual(
    { total: Number(m[1]), covered: Number(m[2]), deferred: Number(m[3]) },
    { total: counts.total, covered: counts.covered, deferred: counts.deferred },
    'project-testing-guide.md §7 prose totals disagree with the registry'
  );
}

// --- harness-design.md §9a's H12 row and §9b's counts -----------------------------------------

{
  const m = harnessDesign.match(
    /registry of (\d+) state-modifying entry points, with (\d+) explicitly deferred/
  );
  assert.ok(
    m,
    'harness-design.md §9a H12 row no longer states its counts in the expected form ' +
      '("registry of N state-modifying entry points, with M explicitly deferred")'
  );
  assert.deepEqual(
    { total: Number(m[1]), deferred: Number(m[2]) },
    { total: counts.total, deferred: counts.deferred },
    'harness-design.md §9a H12 row disagrees with the registry'
  );
}

{
  const m = harnessDesign.match(
    /`ENTRY_POINT_READ_ONLY_EXEMPT` \((\d+) entries\)/
  );
  assert.ok(m, 'harness-design.md §9b no longer states the read-only exemption count');
  assert.equal(
    Number(m[1]),
    Object.keys(ENTRY_POINT_READ_ONLY_EXEMPT).length,
    'harness-design.md §9b states a different read-only exemption count than the registry holds'
  );
}

{
  const m = harnessDesign.match(
    /`ENTRY_POINT_REGISTRY`\s*\n?\s*\(`\{key → description\}`, (\d+) entries\) plus `ENTRY_POINT_DEFERRED` \((\d+)\)/
  );
  assert.ok(m, 'harness-design.md §9b no longer states the registry/deferred counts in its as-built bullet');
  assert.deepEqual(
    { total: Number(m[1]), deferred: Number(m[2]) },
    { total: counts.total, deferred: counts.deferred },
    'harness-design.md §9b as-built bullet disagrees with the registry'
  );
}

// --- the CLI enumeration -----------------------------------------------------------------------

{
  const lines = execFileSync(process.execPath, [registryPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(
    lines,
    Object.keys(ENTRY_POINT_REGISTRY).sort(),
    'the CLI enumeration must list exactly the registry keys'
  );

  const tsv = execFileSync(process.execPath, [registryPath, '--counts'], { encoding: 'utf8' })
    .trim()
    .split('\n');
  const totalRow = tsv[tsv.length - 1].split('\t');
  assert.deepEqual(
    totalRow,
    ['TOTAL', String(counts.total), String(counts.covered), String(counts.deferred)],
    '--counts TOTAL row disagrees with registryCounts()'
  );
}

console.log(
  `test_entry_point_registry_view: OK — ${counts.total} entry points ` +
    `(${counts.covered} covered, ${counts.deferred} deferred), ` +
    `${Object.keys(ENTRY_POINT_READ_ONLY_EXEMPT).length} read-only exemptions; ` +
    'guide §7 and harness-design §9a/§9b agree'
);
