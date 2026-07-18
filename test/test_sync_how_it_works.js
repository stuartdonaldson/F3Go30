const assert = require('assert');

const {
  extractFragment_,
  replaceMarkers_,
  buildStandalonePage_,
} = require('../tools/sync-how-it-works');

const START = '<!-- HOW-IT-WORKS:START -->';
const END = '<!-- HOW-IT-WORKS:END -->';

function testExtractFragmentPullsContentBetweenMarkers() {
  const introMd = [
    '# Go30 Intro',
    '',
    'Some prose above.',
    '',
    START,
    '<p class="how-section-head">THE CORE MISSION</p>',
    '<p>Execute a Daily Challenge.</p>',
    END,
    '',
  ].join('\n');

  const fragment = extractFragment_(introMd);
  assert.ok(fragment.includes('THE CORE MISSION'));
  assert.ok(!fragment.includes(START));
  assert.ok(!fragment.includes(END));
  assert.ok(!fragment.includes('Some prose above'));
}

function testExtractFragmentThrowsWhenMarkersMissing() {
  assert.throws(() => extractFragment_('# no markers here'), /HOW-IT-WORKS/);
}

function testExtractFragmentThrowsWhenEndMarkerMissing() {
  assert.throws(() => extractFragment_(`${START}\ncontent\n`), /HOW-IT-WORKS/);
}

function testReplaceMarkersSwapsContentInPlace() {
  const target = [
    '<div id="howBody">',
    START,
    'stale content',
    END,
    '</div>',
  ].join('\n');

  const out = replaceMarkers_(target, 'fresh content');
  assert.ok(out.includes('fresh content'));
  assert.ok(!out.includes('stale content'));
  assert.ok(out.includes(START) && out.includes(END));
  // surrounding structure preserved
  assert.ok(out.startsWith('<div id="howBody">'));
  assert.ok(out.endsWith('</div>'));
}

function testReplaceMarkersIsIdempotent() {
  const target = [
    '<div id="howBody">',
    START,
    'stale content',
    END,
    '</div>',
  ].join('\n');

  const once = replaceMarkers_(target, 'fresh content');
  const twice = replaceMarkers_(once, 'fresh content');
  assert.strictEqual(once, twice);
}

function testReplaceMarkersThrowsWhenTargetHasNoMarkers() {
  assert.throws(() => replaceMarkers_('<div id="howBody"></div>', 'fresh content'), /HOW-IT-WORKS/);
}

function testBuildStandalonePageWrapsFragment() {
  const page = buildStandalonePage_('<p>hello</p>');
  assert.ok(page.includes('<p>hello</p>'));
  assert.ok(/<!doctype html>/i.test(page));
  assert.ok(/<title>/i.test(page));
}

function run() {
  const tests = [
    testExtractFragmentPullsContentBetweenMarkers,
    testExtractFragmentThrowsWhenMarkersMissing,
    testExtractFragmentThrowsWhenEndMarkerMissing,
    testReplaceMarkersSwapsContentInPlace,
    testReplaceMarkersIsIdempotent,
    testReplaceMarkersThrowsWhenTargetHasNoMarkers,
    testBuildStandalonePageWrapsFragment,
  ];
  for (const test of tests) {
    test();
    console.log(`  ok - ${test.name}`);
  }
  console.log('test_sync_how_it_works.js: all tests passed');
}

run();
