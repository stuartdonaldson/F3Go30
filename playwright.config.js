const { defineConfig } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const authFile = path.resolve(__dirname, '.auth/user.json');

if (!fs.existsSync(authFile)) {
  console.error('\nERROR: .auth/user.json not found. Run: node authenticate.js\n');
  // Don't throw here — let the test itself surface the error with context
}

module.exports = defineConfig({
  testDir: './tests/playwright',
  timeout: 120000,        // GAS editor is slow to initialise
  expect: { timeout: 15000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    storageState: authFile,
    headless: false,      // GAS editor requires a real viewport; headless blocks some UI interactions
    viewport: { width: 1280, height: 900 },
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
