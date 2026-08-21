const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  replaceConst,
  stampVersion,
  bumpPatchVersion_,
  bumpBuildNumber_,
  resetBuildNumber_,
  printDeploySummary_,
  parseDeploymentsOutput_,
  resolveRevision_,
} = require('../tools/manage-deployments');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3go30-deploy-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testReplaceConstAppendsWhenMissing() {
  const src = "const APP_VERSION = '1.0.0';\n";
  const out = replaceConst(src, 'APP_DEPLOY_TARGET', "'TEMPLATE'");
  assert.ok(out.includes("const APP_DEPLOY_TARGET"));
  assert.ok(out.includes("'TEMPLATE'"));
}

function testStampVersionUpdatesAllFields() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    const versionPath = path.join(dir, 'version.js');

    fs.writeFileSync(pkgPath, JSON.stringify({ version: '9.8.7' }), 'utf8');
    fs.writeFileSync(
      versionPath,
      [
        "const APP_VERSION = '0.0.0';",
        "const APP_VERSION_DATE = '2000-01-01T00:00:00.000Z';",
        "const APP_DEPLOY_TARGET = 'TEMPLATE';",
        '',
      ].join('\n'),
      'utf8'
    );

    const targets = ['TEMPLATE', 'MONTH', 'TEST'];

    for (const target of targets) {
      stampVersion(target, {
        pkgPath,
        versionPath,
        now: '2026-06-05T12:34:56.000Z',
      });

      const out = fs.readFileSync(versionPath, 'utf8');
      assert.ok(out.includes("const APP_VERSION = '9.8.7';"));
      assert.ok(out.includes("const APP_VERSION_DATE = '2026-06-05T12:34:56.000Z';"));
      assert.ok(out.includes(`const APP_DEPLOY_TARGET = '${target}';`));
    }
  });
}

function testBumpPatchVersionIncrementsPatchOnly() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'f3go30', version: '2.2.1' }, null, 2) + '\n', 'utf8');

    const newVersion = bumpPatchVersion_(pkgPath);

    assert.equal(newVersion, '2.2.2');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '2.2.2');
    assert.equal(pkg.name, 'f3go30'); // other fields untouched
  });
}

function testBumpPatchVersionIsIdempotentAcrossCalls() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '0.0.1' }), 'utf8');

    bumpPatchVersion_(pkgPath);
    bumpPatchVersion_(pkgPath);
    const newVersion = bumpPatchVersion_(pkgPath);

    assert.equal(newVersion, '0.0.4');
  });
}

function testBumpPatchVersionDoesNotTouchBuild() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '2.2.1', build: 7 }), 'utf8');

    bumpPatchVersion_(pkgPath);

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.build, 7);
  });
}

function testBumpBuildNumberIncrementsFromZeroWhenMissing() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '2.3.13' }), 'utf8');

    const build = bumpBuildNumber_(pkgPath);

    assert.equal(build, 1);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.build, 1);
    assert.equal(pkg.version, '2.3.13'); // version untouched by a SIT build bump
  });
}

function testBumpBuildNumberIsIdempotentAcrossCalls() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '2.3.13', build: 0 }), 'utf8');

    bumpBuildNumber_(pkgPath);
    bumpBuildNumber_(pkgPath);
    const build = bumpBuildNumber_(pkgPath);

    assert.equal(build, 3);
  });
}

function testResetBuildNumberZeroesExistingCount() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '2.3.13', build: 12 }), 'utf8');

    resetBuildNumber_(pkgPath);

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.build, 0);
    assert.equal(pkg.version, '2.3.13'); // version untouched by a build reset
  });
}

function testStampVersionUsesVersionOverride() {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    const versionPath = path.join(dir, 'version.js');

    fs.writeFileSync(pkgPath, JSON.stringify({ version: '2.3.13', build: 4 }), 'utf8');
    fs.writeFileSync(versionPath, "const APP_VERSION = '0.0.0';\nconst APP_VERSION_DATE = '';\nconst APP_DEPLOY_TARGET = '';\n", 'utf8');

    const { version } = stampVersion('TEST', {
      pkgPath,
      versionPath,
      now: '2026-06-05T12:34:56.000Z',
      versionOverride: '2.3.13.4',
    });

    assert.equal(version, '2.3.13.4');
    const out = fs.readFileSync(versionPath, 'utf8');
    assert.ok(out.includes("const APP_VERSION = '2.3.13.4';"));
  });
}

// ── parseDeploymentsOutput_ — the revision-fallback source ─────────────────────────────────────

function testParseDeploymentsOutputExtractsIdAndRevisionSkippingHead() {
  const output = [
    'Found 2 deployments.',
    '- AKfycbzHEADID @HEAD ',
    '- AKfycbzwlKLuVGeXoa3dLr9Kw19p5XyeziFGhxRNdge1HcH7VHlFoVuao9Q2AwWay2Uzt_4UZA @269 - v2.5.0.9 GO30-APP',
    '',
  ].join('\n');

  const deployments = parseDeploymentsOutput_(output);

  assert.equal(deployments.length, 1, '@HEAD entry must be filtered out');
  assert.equal(deployments[0].id, 'AKfycbzwlKLuVGeXoa3dLr9Kw19p5XyeziFGhxRNdge1HcH7VHlFoVuao9Q2AwWay2Uzt_4UZA');
  assert.equal(deployments[0].revision, '269');
}

