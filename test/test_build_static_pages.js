const assert = require('assert');

const {
  stampSource_,
  execUrlForEnv_,
} = require('../tools/build-static-pages');

const VERSION_PLACEHOLDER = 'var STATIC_BUILD_VERSION_ = null;';
const WEBAPP_PLACEHOLDER = 'var STATIC_WEBAPP_URL_ = null;';

const SETTINGS = {
  testDeploymentId: 'SIT_DEP_ID',
  templateDeploymentId: 'PROD_DEP_ID',
};

function srcFixture() {
  return [
    '<script>',
    `  ${WEBAPP_PLACEHOLDER}`,
    `  ${VERSION_PLACEHOLDER}`,
    '</script>',
  ].join('\n');
}

// AC2/AC3 — the env's /exec URL is derived from the deployment ID in local.settings.json,
// same key mapping callWebapp.js uses (testDeploymentId=sit, templateDeploymentId=prod).
function testExecUrlForSit() {
  assert.strictEqual(
    execUrlForEnv_('sit', SETTINGS),
    'https://script.google.com/macros/s/SIT_DEP_ID/exec'
  );
}

function testExecUrlForProd() {
  assert.strictEqual(
    execUrlForEnv_('prod', SETTINGS),
    'https://script.google.com/macros/s/PROD_DEP_ID/exec'
  );
}

// AC5 — missing deployment ID for a requested env must fail loudly, not stamp an empty URL.
function testExecUrlThrowsWhenDeploymentIdMissing() {
  assert.throws(() => execUrlForEnv_('prod', { testDeploymentId: 'x' }), /templateDeploymentId/);
}

// AC1/AC2 — both placeholders are swapped for their stamped values.
function testStampSourceReplacesBothPlaceholders() {
  const out = stampSource_(srcFixture(), {
    versionString: '2.4.2.7',
    webAppUrl: 'https://script.google.com/macros/s/SIT_DEP_ID/exec',
  });
  assert.ok(out.includes("var STATIC_WEBAPP_URL_ = \"https://script.google.com/macros/s/SIT_DEP_ID/exec\";"));
  assert.ok(out.includes('var STATIC_BUILD_VERSION_ = "2.4.2.7";'));
  assert.ok(!out.includes(WEBAPP_PLACEHOLDER));
  assert.ok(!out.includes(VERSION_PLACEHOLDER));
}

// AC5 — a source missing the webapp placeholder is a build error (guards silent drift if the
// source file is edited without the placeholder).
function testStampSourceThrowsWhenWebappPlaceholderMissing() {
  const src = `<script>\n  ${VERSION_PLACEHOLDER}\n</script>`;
  assert.throws(
    () => stampSource_(src, { versionString: '1.0', webAppUrl: 'https://x/exec' }),
    /STATIC_WEBAPP_URL_/
  );
}

function testStampSourceThrowsWhenVersionPlaceholderMissing() {
  const src = `<script>\n  ${WEBAPP_PLACEHOLDER}\n</script>`;
  assert.throws(
    () => stampSource_(src, { versionString: '1.0', webAppUrl: 'https://x/exec' }),
    /STATIC_BUILD_VERSION_/
  );
}

function run() {
  const tests = [
    testExecUrlForSit,
    testExecUrlForProd,
    testExecUrlThrowsWhenDeploymentIdMissing,
    testStampSourceReplacesBothPlaceholders,
    testStampSourceThrowsWhenWebappPlaceholderMissing,
    testStampSourceThrowsWhenVersionPlaceholderMissing,
  ];
  for (const test of tests) {
    test();
    console.log(`  ok - ${test.name}`);
  }
  console.log('test_build_static_pages.js: all tests passed');
}

run();
