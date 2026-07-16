#!/usr/bin/env node
/**
 * Builds static-pages/src/index.html into per-environment, publishable copies under
 * static-pages/dist/<env>/index.html (F3Go30-5nfj.2 follow-up).
 *
 * Two environments, same split as the GAS deploy targets (tools/manage-deployments.js):
 *   sit  -> static-pages/dist/sit/index.html
 *   prod -> static-pages/dist/prod/index.html
 *
 * The only thing this build step changes is stamping STATIC_BUILD_VERSION_ — a placeholder in
 * the source (`var STATIC_BUILD_VERSION_ = null;`) — with a version string in the same shape
 * script/version.js gets stamped with (manage-deployments.js's stampVersion): "<version>.<build>"
 * for sit, bare "<version>" for prod. This is only ever a fast, offline first-paint value; the
 * page always reconciles it with the live GAS-reported version on its first identify call (see
 * static-pages/src/index.html's applyServerConfig_), so it does not need to match whichever
 * version is actually live on that environment's deployment at build time.
 *
 * Usage:
 *   node tools/build-static-pages.js [--env sit|prod|all]   (default: all)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'static-pages', 'src', 'index.html');
const DIST_ROOT = path.join(ROOT, 'static-pages', 'dist');
const PKG_PATH = path.join(ROOT, 'package.json');

const PLACEHOLDER = 'var STATIC_BUILD_VERSION_ = null;';

function versionStringFor(env, pkg) {
  if (env === 'sit') return `${pkg.version}.${pkg.build || 0}`;
  return String(pkg.version);
}

function buildOne(env) {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const versionString = versionStringFor(env, pkg);
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  if (!src.includes(PLACEHOLDER)) {
    throw new Error(`static-pages/src/index.html: expected placeholder not found: ${PLACEHOLDER}`);
  }
  const out = src.replace(PLACEHOLDER, `var STATIC_BUILD_VERSION_ = ${JSON.stringify(versionString)};`);
  const outDir = path.join(DIST_ROOT, env);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), out, 'utf8');
  // Small companion file the GAS About dialog fetches (UrlFetchApp) to show the live static
  // page's own build stamp alongside APP_VERSION — see script/onOpen.js's showAbout().
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify({ version: versionString }), 'utf8');
  console.log(`built static-pages/dist/${env}/index.html (v${versionString})`);
}

function main() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'all';
  const envs = env === 'all' ? ['sit', 'prod'] : [env];
  envs.forEach(buildOne);
}

main();
