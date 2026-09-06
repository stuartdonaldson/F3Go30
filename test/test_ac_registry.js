// Guards the AC registry (test/contract/acRegistry.js, F3Go30-emwk.7 — H10's registry half,
// H11's mechanical enforcement). Network-free by construction: this file imports a data module
// and asserts about its own shape, so it runs in the fast tier with the rest of test/.
//
// The point of these assertions is that the two mistakes the registry's header documents cannot
// come back quietly: a tracker id smuggled into an AC id (H11), and harness self-test tags
// leaking into AC_REGISTRY where they permanently inflate the coverage denominator.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const registryPath = path.join(__dirname, 'contract', 'acRegistry.js');
const {
  AC_REGISTRY,
  AC_SELFTEST_FIXTURES,
  listAcIds,
  assertNoTrackerIdsInAcIds,
  assertSelftestFixturesAreSeparate,
} = require(registryPath);

// --- H11: no AC id may encode a tracker id ----------------------------------------------------

assertNoTrackerIdsInAcIds();

// The guard has to actually fire, or it is decoration. Re-run its predicate against a poisoned
// copy of the id set rather than mutating the live registry.
{
  const poisoned = ['checkin snapshot-day-boundary', 'signup F3Go30-1f75-done-url'];
  const { TRACKER_ID_PATTERN } = require(registryPath);
  const offenders = poisoned.filter((id) => TRACKER_ID_PATTERN.test(id));
  assert.deepEqual(
    offenders,
    ['signup F3Go30-1f75-done-url'],
    'the H11 pattern must match a bead id embedded in an AC id — a guard that never fires is decoration'
  );
}

// --- id shape: `<domain> <behaviour-slug>` ----------------------------------------------------

const ID_SHAPE = /^[a-z0-9]+ [a-z0-9]+(-[a-z0-9]+)*$/;
for (const id of Object.keys(AC_REGISTRY)) {
  assert.ok(
    ID_SHAPE.test(id),
    `AC id "${id}" is not <domain> <behaviour-slug> (lowercase, one space, hyphens inside each half)`
  );
}

// --- every id has a real description ----------------------------------------------------------

for (const [id, description] of Object.entries(AC_REGISTRY)) {
  assert.equal(typeof description, 'string', `AC "${id}" has a non-string description`);
  assert.ok(
    description.trim().length >= 30,
    `AC "${id}" has a description too short to state a behaviour: ${JSON.stringify(description)}`
  );
  assert.notEqual(
    description.trim(),
    id,
    `AC "${id}" restates its own id instead of describing the behaviour`
  );
}

// --- the self-test fixtures stay out of the denominator ---------------------------------------

assertSelftestFixturesAreSeparate();

assert.ok(Object.keys(AC_SELFTEST_FIXTURES).length > 0, 'AC_SELFTEST_FIXTURES should not be empty');

// listAcIds() is what a coverage computation consumes; it must never include a self-test tag.
{
  const ids = new Set(listAcIds());
  for (const tag of Object.keys(AC_SELFTEST_FIXTURES)) {
    assert.ok(
      !ids.has(tag),
      `harness self-test tag "${tag}" reached listAcIds() — that is the 27%-denominator mistake`
    );
  }
  assert.equal(ids.size, Object.keys(AC_REGISTRY).length, 'listAcIds() lost or duplicated an id');
}

// --- ids are unique after normalisation --------------------------------------------------------
// Object keys are unique by construction, but two ids differing only in case or spacing would be
// two entries for one behaviour, silently double-counting the denominator.
{
  const seen = new Map();
  for (const id of Object.keys(AC_REGISTRY)) {
    const normalized = id.toLowerCase().replace(/[\s-]+/g, '');
    if (seen.has(normalized)) {
      assert.fail(`AC ids "${seen.get(normalized)}" and "${id}" normalize to the same behaviour`);
    }
    seen.set(normalized, id);
  }
}

// --- the --ac-list-cmd contract ----------------------------------------------------------------
// test-suite-diagnostics.py runs this module as a command and reads one id per line. If that
// invocation breaks, ac_ratio silently goes back to "unknown", so it is asserted here rather than
// left to be discovered during a diagnostics run.
{
  const lines = execFileSync(process.execPath, [registryPath], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0);
  assert.deepEqual(lines, listAcIds(), 'the CLI enumeration must match listAcIds() exactly');

  const json = JSON.parse(execFileSync(process.execPath, [registryPath, '--json'], { encoding: 'utf8' }));
  assert.deepEqual(json, listAcIds(), '--json must emit the same ids as the line-per-id form');
}

// --- the guide's stated AC count is a view of the registry -------------------------------------
// docs/atdd/project-testing-guide.md §2a states the registry's size in bold. A stated number that
// nothing checks is the drift this whole stage exists to prevent.
{
  const fs = require('node:fs');
  const guidePath = path.join(__dirname, '..', 'docs', 'atdd', 'project-testing-guide.md');
  const guide = fs.readFileSync(guidePath, 'utf8');

  const acMatch = guide.match(/\*\*(\d+)\*\* acceptance criteria as `AC_REGISTRY`/);
  assert.ok(
    acMatch,
    'project-testing-guide.md §2a no longer states the AC count in the expected form ' +
      '("**N** acceptance criteria as `AC_REGISTRY`") — reword the check with the doc, do not let it go quiet'
  );
  assert.equal(
    Number(acMatch[1]),
    Object.keys(AC_REGISTRY).length,
    'project-testing-guide.md §2a states a different AC count than the registry holds'
  );

  const selftestMatch = guide.match(/`AC_SELFTEST_FIXTURES` \((\d+) entries\)/);
  assert.ok(selftestMatch, 'project-testing-guide.md §2a no longer states the self-test fixture count');
  assert.equal(
    Number(selftestMatch[1]),
    Object.keys(AC_SELFTEST_FIXTURES).length,
    'project-testing-guide.md §2a states a different AC_SELFTEST_FIXTURES count than the module holds'
  );
}

console.log(
  `test_ac_registry: OK — ${Object.keys(AC_REGISTRY).length} ACs, ` +
    `${Object.keys(AC_SELFTEST_FIXTURES).length} self-test fixtures (excluded from the denominator)`
);
