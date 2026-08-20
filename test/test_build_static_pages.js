const assert = require('assert');
const crypto = require('crypto');

const {
  stampSource_,
  execUrlForEnv_,
  buildCspMeta_,
  collectScriptHashes_,
  insertCsp_,
} = require('../tools/build-static-pages');

const VERSION_PLACEHOLDER = 'var STATIC_BUILD_VERSION_ = null;';
const WEBAPP_PLACEHOLDER = 'var STATIC_WEBAPP_URL_ = null;';
const CSP_INSERT_MARKER = '<!-- CSP_META_INSERT_POINT -->';

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

// ── F3Go30-ah3v: CSP meta built at build time ───────────────────────────────────────────────

function sha256b64_(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('base64');
}

function cspFixture() {
  return [
    '<head>',
    CSP_INSERT_MARKER,
    '</head>',
    '<script>console.log("one");</script>',
    '<script>console.log("two");</script>',
  ].join('\n');
}

// AC1/AC2 — one hash per inline <script> block, computed against its exact content.
function testCollectScriptHashesReturnsOneHashPerBlock() {
  const hashes = collectScriptHashes_(cspFixture());
  assert.equal(hashes.length, 2);
  assert.equal(hashes[0], `'sha256-${sha256b64_('console.log("one");')}'`);
  assert.equal(hashes[1], `'sha256-${sha256b64_('console.log("two");')}'`);
}

// AC1 — default-src 'self' present; AC2 — script-src carries the computed hashes, not
// 'unsafe-inline'.
function testBuildCspMetaHasDefaultSrcAndHashesNoUnsafeInlineOnScript() {
  const meta = buildCspMeta_(cspFixture(), 'https://script.google.com/macros/s/DEP_ID/exec');
  assert.match(meta, /default-src 'self'/);
  assert.match(meta, /script-src 'self' 'sha256-[^']+' 'sha256-[^']+'/);
  const scriptSrcClause = meta.match(/script-src [^;]*/)[0];
  assert.ok(!scriptSrcClause.includes('unsafe-inline'), "script-src must not fall back to 'unsafe-inline'");
}

// connect-src is limited to the GAS /exec origin — plus its known redirect target
// (script.googleusercontent.com, see buildCspMeta_'s own docstring) — not left wide open.
function testBuildCspMetaConnectSrcLimitedToExecOriginAndRedirectTarget() {
  const meta = buildCspMeta_(cspFixture(), 'https://script.google.com/macros/s/DEP_ID/exec');
  const connectSrcClause = meta.match(/connect-src [^;]*/)[0];
  assert.match(connectSrcClause, /https:\/\/script\.google\.com/);
  assert.match(connectSrcClause, /https:\/\/script\.googleusercontent\.com/);
  assert.ok(!connectSrcClause.includes('*'), 'connect-src must not be wildcarded');
}

// Regression (F3Go30-ah3v, caught live on SIT): a script block containing a literal NUL
// character (announceFingerprint_'s field delimiter — real embedded code point, not a space, no
// matter how it renders in an editor) must hash the same way a browser's HTML parser does, which
// replaces NUL with U+FFFD during input-stream preprocessing BEFORE the parser (and therefore
// the CSP hash check) ever sees it. Hashing the raw byte instead produces a hash that can never
// match what the browser actually executes — the script gets silently and permanently blocked.
function testCollectScriptHashesNormalizesEmbeddedNul() {
  const withNul = '<script>var raw = a + \'' + '\u0000' + '\' + b;</script>';
  const asBrowserSeesIt = 'var raw = a + \'' + '\uFFFD' + '\' + b;';
  const hashes = collectScriptHashes_(withNul);
  assert.equal(hashes[0], `'sha256-${sha256b64_(asBrowserSeesIt)}'`);
}

// A different exec origin (e.g. a differently-hosted deployment) is reflected, not hard-coded.
function testBuildCspMetaUsesTheGivenExecOrigin() {
  const meta = buildCspMeta_(cspFixture(), 'https://example-exec-host.test/macros/s/OTHER/exec');
  assert.match(meta, /https:\/\/example-exec-host\.test/);
}

// AC3 is the referrer meta itself, added directly to the unbuilt source (see index.html) —
// nothing to compute at build time, so no test needed here.

function testInsertCspReplacesMarker() {
  const out = insertCsp_(cspFixture(), 'https://script.google.com/macros/s/DEP_ID/exec');
  assert.ok(!out.includes(CSP_INSERT_MARKER));
  assert.match(out, /<meta http-equiv="Content-Security-Policy"/);
}

function testInsertCspThrowsWhenMarkerMissing() {
  const src = '<head></head><script>x();</script>';
  assert.throws(
    () => insertCsp_(src, 'https://script.google.com/macros/s/DEP_ID/exec'),
    /CSP_META_INSERT_POINT/
  );
}

// The hashes must be computed against the STAMPED source (post version/webapp substitution), not
// the raw placeholder text — otherwise a built page's actual served script content wouldn't
// match its own CSP hash and every inline script would be blocked.
function testInsertCspHashesReflectStampedContentNotPlaceholders() {
  const stamped = stampSource_(srcFixture() + CSP_INSERT_MARKER, {
    versionString: '2.4.2.7',
    webAppUrl: 'https://script.google.com/macros/s/SIT_DEP_ID/exec',
  });
  const out = insertCsp_(stamped, 'https://script.google.com/macros/s/SIT_DEP_ID/exec');
  const expectedHash = sha256b64_(stamped.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.ok(out.includes(`'sha256-${expectedHash}'`));
}

function run() {
  const tests = [
    testExecUrlForSit,
    testExecUrlForProd,
    testExecUrlThrowsWhenDeploymentIdMissing,
    testStampSourceReplacesBothPlaceholders,
    testStampSourceThrowsWhenWebappPlaceholderMissing,
    testStampSourceThrowsWhenVersionPlaceholderMissing,
    testCollectScriptHashesReturnsOneHashPerBlock,
    testCollectScriptHashesNormalizesEmbeddedNul,
    testBuildCspMetaHasDefaultSrcAndHashesNoUnsafeInlineOnScript,
    testBuildCspMetaConnectSrcLimitedToExecOriginAndRedirectTarget,
    testBuildCspMetaUsesTheGivenExecOrigin,
    testInsertCspReplacesMarker,
    testInsertCspThrowsWhenMarkerMissing,
    testInsertCspHashesReflectStampedContentNotPlaceholders,
  ];
  for (const test of tests) {
    test();
    console.log(`  ok - ${test.name}`);
  }
  console.log('test_build_static_pages.js: all tests passed');
}

run();
