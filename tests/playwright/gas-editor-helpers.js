/**
 * Playwright helpers for the Google Apps Script editor UI.
 *
 * Targets the IDE at: https://script.google.com/home/projects/{SCRIPT_ID}/edit
 * NOT the same as gas-playwright-testing helpers (those target deployed web apps).
 *
 * Selectors confirmed from ARIA snapshot captured 2026-05-08:
 *   - File list:       role=listbox  name="Project files"
 *   - File item:       role=option   (child of "Project files" listbox)
 *   - Function picker: role=listbox  name="Select function to run"
 *   - Run button:      role=button   name="Run the selected function"
 *   - Log panel open:  role=button   name="Open the execution log panel"
 */

/**
 * Wait for the Apps Script editor to finish loading the project.
 * Signal: "Select function to run" listbox becomes visible in the toolbar.
 */
async function waitForEditorReady(page, timeout = 45000) {
  await page.getByRole('listbox', { name: 'Select function to run' })
    .waitFor({ state: 'visible', timeout });
}

/**
 * Click on a file in the left file-explorer panel.
 * The file list is role=listbox "Project files"; options are named "Utilities.gs" etc.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} filename  - Base name without extension, e.g. 'Utilities'
 */
async function navigateToFile(page, filename) {
  const fileList = page.getByRole('listbox', { name: 'Project files' });
  // Options are named "Filename.gs" — try exact gs name first, then partial
  const gsName = filename.endsWith('.gs') ? filename : `${filename}.gs`;
  let option = fileList.getByRole('option', { name: gsName, exact: true });
  if (await option.count() === 0) {
    option = fileList.getByRole('option', { name: filename });
  }
  await option.click({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

/**
 * Select a function in the toolbar function picker.
 * The picker is role=listbox "Select function to run" — options are always visible.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} funcName  - Exact function name, e.g. 'testGasLogger'
 */
async function selectFunction(page, funcName) {
  const picker = page.getByRole('listbox', { name: 'Select function to run' });
  await picker.waitFor({ state: 'visible', timeout: 10000 });

  // Check if already selected — if so, skip
  const selected = picker.getByRole('option', { name: funcName, exact: true });
  if (await selected.count() > 0) {
    const isSelected = await selected.getAttribute('aria-selected');
    if (isSelected === 'true') return;
  }

  // Click to open the dropdown list
  await picker.click();
  await page.getByRole('option', { name: funcName, exact: true })
    .click({ timeout: 5000 });
}

/**
 * Click the Run button in the Apps Script editor toolbar.
 * Confirmed aria name: "Run the selected function"
 */
async function clickRun(page) {
  const runBtn = page.getByRole('button', { name: 'Run the selected function' });
  await runBtn.waitFor({ state: 'visible', timeout: 10000 });
  await runBtn.click();
}

/**
 * Ensure the execution log panel is open, then wait for completion.
 * Returns log lines as a string array.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout  - Max ms to wait for completion
 * @returns {string[]}
 */
async function waitForExecutionComplete(page, timeout = 90000) {
  // Open the log panel if it isn't already open
  const openBtn = page.getByRole('button', { name: 'Open the execution log panel' });
  if (await openBtn.count() > 0) {
    await openBtn.click().catch(() => {}); // may already be open
  }
  await page.waitForTimeout(500);

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await captureExecutionLogText(page);
    if (text.includes('Execution completed') || text.includes('Execution failed')) {
      return text.split('\n').filter(l => l.trim() && !isUiChrome(l));
    }
    await page.waitForTimeout(2000);
  }

  const partial = await captureExecutionLogText(page);
  throw new Error(
    `Execution did not complete within ${timeout / 1000}s.\nLog so far:\n${partial}`
  );
}

/**
 * Extract visible text from the execution log panel.
 *
 * The panel is opened by "Open the execution log panel" button.
 * It has a close button aria-labeled "Close execution logs pane".
 * Entries look like: "6:23:08 PM  Info  [testGasLogger_] complete..."
 *
 * @returns {string}
 */
async function captureExecutionLogText(page) {
  // The log panel region sits near the "Close execution logs pane" button.
  // Grab its parent container text.
  const closeBtn = page.getByRole('button', { name: 'Close execution logs pane' });
  if (await closeBtn.count() > 0) {
    // Walk up to the panel container and grab its text
    const panelText = await page.evaluate(() => {
      const closeEl = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent.includes('close') && b.getAttribute('aria-label')?.includes('execution')
      );
      if (!closeEl) return '';
      // The log panel is a sibling or nearby container — grab the region
      const region = closeEl.closest('[role="region"]') ||
                     closeEl.closest('section') ||
                     closeEl.parentElement?.parentElement;
      return region ? region.innerText : '';
    });
    if (panelText.trim()) return panelText.trim();
  }

  // Fallback: filter body text for GAS log-line patterns
  // "6:23:08 PM  Info  message" or "Execution started/completed/failed"
  const allText = await page.evaluate(() => document.body.innerText);
  const logLines = allText.split('\n').filter(
    l => /\d+:\d+:\d+\s+(AM|PM)/.test(l) || /Execution (started|completed|failed)/.test(l)
  );
  return logLines.join('\n');
}

/** Filter out UI chrome lines that leak into the log panel text. */
function isUiChrome(line) {
  const t = line.trim();
  return t === 'close' || t === 'Close execution logs' || t === 'Execution log';
}

module.exports = {
  waitForEditorReady,
  navigateToFile,
  selectFunction,
  clickRun,
  waitForExecutionComplete,
  captureExecutionLogText,
};
