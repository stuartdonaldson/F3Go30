#!/usr/bin/env node
/**
 * Runs one test command and always prints the outcome summary afterwards, pass or fail
 * (F3Go30-emwk.6; `H8` — "every run prints the failure rate", not "every green run").
 *
 * A `&&`-chained report would only print on success and a `;`-chained one would swallow the
 * runner's exit code; this wrapper does neither. It clears the run's stale artifacts first (so a
 * crashed runner cannot leave the previous run's records to be re-reported as this run's), spawns
 * the command with inherited stdio, runs tools/test-outcome-report.js, and then exits with the
 * command's own exit code, untouched — a boundary fault is still red (`H6`).
 *
 * Usage:
 *   node tools/test-outcome-run.js [--junit <f>] [--outcomes <f>] [--tier <n>] [--env <e>] -- <cmd> [args...]
 */

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep === -1) {
  console.error('usage: node tools/test-outcome-run.js [report flags] -- <command> [args...]');
  process.exit(2);
}
const reportArgs = argv.slice(0, sep);
const command = argv.slice(sep + 1);
if (!command.length) {
  console.error('no command given after --');
  process.exit(2);
}

// Clear this run's artifacts so a runner that dies before writing cannot have the previous run's
// records reported as if they were this one's.
for (let i = 0; i < reportArgs.length; i += 1) {
  if (reportArgs[i] === '--junit' || reportArgs[i] === '--outcomes') {
    const f = path.resolve(ROOT, reportArgs[i + 1]);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f)) fs.rmSync(f);
  }
}

const child = spawn(command[0], command.slice(1), { stdio: 'inherit', cwd: ROOT });

child.on('error', (e) => {
  console.error(`[outcome-run] could not start '${command.join(' ')}': ${e.message}`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  const report = spawnSync(process.execPath, [path.join(ROOT, 'tools/test-outcome-report.js'), ...reportArgs], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (report.error) console.error(`[outcome-run] report failed: ${report.error.message}`);
  if (signal) process.kill(process.pid, signal);
  process.exit(code === null ? 1 : code);
});
