const assert = require('node:assert/strict');
const { readStaticPage_, extractFunction_ } = require('./helpers/staticPageExtract');

// F3Go30-5c2a.3 AC1/AC4: siteFeedbackKey_ is the client-minted idempotency key for the
// settings-menu "Send Feedback" flow — stable across a hand-retried resubmission of the exact
// same report, and different once the report text (or rating/identity) changes. siteFeedbackKey_
// depends on hashString_ (already used for TOKEN_STORAGE_KEY_'s namespacing), so both are
// extracted from the real static page rather than re-implemented for the test.
function loadSiteFeedbackKey_() {
  var src = readStaticPage_();
  var body = extractFunction_(src, 'hashString_') + '\n' + extractFunction_(src, 'siteFeedbackKey_');
  var fn = new Function(body + '\nreturn siteFeedbackKey_;');
  return fn();
}

function testKeyIsStableForSameUneditedReport() {
  var siteFeedbackKey_ = loadSiteFeedbackKey_();
  var a = siteFeedbackKey_('Splinter', 'splinter@example.com', 4, 'Loving the streak view.');
  var b = siteFeedbackKey_('Splinter', 'splinter@example.com', 4, 'Loving the streak view.');
  assert.equal(a, b, 'AC1: resubmitting the exact same report must produce the same key');
}

function testKeyChangesWhenCommentTextEdited() {
  var siteFeedbackKey_ = loadSiteFeedbackKey_();
  var a = siteFeedbackKey_('Splinter', 'splinter@example.com', 4, 'Loving the streak view.');
  var b = siteFeedbackKey_('Splinter', 'splinter@example.com', 4, 'Loving the streak view!');
  assert.notEqual(a, b, 'AC4: editing the report text before resubmitting must produce a new key');
}

function testKeyChangesWhenRatingEdited() {
  var siteFeedbackKey_ = loadSiteFeedbackKey_();
  var a = siteFeedbackKey_('Splinter', 'splinter@example.com', 4, 'Loving the streak view.');
  var b = siteFeedbackKey_('Splinter', 'splinter@example.com', 5, 'Loving the streak view.');
  assert.notEqual(a, b, 'a changed rating is a changed report and must produce a new key');
}

function run() {
  const tests = [
    testKeyIsStableForSameUneditedReport,
    testKeyChangesWhenCommentTextEdited,
    testKeyChangesWhenRatingEdited,
  ];
  for (const test of tests) {
    test();
    console.log(`  ok - ${test.name}`);
  }
  console.log('test_site_feedback_key.js: all tests passed');
}

run();
