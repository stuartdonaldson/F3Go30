const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { staticBaseUrl, staticEntryUrl } = require('../tools/static-urls.js');

function withTempVersionFile_(contents, fn) {
  const tmpPath = path.join(os.tmpdir(), 'test_static_urls_version_' + process.pid + '_' + Date.now() + '.js');
  fs.writeFileSync(tmpPath, contents, 'utf8');
  try {
    fn(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

function testStaticBaseUrlReadsTheRealVersionFile() {
  // No versionPath override — must resolve script/version.js's actual current constant.
  assert.strictEqual(staticBaseUrl(), 'https://f3go30.github.io/static-pages/dist/');
}

function testStaticBaseUrlReadsFromAnExplicitPath() {
  withTempVersionFile_("const STATIC_PAGES_BASE_URL_ = 'https://example.test/dist/';\n", (tmpPath) => {
    assert.strictEqual(staticBaseUrl(tmpPath), 'https://example.test/dist/');
  });
}

function testStaticBaseUrlThrowsWhenConstantMissing() {
  withTempVersionFile_('const SOMETHING_ELSE = 1;\n', (tmpPath) => {
    assert.throws(() => staticBaseUrl(tmpPath), /STATIC_PAGES_BASE_URL_/);
  });
}

function testStaticEntryUrlAppendsTheEnvSegment() {
  withTempVersionFile_("const STATIC_PAGES_BASE_URL_ = 'https://example.test/dist/';\n", (tmpPath) => {
    assert.strictEqual(staticEntryUrl('sit', tmpPath), 'https://example.test/dist/sit/');
    assert.strictEqual(staticEntryUrl('prod', tmpPath), 'https://example.test/dist/prod/');
  });
}

function testStaticEntryUrlRejectsAnUnknownEnv() {
  withTempVersionFile_("const STATIC_PAGES_BASE_URL_ = 'https://example.test/dist/';\n", (tmpPath) => {
    assert.throws(() => staticEntryUrl('staging', tmpPath), /env must be/);
  });
}

function run() {
  testStaticBaseUrlReadsTheRealVersionFile();
  testStaticBaseUrlReadsFromAnExplicitPath();
  testStaticBaseUrlThrowsWhenConstantMissing();
  testStaticEntryUrlAppendsTheEnvSegment();
  testStaticEntryUrlRejectsAnUnknownEnv();
  console.log('test_static_urls.js: all tests passed');
}

run();
