#!/usr/bin/env node
/**
 * One-time Google auth capture for Playwright tests.
 *
 * Run:  node authenticate.js
 *       1. Log in to Google in the browser (including MFA)
 *       2. Press ENTER to save auth and exit
 *       3. Auth stored in .auth/user.json — reused by npm run test:gaslogger
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

async function authenticate() {
  const authFile = path.resolve(__dirname, '.auth/user.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  console.log('\nGoogle Authentication Setup');
  console.log('===========================');
  console.log('1. A browser window will open');
  console.log('2. Log in with the Google account that owns the F3Go30 Apps Script project');
  console.log('3. Complete MFA if prompted');
  console.log('4. Press ENTER here once logged in\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://accounts.google.com/');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('Press ENTER when logged in... ', () => { rl.close(); resolve(); }));

  await context.storageState({ path: authFile });
  console.log(`\nAuth saved to ${authFile}`);
  console.log('Run: npm run test:gaslogger\n');

  await browser.close();
  process.exit(0);
}

authenticate().catch(err => { console.error('Auth failed:', err.message); process.exit(1); });
