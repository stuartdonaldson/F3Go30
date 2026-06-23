/**
 * Drive-mapped structured logging for server-side test validation, with an
 * optional Axiom sink.
 *
 * Creates one log file per execution run in a Drive subfolder (F3Go30/).
 * All GasLogger.log() entries within a run share the same execId and go
 * to the same file — one file per execution run, not one file per flush().
 *
 * Setup (run once from the GAS editor after pushing):
 *   setScriptProperty('GAS_LOGGER_PARENT_FOLDER_ID', '<Drive folder ID>');
 *
 * Axiom is optional: set AXIOM_TOKEN + AXIOM_DATASET script properties to
 * enable it. Once both are set, flush() POSTs to Axiom EXCLUSIVELY — it does
 * not also write the Drive file, even if the POST fails. A broken Axiom pipe
 * is meant to surface as a visible gap (Logger.log only), not be silently
 * absorbed by falling back to Drive. Unset either property to revert to
 * Drive-only behavior with zero code changes.
 *
 * Usage:
 *   GasLogger.run('triggerName', function() { ... });  // preferred — see below
 *
 *   // or manually:
 *   GasLogger.init('triggerName');           // call at start of each trigger
 *   GasLogger.log('tag', { key: value });    // accumulate + Logger.log()
 *   GasLogger.flush();                       // write to Drive or Axiom at end of execution
 *
 * GasLogger.run(triggerName, fn) wraps an entry point (simple trigger, time-driven
 * trigger, menu item) so init/flush happen automatically: it calls init(), runs fn(),
 * and flushes in a finally block so accumulated entries are written even if fn() throws
 * or returns early. Apps Script has no execution-end hook, so every entry point that
 * wants guaranteed flushing must go through run() (or call flush() itself before every
 * return path) — wrapping the one entry-point function is far cheaper than auditing every
 * return statement in its call tree.
 *
 * If GAS_LOGGER_PARENT_FOLDER_ID is not set and Axiom isn't configured, Drive
 * writes are skipped silently. Logger.log() always fires regardless of sink
 * availability.
 *
 * PII rule: never pass email addresses or PAX names in the data object.
 */
/**
 * Maps GasLogger entries to Axiom ingest rows. Pure — no GAS globals — so it's
 * unit testable in Node. execId/runId are this project's correlation fields
 * (set by GasLogger.init()); included only when present on the entry.
 * @param {Array<Object>} entries - Entries as built by GasLogger.log() (ts, tag, data, execId, runId?).
 * @param {string} version - Stamped onto every row (e.g. APP_VERSION).
 * @returns {Array<Object>} Axiom rows: { _time, name, side, version, ...data, execId?, runId? }.
 */
function buildAxiomRows_(entries, version) {
  return (entries || []).map(function(e) {
    var row = Object.assign({ _time: e.ts, name: e.tag, side: 'gas', version: version }, e.data || {});
    if (e.execId) row.execId = e.execId;
    if (e.runId) row.runId = e.runId;
    return row;
  });
}

