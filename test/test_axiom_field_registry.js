const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-u7nk: the Axiom dataset has a hard 256-field limit, and a batch that introduces a
// field past it is rejected whole (silently — every row in the batch is lost). Field use must
// therefore be deliberate: a new top-level log field name has to be added to
// test/fixtures/axiomFieldRegistry.json (and the budget re-checked with
// `python tools/axiom_admin.py schema`) in the same change that introduces it.
//
// New tag-specific data goes under the `ctx` map field — GasLogger.log('tag', { ctx: { a, b } }) —
// so it costs no field budget. Objects whose keys are open-ended (query params) belong in `mapFields`: they are declared as
// Axiom map fields (`python tools/axiom_admin.py apply-registry`), so their keys never count.

global.HtmlService = {
  createTemplateFromFile: function() { return {}; },
  createHtmlOutputFromFile: function() { return { getContent: function() { return ''; } }; }
};
global.ScriptApp = { getService: function() { return { getUrl: function() { return 'https://example.com/exec'; } }; } };
installGasEnv_({ logger: true, properties: true });

const { buildWebAppRequestLog_ } = require('../script/WebApp.js');

const ROOT = path.join(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'axiomFieldRegistry.json'), 'utf8'));
const allowed = new Set([...registry.fields, ...registry.mapFields]);

// Fields GasLogger itself / Axiom adds to every row (see buildAxiomRows_, GasLogger.log).
const ROW_ENVELOPE = ['_time', 'name', 'side', 'version', 'target', 'execId', 'runId'];
// GasLogger.logError merges these into every error entry.
const LOG_ERROR_BASE = ['message', 'stack'];

function listJs_(dir) {
  return fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, dir, f));
}

/** Index just past the bracket matching the opener at `start`, skipping string literals. */
function matchClose_(src, start) {
  var depth = 0;
  for (var i = start; i < src.length; i++) {
    var c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) { if (src[i] === '\\') i++; }
    } else if (c === '{' || c === '(' || c === '[') {
      depth++;
    } else if (c === '}' || c === ')' || c === ']') {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Top-level keys of an object-literal source text `{ ... }` (spreads and computed keys skipped). */
function topLevelKeys_(literal) {
  var keys = [];
  var body = literal.slice(1, -1);
  var depth = 0;
  var tokenStart = 0;
  function take_(seg) {
    var m = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:([A-Za-z_$][\w$]*)|'([^']+)'|"([^"]+)")\s*(:|,|$)/.exec(seg);
    if (m) keys.push(m[1] || m[2] || m[3]);
  }
  for (var i = 0; i < body.length; i++) {
    var c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < body.length && body[i] !== c; i++) { if (body[i] === '\\') i++; }
    } else if (c === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++;
    } else if (c === '{' || c === '(' || c === '[') {
      depth++;
    } else if (c === '}' || c === ')' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      take_(body.slice(tokenStart, i + 1));
      tokenStart = i + 1;
    }
  }
  take_(body.slice(tokenStart));
  return keys;
}

/** Every literal `GasLogger.log('tag', { ... })` / `.logError('tag', err, { ... })` payload key. */
function scanLoggedFields_() {
  var found = new Map(); // field -> "file: tag"
  var files = listJs_('script');
  files.forEach(function(file) {
    var src = fs.readFileSync(file, 'utf8');
    var re = /GasLogger\.(log|logError)\(/g;
    var m;
    while ((m = re.exec(src))) {
      var open = m.index + m[0].length - 1;
      var close = matchClose_(src, open);
      if (close < 0) continue;
      var args = src.slice(open + 1, close - 1);
      var tag = (/^\s*['"]([^'"]+)['"]/.exec(args) || [])[1] || '(dynamic tag)';
      var at = path.basename(file) + ': ' + tag;
      if (m[1] === 'logError') LOG_ERROR_BASE.forEach(function(k) { if (!found.has(k)) found.set(k, at); });
      // Find the first top-level '{' argument that starts an object literal.
      var depth = 0;
      for (var i = 0; i < args.length; i++) {
        var c = args[i];
        if (c === '"' || c === "'" || c === '`') {
          for (i++; i < args.length && args[i] !== c; i++) { if (args[i] === '\\') i++; }
        } else if (c === '{' && depth === 0) {
          var end = matchClose_(args, i);
          topLevelKeys_(args.slice(i, end)).forEach(function(k) { if (!found.has(k)) found.set(k, at); });
          i = end - 1;
        } else if (c === '(' || c === '[' || c === '{') {
          depth++;
        } else if (c === ')' || c === ']' || c === '}') {
          depth--;
        }
      }
    }
  });
  return found;
}

describe('Axiom field registry (F3Go30-u7nk)', function() {
  it('every literally-logged top-level field name is registered', function() {
    var missing = [];
    scanLoggedFields_().forEach(function(where, field) {
      if (!allowed.has(field) && ROW_ENVELOPE.indexOf(field) < 0) missing.push(field + '  (first seen: ' + where + ')');
    });
    assert.deepEqual(missing, [],
      'New Axiom log field name(s) must be added to test/fixtures/axiomFieldRegistry.json — the dataset has a\n' +
      '256-field limit and a batch that exceeds it is dropped whole. Check headroom with\n' +
      '`python tools/axiom_admin.py schema` first:\n  ' + missing.join('\n  '));
  });

  it('every top-level field of the webapp request log is registered', function() {
    var log = buildWebAppRequestLog_({ parameter: { cmd: 'checkin' }, parameters: { cmd: ['checkin'] }, queryString: 'cmd=checkin' });
    var missing = Object.keys(log).filter(function(k) { return !allowed.has(k); });
    assert.deepEqual(missing, []);
  });

  it('open-ended request objects are declared as map fields', function() {
    // parameter/parameters carry arbitrary query keys (even UUIDs); flattened they ate 26 fields.
    // ctx is the catch-all for new tag-specific data: put it under ctx, not a new top-level field.
    ['parameter', 'parameters', 'postData', 'reloaded', 'ctx'].forEach(function(k) {
      assert.ok(registry.mapFields.indexOf(k) >= 0, k + ' must be a map field');
    });
    registry.mapFields.forEach(function(k) {
      assert.equal(registry.fields.indexOf(k), -1, k + ' must not also be a plain field');
    });
  });

  it('registry stays within the dataset budget with headroom kept', function() {
    assert.equal(new Set(registry.fields).size, registry.fields.length, 'registry.fields has duplicates');
    assert.ok(registry.fields.length <= registry.budget,
      registry.fields.length + ' registered fields exceeds the deliberate budget of ' + registry.budget);
    assert.ok(registry.budget <= 256 - 16, 'budget must leave >=16 of Axiom\'s 256 fields as headroom');
  });
});

module.exports = { scanLoggedFields_, topLevelKeys_ };
