/**
 * GasLogger live test — F3Go30-d2b
 *
 * Opens the Apps Script editor, runs testGasLogger(), captures Logger output
 * to test/output/gaslogger-{timestamp}.txt, then verifies shared Drive output
 * via test/test_gas_logger_live.py.
 *
 * Prerequisites:
 *   node authenticate.js   (one-time Google auth capture)
 *   npm run test:gaslogger
 */
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
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
const PYTHON = '/mnt/c/dev/venvs/uv1/bin/python';

function loadSettings() {
  const p = path.join(ROOT, 'local.settings.json');
  if (!fs.existsSync(p)) throw new Error('local.settings.json not found — copy local.settings.json.example and fill in values');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test.describe('GasLogger live run', () => {
  let editorUrl;

  test.beforeAll(() => {
    const settings = loadSettings();
    // Renamed from SCRIPT_ID_PROD when local.settings.json went multi-target
    // (docs/deployment-model.md Phase 1 migration) — F3Go30-kb8o.
    const scriptId = settings.templateScriptId;
    if (!scriptId || scriptId.startsWith('<')) {
      throw new Error('templateScriptId not set in local.settings.json');
    }
    editorUrl = `https://script.google.com/home/projects/${scriptId}/edit`;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  test('AC1-AC6: run testGasLogger and verify Drive output', async ({ page }) => {
    // AC1: open editor with stored auth
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForEditorReady(page);

    // AC2: navigate to Utilities file and select function
    await navigateToFile(page, 'Utilities');
    await selectFunction(page, 'testGasLogger');

    // AC3: run and wait for completion
    await clickRun(page);
    const logLines = await waitForExecutionComplete(page, 90000);

    // AC4: write Logger output to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(OUTPUT_DIR, `gaslogger-${timestamp}.txt`);
    fs.writeFileSync(outFile, logLines.join('\n') + '\n');
    console.log(`Logger output written to: ${outFile}`);
    console.log('--- Execution log ---');
    logLines.forEach(l => console.log(l));
    console.log('---------------------');

    // Confirm the GAS function completed successfully
    const completedLine = logLines.find(l => l.includes('Execution completed'));
    expect(completedLine, 'Execution log must contain "Execution completed"').toBeTruthy();

    const failedLine = logLines.find(l => l.includes('Execution failed'));
    expect(failedLine, 'Execution must not have failed').toBeFalsy();

    // AC5: run Python verifier against shared Drive output
    console.log('\nRunning test/test_gas_logger_live.py ...');
    try {
      const result = execFileSync(
        PYTHON,
        [path.join(ROOT, 'test/test_gas_logger_live.py')],
        { encoding: 'utf8', timeout: 90000 }
      );
      console.log(result);
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      throw new Error(`test_gas_logger_live.py failed:\n${output}`);
    }

    // AC6: if we reach here, full run completed without user interaction
    console.log('All AC passed.');
  });
});