var GasLogger = {
  _folder: null,
  _entries: [],
  _enabled: true,
  _execId: null,
  _runId: null,
  _fileId: null,
  _axiomConfig: null,

  /**
   * Call at the start of every trigger function.
   * Generates a fresh execId and reads the optional test runId from Script Properties.
   * @param {string} triggerName - Caller name for the init log line.
   * @returns {string} The generated execId.
   */
  init: function(triggerName) {
    this._execId = Utilities.getUuid();
    this._runId = PropertiesService.getScriptProperties().getProperty('F3GO30_TEST_RUN_ID') || null;
    this._entries = [];
    this._fileId = null;
    Logger.log('[GasLogger] init — trigger=' + triggerName +
      ' execId=' + this._execId + (this._runId ? ' runId=' + this._runId : ''));
    return this._execId;
  },

  _getFolder: function() {
    if (this._folder) return this._folder;
    var parentId = PropertiesService.getScriptProperties().getProperty('GAS_LOGGER_PARENT_FOLDER_ID');
    if (!parentId) {
      Logger.log('[GasLogger] GAS_LOGGER_PARENT_FOLDER_ID not set — Drive writes disabled');
      return null;
    }
    try {
      var parent = DriveApp.getFolderById(parentId);
      var iter = parent.getFoldersByName('F3Go30');
      this._folder = iter.hasNext() ? iter.next() : parent.createFolder('F3Go30');
      return this._folder;
    } catch (e) {
      Logger.log('[GasLogger] _getFolder failed: ' + e);
      return null;
    }
  },

  _getAxiomConfig: function() {
    if (this._axiomConfig) return this._axiomConfig;
    var props = PropertiesService.getScriptProperties();
    this._axiomConfig = {
      token: props.getProperty('AXIOM_TOKEN'),
      dataset: props.getProperty('AXIOM_DATASET')
    };
    return this._axiomConfig;
  },

  _postToAxiom: function(entries) {
    var config = this._getAxiomConfig();
    var version = (typeof APP_VERSION !== 'undefined' && APP_VERSION) || 'unknown';
    var rows = buildAxiomRows_(entries, version);
    try {
      var resp = UrlFetchApp.fetch(
        'https://api.axiom.co/v1/datasets/' + config.dataset + '/ingest',
        {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + config.token },
          payload: JSON.stringify(rows),
          muteHttpExceptions: true
        }
      );
      if (resp.getResponseCode() >= 300) {
        // Visible in clasp logs (Stackdriver) only — never recurse through GasLogger.log()
        // itself, and intentionally not written to Drive either (see file header).
        Logger.log('[GasLogger] Axiom ingest non-2xx ' + resp.getResponseCode() + ': ' + resp.getContentText());
      }
    } catch (e) {
      Logger.log('[GasLogger] Axiom POST threw: ' + e);
    }
  },

  /**
   * Accumulate a structured log entry. Also writes to Logger.log().
   * @param {string}  tag    - Entry type (e.g. 'copyAndInit', 'formSubmit.processed').
   * @param {Object}  data   - Payload. Must not contain email addresses or PAX names.
   * @param {boolean} flush  - If true, flush accumulated entries to Drive immediately.
   * @param {boolean} newLog - If true, reset the file reference after flushing so the
   *                           next flush() creates a new file for subsequent entries.
   */
  log: function(tag, data, flush, newLog) {
    if (!this._execId) this.init('auto');
    var entry = { ts: new Date().toISOString(), tag: tag, data: data, execId: this._execId };
    if (this._runId) entry.runId = this._runId;
    Logger.log('[GasLogger] ' + JSON.stringify(entry));
    if (this._enabled) this._entries.push(entry);
    if (flush) this.flush();
    if (newLog) this._fileId = null;
  },

  /**
   * Write accumulated entries to Drive. Call once at the end of each trigger function.
   * First call creates the execution-run file; subsequent calls append to it.
   */
  flush: function() {
    if (!this._enabled || this._entries.length === 0) return;

    var axiomConfig = this._getAxiomConfig();
    if (axiomConfig.token && axiomConfig.dataset) {
      this._postToAxiom(this._entries);
      this._entries = [];
      return;
    }

    var folder = this._getFolder();
    if (!folder) { this._entries = []; return; }
    var content = this._entries.map(function(e) { return JSON.stringify(e); }).join('\n');
    try {
      if (this._fileId) {
        // Append to the execution-run file (read + overwrite — Drive has no native append)
        var existing = DriveApp.getFileById(this._fileId).getBlob().getDataAsString();
        var newContent = existing + (existing ? '\n' : '') + content;
        UrlFetchApp.fetch(
          'https://www.googleapis.com/upload/drive/v3/files/' + this._fileId + '?uploadType=media',
          {
            method: 'PATCH',
            contentType: 'text/plain; charset=UTF-8',
            payload: newContent,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
            muteHttpExceptions: true
          }
        );
      } else {
        // First flush for this execution run — create the file
        var filename = new Date().getTime() + '-' + (this._execId || Utilities.getUuid()) + '.log';
        var file = folder.createFile(filename, content, MimeType.PLAIN_TEXT);
        this._fileId = file.getId();
      }
    } catch (e) {
      Logger.log('[GasLogger] flush failed: ' + e);
    }
    this._entries = [];
  },

  enable: function() { this._enabled = true; },
  disable: function() { this._enabled = false; },

  /**
   * Wraps an entry-point function with init/flush so callers don't have to manage the
   * lifecycle by hand. On error, logs the error entry, flushes, then rethrows — a thrown
   * error still surfaces as a failed execution (so Apps Script's trigger-failure email,
   * the executions log, etc. all see it) while guaranteeing the accumulated entries are
   * not lost.
   * @param {string}   triggerName - Passed to init(); identifies this execution in logs.
   * @param {Function} fn          - The entry-point body. No arguments — close over them.
   * @returns {*} fn()'s return value.
   */
  run: function(triggerName, fn) {
    this.init(triggerName);
    try {
      return fn();
    } catch (e) {
      this.log('error', { message: e && e.message, stack: e && e.stack });
      throw e;
    } finally {
      this.flush();
    }
  }
};

/** Run from GAS editor to configure without opening Script Properties UI manually. */
function setScriptProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function getScriptProperty(key) {
  Logger.log(PropertiesService.getScriptProperties().getProperty(key));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildAxiomRows_: buildAxiomRows_
  };
}
