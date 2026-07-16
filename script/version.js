// F3 Go30 Tracker — version info
const APP_VERSION      = '2.3.16.7';
const APP_VERSION_DATE = '2026-07-16T04:49:50.291Z';
const APP_AUTHOR       = 'Stuart Donaldson (F3 Little John)';
const APP_CONTACT      = 'stu@asyn.com';
const APP_DEPLOY_TARGET  = 'TEST';
// GitHub Pages host for the static check-in front end (F3Go30-5nfj.2), served from the
// separate f3go30/static-pages repo (checked out locally as ../F3Static) — one subpath per
// environment (tools/build-static-pages.js writes static-pages/dist/<sit|prod>/, then
// tools/publish-static-pages.js copies each into F3Static/dist/<sit|prod>/ and pushes),
// always trailing-slash. showAbout() (onOpen.js) appends 'sit/' or 'prod/' based on
// APP_DEPLOY_TARGET.
const STATIC_PAGES_BASE_URL_ = 'https://f3go30.github.io/static-pages/dist/';
