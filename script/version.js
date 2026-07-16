// F3 Go30 Tracker — version info
const APP_VERSION      = '2.3.16.3';
const APP_VERSION_DATE = '2026-07-16T03:21:35.375Z';
const APP_AUTHOR       = 'Stuart Donaldson (F3 Little John)';
const APP_CONTACT      = 'stu@asyn.com';
const APP_DEPLOY_TARGET  = 'TEST';
// GitHub Pages host for the static check-in front end (F3Go30-5nfj.2) — one subpath per
// environment (tools/build-static-pages.js writes static-pages/dist/<sit|prod>/), always
// trailing-slash. showAbout() (onOpen.js) appends 'sit/' or 'prod/' based on APP_DEPLOY_TARGET.
const STATIC_PAGES_BASE_URL_ = 'https://stuartdonaldson.github.io/F3Go30/';
