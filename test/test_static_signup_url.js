const assert = require('node:assert/strict');

// buildStaticSignupUrl_ mirrors buildStaticCheckinUrl_ (F3Go30-833s.10 / ADR-018 §7): both read
// STATIC_PAGES_BASE_URL_/APP_DEPLOY_TARGET as globals at call time, so they're set here before
// requiring Utilities.js, exactly like version.js would set them in the real GAS runtime.
global.STATIC_PAGES_BASE_URL_ = 'https://pax.example.github.io/f3go30/';
global.APP_DEPLOY_TARGET = 'TEST';

const { buildStaticSignupUrl_ } = require('../script/Utilities.js');

const WEBAPP = 'https://script.example.com/exec';

// --- Static host configured: builds a static URL carrying cmd=signup and the webapp backend ---
{
  var url = buildStaticSignupUrl_(WEBAPP);
  assert.equal(url, 'https://pax.example.github.io/f3go30/sit/?webapp=' + encodeURIComponent(WEBAPP) + '&cmd=signup');
}

// --- Optional opts are appended in order, only when supplied ---
{
  var url = buildStaticSignupUrl_(WEBAPP, {
    id: 'sess-123',
    ns: 'demo',
    contextDate: '2026-07-01',
    targetMonth: 'next',
    autoStart: true,
  });
  assert.equal(
    url,
    'https://pax.example.github.io/f3go30/sit/?webapp=' + encodeURIComponent(WEBAPP) +
      '&cmd=signup&id=sess-123&ns=demo&contextDate=2026-07-01&targetMonth=next&autoStart=1'
  );
}

// --- No webAppBaseUrl: returns '' so callers can omit the link ---
{
  assert.equal(buildStaticSignupUrl_(''), '');
}

// --- Static host not configured: returns '' so callers fall back to the GAS ?cmd=signup page ---
{
  delete global.STATIC_PAGES_BASE_URL_;
  delete require.cache[require.resolve('../script/Utilities.js')];
  var unconfigured = require('../script/Utilities.js').buildStaticSignupUrl_;
  assert.equal(unconfigured(WEBAPP), '');
}

console.log('test_static_signup_url.js: all assertions passed');