// ── resolveRevision_ — parse-then-fallback revision resolution ─────────────────────────────────

function testResolveRevisionParsesTheDeployStdoutFirst() {
  let listCalled = false;
  const revision = resolveRevision_('Deployed AKfycbxABC @47.', 'AKfycbxABC', () => {
    listCalled = true;
    return '';
  });
  assert.equal(revision, '47');
  assert.equal(listCalled, false, 'the clasp deployments fallback must not run when stdout already has the revision');
}

function testResolveRevisionFallsBackToDeploymentsListingWhenStdoutParseMisses() {
  let listCalled = false;
  const deploymentsOutput = [
    'Found 1 deployment.',
    '- AKfycbxABC @47 - v1.2.3 GO30-APP',
    '',
  ].join('\n');

  const revision = resolveRevision_('some unrelated clasp output with no @revision marker', 'AKfycbxABC', () => {
    listCalled = true;
    return deploymentsOutput;
  });

  assert.equal(listCalled, true, 'the clasp deployments fallback must run when stdout parsing misses');
  assert.equal(revision, '47');
}

function testResolveRevisionReturnsNullWhenBothStrategiesMiss() {
  const revision = resolveRevision_('nothing useful here', 'AKfycbxABC', () => 'Found 0 deployments.\n');
  assert.equal(revision, null, 'printDeploySummary_ prints "(unresolved)" for this — see that test below');
}

// ── printDeploySummary_ — RECOMMENDATION.md §3.1's standard summary ────────────────────────────

function captureConsoleLog_(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function testPrintDeploySummaryPrintsAllEightRowsWithFullDeploymentId() {
  const deploymentId = 'AKfycbzwlKLuVGeXoa3dLr9Kw19p5XyeziFGhxRNdge1HcH7VHlFoVuao9Q2AwWay2Uzt_4UZA';
  const scriptId = '1-U7VpTVc6mPa-1s4fql5EXifSdq5HuRxhjB8MhpalHJepfCMDryksdjh';
  const settings = { testSpreadsheetId: 'SHEET123' };

  const output = captureConsoleLog_(() => {
    printDeploySummary_('test', {
      version: '2.5.0.9', now: '2026-08-21T14:02:11.000Z',
      deploymentId, revision: '269', scriptId, settings,
    });
  });

  assert.ok(output.includes('Product version: v2.5.0.9'));
  assert.ok(output.includes('Stamped at:      2026-08-21T14:02:11.000Z'));
  assert.ok(output.includes(`Deployment ID:   ${deploymentId}`), 'deployment ID must never be truncated');
  assert.ok(output.includes('Revision:        @269'));
  assert.ok(output.includes(scriptId.slice(0, 12)));
  assert.ok(output.includes(`https://script.google.com/home/projects/${scriptId}/edit`));
  assert.ok(output.includes(`https://script.google.com/macros/s/${deploymentId}/exec`));
  assert.ok(output.includes('static-pages/dist/sit/'));
  assert.ok(output.includes('https://docs.google.com/spreadsheets/d/SHEET123/edit'));
}

function testPrintDeploySummaryPlaceholdersEveryMissingInput() {
  const output = captureConsoleLog_(() => {
    printDeploySummary_('template', {
      version: '2.5.0', now: '2026-08-21T14:02:11.000Z',
      deploymentId: null, revision: null, scriptId: 'SCRIPT123', settings: {},
    });
  });

  assert.ok(output.includes('Revision:        (unresolved)'), 'a missing revision must explain, not print a broken @');
  assert.ok(output.includes('(templateSpreadsheetId not set in local.settings.json)'), 'a missing spreadsheet ID must explain, not print a broken URL');
  assert.ok(!output.includes('https://script.google.com/macros/s//exec'), 'a missing deployment ID must never produce a malformed webapp URL');
}

function run() {
  testReplaceConstAppendsWhenMissing();
  testStampVersionUpdatesAllFields();
  testStampVersionUsesVersionOverride();
  testBumpPatchVersionIncrementsPatchOnly();
  testBumpPatchVersionIsIdempotentAcrossCalls();
  testBumpPatchVersionDoesNotTouchBuild();
  testBumpBuildNumberIncrementsFromZeroWhenMissing();
  testBumpBuildNumberIsIdempotentAcrossCalls();
  testResetBuildNumberZeroesExistingCount();
  testParseDeploymentsOutputExtractsIdAndRevisionSkippingHead();
  testResolveRevisionParsesTheDeployStdoutFirst();
  testResolveRevisionFallsBackToDeploymentsListingWhenStdoutParseMisses();
  testResolveRevisionReturnsNullWhenBothStrategiesMiss();
  testPrintDeploySummaryPrintsAllEightRowsWithFullDeploymentId();
  testPrintDeploySummaryPlaceholdersEveryMissingInput();
  console.log('test_manage_deployments: all tests passed');
}

run();
