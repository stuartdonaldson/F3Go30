#!/usr/bin/env node
/**
 * Single source of truth (node-side) for the static check-in front end's GitHub Pages base URL.
 *
 * script/version.js's STATIC_PAGES_BASE_URL_ is the GAS-side runtime copy (read by showAbout()/
 * onOpen.js to link a human to the right per-environment page) and stays the declaring site —
 * this module just reads that same constant back out on the node side instead of re-hardcoding
 * the literal in every tool that needs it (RECOMMENDATION.md #10: F3Go30's and RCV's
 * manage-deployments.js variants had each re-hardcoded "f3go30.github.io" independently, so a
 * host move would have needed a coordinated multi-file edit to not silently print a stale link).
 *
 * Usage:
 *   const { staticBaseUrl, staticEntryUrl } = require('./static-urls');
 *   staticBaseUrl()        // 'https://f3go30.github.io/static-pages/dist/'
 *   staticEntryUrl('sit')  // 'https://f3go30.github.io/static-pages/dist/sit/'
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_PATH = path.join(ROOT, 'script', 'version.js');

/** Reads STATIC_PAGES_BASE_URL_ straight out of script/version.js. Re-read on every call
 * (not cached at module load) so a stale require cache can never hide a source edit. */
function staticBaseUrl(versionPath) {
  const p = versionPath || VERSION_PATH;
  const src = fs.readFileSync(p, 'utf8');
  const match = src.match(/const STATIC_PAGES_BASE_URL_\s*=\s*'([^']+)'/);
  if (!match) throw new Error(`STATIC_PAGES_BASE_URL_ not found in ${p}`);
  return match[1];
}

/** The full per-environment entry point, e.g. staticEntryUrl('sit') ->
 * 'https://f3go30.github.io/static-pages/dist/sit/'. */
function staticEntryUrl(env, versionPath) {
  if (env !== 'sit' && env !== 'prod') {
    throw new Error(`env must be 'sit' or 'prod', got '${env}'`);
  }
  return `${staticBaseUrl(versionPath)}${env}/`;
}

module.exports = { staticBaseUrl, staticEntryUrl };
