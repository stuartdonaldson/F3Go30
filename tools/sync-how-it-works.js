#!/usr/bin/env node
/**
 * Syncs the "How it Works" content (F3Go30-e3co) from its single canonical source,
 * docs/Go30-Intro.md, out to every place it's duplicated:
 *   - script/SignupApp.html and script/CheckinApp.html's #howBody panels (in place)
 *   - static-pages/src/how-it-works.html (a standalone page, no SIT/PROD split — see its own
 *     header comment)
 *
 * The canonical content lives in docs/Go30-Intro.md between HOW-IT-WORKS:START/END marker
 * comments. It is intentionally normalized — identical wording regardless of which page shows
 * it — rather than a curated per-context excerpt (see the marker comment in Go30-Intro.md for
 * why: the small contextual differences that used to exist here were not worth a templating
 * layer).
 *
 * Run directly to sync locally, or via `npm run sync:how-it-works`. Also invoked automatically
 * by tools/manage-deployments.js's deploy() before every clasp push, so any edit to
 * Go30-Intro.md's fragment lands in both GAS apps on the next deploy without a manual step.
 *
 * Usage:
 *   node tools/sync-how-it-works.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTRO_MD_PATH = path.join(ROOT, 'docs', 'Go30-Intro.md');
const SIGNUP_HTML_PATH = path.join(ROOT, 'script', 'SignupApp.html');
const CHECKIN_HTML_PATH = path.join(ROOT, 'script', 'CheckinApp.html');
const STATIC_PAGE_PATH = path.join(ROOT, 'static-pages', 'src', 'how-it-works.html');

const START_MARKER = '<!-- HOW-IT-WORKS:START -->';
const END_MARKER = '<!-- HOW-IT-WORKS:END -->';

function extractFragment_(introMdContent) {
  const startIdx = introMdContent.indexOf(START_MARKER);
  const endIdx = introMdContent.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `docs/Go30-Intro.md: HOW-IT-WORKS:START/END markers not found or out of order — ` +
      `expected both "${START_MARKER}" and "${END_MARKER}"`
    );
  }
  return introMdContent.slice(startIdx + START_MARKER.length, endIdx).trim();
}

function replaceMarkers_(targetContent, fragment) {
  const startIdx = targetContent.indexOf(START_MARKER);
  const endIdx = targetContent.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `HOW-IT-WORKS:START/END markers not found or out of order in target content`
    );
  }
  const before = targetContent.slice(0, startIdx + START_MARKER.length);
  const after = targetContent.slice(endIdx);
  return `${before}\n${fragment}\n${after}`;
}

function buildStandalonePage_(fragment) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Go30 — How it Works</title>
<style>
  :root { --brand: #7a3b12; --brand-bg: #7a3b12; --brand-contrast: #fff; }
  body { margin: 0; padding: 24px 18px 48px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #333; background: #fdfbf7; }
  main { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 20px; color: var(--brand); }
  .how-section-head { margin: 14px 0 6px; font-size: 13px; font-weight: bold; color: var(--brand); letter-spacing: .04em; }
  .how-badge { min-width: 28px; height: 28px; border-radius: 50%; background: var(--brand-bg); color: var(--brand-contrast); font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
  a { color: var(--brand); }
</style>
</head>
<body>
<main>
<h1>Go30 — How it Works</h1>
${fragment}
</main>
</body>
</html>
`;
}

function main() {
  const introMd = fs.readFileSync(INTRO_MD_PATH, 'utf8');
  const fragment = extractFragment_(introMd);

  for (const targetPath of [SIGNUP_HTML_PATH, CHECKIN_HTML_PATH]) {
    const before = fs.readFileSync(targetPath, 'utf8');
    const after = replaceMarkers_(before, fragment);
    if (after !== before) {
      fs.writeFileSync(targetPath, after, 'utf8');
      console.log(`synced: ${path.relative(ROOT, targetPath)}`);
    } else {
      console.log(`up to date: ${path.relative(ROOT, targetPath)}`);
    }
  }

  fs.mkdirSync(path.dirname(STATIC_PAGE_PATH), { recursive: true });
  fs.writeFileSync(STATIC_PAGE_PATH, buildStandalonePage_(fragment), 'utf8');
  console.log(`wrote: ${path.relative(ROOT, STATIC_PAGE_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = { extractFragment_, replaceMarkers_, buildStandalonePage_ };
