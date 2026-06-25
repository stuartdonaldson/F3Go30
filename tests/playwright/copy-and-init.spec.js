/**
 * Creates a new month tracker in the Go30 SIT (test) environment by running
 * copyAndInit() against testScriptId — F3Go30-w6y3.
 *
 * Opens the Apps Script editor for the test script project, runs copyAndInit(),
 * and captures the execution log. The SIT spreadsheet's own NameSpace config
 * row drives short-URL generation and Email Test Mode keeps any notification
 * email confined to Site Q.
 *
 * Prerequisites:
 *   node authenticate.js   (one-time Google auth capture)
 *   npm run deploy:test    (push current code to testScriptId first)
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const {
  waitForEditorReady,
  navigateToFile,
  selectFunction,
  clickRun,
  waitForExecutionComplete,
} = require('./gas-editor-helpers');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'test/output');

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found — copy local.settings.json.example and fill in values');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test.describe('Create month tracker in SIT', () => {
  let editorUrl;

  test.beforeAll(() => {
    const settings = loadSettings();
    const scriptId = settings.testScriptId;
    if (!scriptId || scriptId.startsWith('<')) {
      throw new Error('testScriptId not set in local.settings.json');
    }
    editorUrl = `https://script.google.com/home/projects/${scriptId}/edit`;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  test('run copyAndInit against the test script project', async ({ page }) => {
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForEditorReady(page);

    await navigateToFile(page, 'CreateNewTracker');
    await selectFunction(page, 'copyAndInit');

    await clickRun(page);
    const logLines = await waitForExecutionComplete(page, 120000);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(OUTPUT_DIR, `copy-and-init-${timestamp}.txt`);
    fs.writeFileSync(outFile, logLines.join('\n') + '\n');
    console.log(`Execution log written to: ${outFile}`);
    console.log('--- Execution log ---');
    logLines.forEach(l => console.log(l));
    console.log('---------------------');

    const completedLine = logLines.find(l => l.includes('Execution completed'));
    expect(completedLine, 'Execution log must contain "Execution completed"').toBeTruthy();

    const failedLine = logLines.find(l => l.includes('Execution failed'));
    expect(failedLine, 'Execution must not have failed').toBeFalsy();
  });
});
