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
 * Every entry is stamped by log() itself with `version` (APP_VERSION) and `target`
 * (APP_DEPLOY_TARGET, e.g. TEMPLATE/TEST) from version.js, so Template and SIT-test runs
 * stay distinguishable in one shared Axiom dataset without depending on every call site
 * to add it (same pattern as GActionSheet's GasLogger).
 *
 * PII rule: never pass a raw email address or PAX name in the data object — use
 * maskPiiForLog_() / maskRecipientListForLog_() below when an address must be logged.
 */
/**
 * Maps GasLogger entries to Axiom ingest rows. Pure — no GAS globals — so it's
 * unit testable in Node. execId/runId are this project's correlation fields
 * (set by GasLogger.init()); included only when present on the entry. version/target
 * are stamped by GasLogger.log() onto every entry (so Template vs TEST runs are always
 * distinguishable in a shared dataset, without depending on every call site to add it);
 * fallbackVersion only covers entries built before that existed.
 * @param {Array<Object>} entries - Entries as built by GasLogger.log() (ts, tag, data, execId, runId?, version?, target?).
 * @param {string=} fallbackVersion - Used only when an entry has no version of its own.
 * @returns {Array<Object>} Axiom rows: { _time, name, side, version, target, ...data, execId?, runId? }.
 */
function buildAxiomRows_(entries, fallbackVersion) {
  return (entries || []).map(function(e) {
    var row = Object.assign({
      _time: e.ts,
      name: e.tag,
      side: 'gas',
      version: e.version || fallbackVersion,
      target: e.target || 'unknown'
    }, e.data || {});
    if (e.execId) row.execId = e.execId;
    if (e.runId) row.runId = e.runId;
    return row;
  });
}

/**
 * Masks a name or email so it is safe to include in a GasLogger entry (data passed to
 * GasLogger.log() must never contain a raw PAX name or email address). Keeps the first and
 * last character — an email's domain stays fully visible — replacing everything between
 * with '...'. E.g. 'Little John' -> 'L...n', 'stuart.donaldson@gmail.com' -> 's...n@gmail.com'.
 * @param {string} value
 * @returns {string}
 */
function maskPiiForLog_(value) {
  var text = String(value || '').trim();
  if (!text) return '';

  var atIndex = text.indexOf('@');
  if (atIndex > 0) {
    return maskMiddleChars_(text.slice(0, atIndex)) + text.slice(atIndex);
  }
  return maskMiddleChars_(text);
}

function maskMiddleChars_(s) {
  if (s.length <= 1) return s;
  return s[0] + '...' + s[s.length - 1];
}

/**
 * Masks each address in a comma-separated recipient list (as built by
 * buildEmailRecipientList_), handling the optional 'Display Name <email>' form.
 * @param {string} recipientList
 * @returns {string}
 */
function maskRecipientListForLog_(recipientList) {
  return String(recipientList || '').split(',').map(function(entry) {
    var trimmed = entry.trim();
    if (!trimmed) return '';
    var match = trimmed.match(/^(.*)<(.+)>$/);
    if (match) {
      var name = match[1].trim();
      var email = match[2].trim();
      return (name ? maskPiiForLog_(name) + ' ' : '') + '<' + maskPiiForLog_(email) + '>';
    }
    return maskPiiForLog_(trimmed);
  }).filter(function(entry) {
    return !!entry;
  }).join(',');
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
    var rows = buildAxiomRows_(entries);
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
    // version/target stamped here (not just at Axiom-export time) so every entry — Drive
    // or Axiom — always carries which build and which deployment target produced it,
    // without depending on ~190 call sites to remember to add it (GActionSheet precedent).
    var version = (typeof APP_VERSION !== 'undefined' && APP_VERSION) || 'unknown';
    var target = (typeof APP_DEPLOY_TARGET !== 'undefined' && APP_DEPLOY_TARGET) || 'unknown';
    var entry = { ts: new Date().toISOString(), tag: tag, data: data, execId: this._execId, version: version, target: target };
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
   * Standardizes a caught-exception log entry so every hand-rolled try/catch (an action
   * dispatcher like handleCheckinPost_ that must return a JSON error response instead of
   * rethrowing, so it can't just let the outer GasLogger.run() wrapper catch it) logs the same
   * shape as run()'s own catch: message + stack, plus whatever call-site context is useful
   * (e.g. { action: payload.action }). Before this existed, each dispatcher's catch logged
   * message only — no stack — which made a caught server_error much harder to root-cause from
   * Axiom alone (see F3Go30-yj53, where the actual failing getRange() call had to be
   * reconstructed by hand instead of read off the stack).
   * @param {string} tag   - Entry tag (e.g. 'handleCheckinPost_.error').
   * @param {Error}  err   - The caught exception.
   * @param {Object=} extra - Extra fields merged in (e.g. { action: payload.action }).
   */
  logError: function(tag, err, extra) {
    var data = Object.assign({ message: err && err.message, stack: err && err.stack }, extra || {});
    this.log(tag, data);
  },

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
    buildAxiomRows_: buildAxiomRows_,
    maskPiiForLog_: maskPiiForLog_,
    maskRecipientListForLog_: maskRecipientListForLog_
  };
}
