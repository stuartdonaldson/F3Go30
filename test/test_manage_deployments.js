const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { replaceConst, stampVersion, bumpPatchVersion_, bumpBuildNumber_, resetBuildNumber_ } = require('../tools/manage-deployments');

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
  console.log('test_manage_deployments: all tests passed');
}

run();
