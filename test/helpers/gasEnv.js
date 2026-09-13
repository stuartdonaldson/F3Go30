/*
 * Composable in-memory stand-ins for the Apps Script globals the node test tier needs
 * (F3Go30-taag).
 *
 * Before this module every test file hand-rolled its own fakes: `GasLogger` in 22 files,
 * `PropertiesService` in 17, `SpreadsheetApp` in 13, `CacheService` in 7 — near-identical each
 * time, so a fix to one copy (a missing `setProperties`, a `getProperties` counter, a
 * `removeAll`) never reached the others. This is the one home for those shapes; each factory
 * mirrors the real service's contract as the production code under `script/` actually calls it,
 * nothing more.
 *
 * Two ways to use it, both fine:
 *   1. Compose by hand — `global.CacheService = { getScriptCache: () => makeFakeCache_() }` —
 *      when a test wants unusual wiring.
 *   2. `installGasEnv_({...})` — installs the services asked for onto `globalThis`, hands back
 *      the underlying fakes so assertions can inspect them, and returns a `restore()` that puts
 *      the previous globals back.
 *
 * Deliberately NOT here: `SpreadsheetApp` sheet/spreadsheet mocks. Every test's sheet is a
 * different shape (bonus rows, response columns, roster indexes) and a "generic" sheet fake
 * would be a fiction each caller has to fight. What IS here is the small, genuinely uniform part:
 * the `SpreadsheetApp` service object itself and the `Ui` prompt/alert recorder the sheet-menu
 * tests all copy.
 */

/**
 * In-memory `PropertiesService.getScriptProperties()` store.
 * Records `getProperties()` calls (`_getPropertiesCalls`) because that count is the thing the
 * per-execution snapshot bead exists to reduce, and exposes `_failGetProperties` so a test can
 * make the whole-store read throw the way a quota'd-out GAS execution does.
 * @param {!Object<string,string>=} seed initial key/value pairs.
 */
function makeFakeProperties_(seed) {
  var store = {};
  Object.keys(seed || {}).forEach(function(key) { store[key] = String(seed[key]); });
  var self;
  self = {
    getProperty: function(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setProperty: function(key, value) { store[key] = String(value); return self; },
    // F3Go30-5xmk: arity is enforced because the real Apps Script bridge enforces it. GAS exposes
    // setProperties(Object) and setProperties(Object, Boolean); passing an explicit non-boolean
    // second argument matches neither overload and throws. A plain JS double that ignores extra
    // arguments cannot reproduce that, which is exactly how the facade shipped to PROD forwarding
    // an undefined `deleteAllOthers` with a green suite behind it.
    setProperties: function(properties, deleteAllOthers) {
      if (arguments.length > 1 && typeof deleteAllOthers !== 'boolean') {
        throw new Error('The parameters (Object,' + deleteAllOthers +
          ') don\'t match the method signature for PropertiesService.Properties.setProperties.');
      }
      if (self._failSetProperties) throw new Error('PropertiesService unavailable');
      Object.keys(properties || {}).forEach(function(key) {
        store[key] = String(properties[key]);
      });
      return self;
    },
    deleteProperty: function(key) { delete store[key]; return self; },
    deleteAllProperties: function() {
      Object.keys(store).forEach(function(key) { delete store[key]; });
      return self;
    },
    getKeys: function() { return Object.keys(store); },
    getProperties: function() {
      self._getPropertiesCalls++;
      if (self._failGetProperties) throw new Error('PropertiesService unavailable');
      return Object.assign({}, store);
    },
    _store: store,
    _getPropertiesCalls: 0,
    _failGetProperties: false,
    _failSetProperties: false,
  };
  return self;
}

/**
 * In-memory `CacheService.getScriptCache()` cache. Covers the four methods the production code
 * calls — get/put/remove/removeAll — and nothing else; `put`'s TTL argument is accepted and
 * ignored, since no node test can observe expiry.
 */
function makeFakeCache_() {
  var store = {};
  var self;
  self = {
    get: function(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    put: function(key, value) { store[key] = String(value); },
    remove: function(key) { delete store[key]; },
    removeAll: function(keys) {
      (keys || []).forEach(function(key) { delete store[key]; });
    },
    _store: store,
  };
  return self;
}

/**
 * `GasLogger` stand-in. `run(name, fn)` invokes `fn` and returns its value (the real one wraps
 * with timing/error reporting); every call is recorded so a test can assert on what was logged
 * without stubbing a second time.
 */
function makeFakeLogger_() {
  var self = {
    log: function() { self._logs.push(Array.prototype.slice.call(arguments)); },
    logError: function() { self._errors.push(Array.prototype.slice.call(arguments)); },
    run: function(name, fn) { self._runs.push(name); return fn(); },
    _logs: [],
    _errors: [],
    _runs: [],
  };
  return self;
}

/**
 * `LockService` lock. Single-process node tests never contend, so this only has to satisfy the
 * waitLock/releaseLock/tryLock contract the production callers use. `_waits`/`_releases` are
 * counted for the tests that assert a lock was actually taken.
 */
function makeFakeLock_() {
  var self = {
    waitLock: function() { self._waits++; return true; },
    tryLock: function() { self._waits++; return true; },
    releaseLock: function() { self._releases++; },
    hasLock: function() { return true; },
    _waits: 0,
    _releases: 0,
  };
  return self;
}

/**
 * `SpreadsheetApp.getUi()` recorder for the sheet-menu tests: every `alert(...)` argument list
 * lands in `_alerts`, and `prompt(...)` answers with the configured button/text.
 * @param {{promptButton: (string|undefined), promptText: (string|undefined)}=} options
 */
function makeFakeUi_(options) {
  options = options || {};
  var self = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    alert: function() { self._alerts.push(Array.prototype.slice.call(arguments)); return 'OK'; },
    prompt: function() {
      self._prompts.push(Array.prototype.slice.call(arguments));
      return {
        getSelectedButton: function() {
          return options.promptButton === undefined ? 'OK' : options.promptButton;
        },
        getResponseText: function() { return options.promptText || ''; },
      };
    },
    createMenu: function(name) {
      var menu = {
        _name: name,
        addItem: function(caption, fnName) { self._menuItems.push([name, caption, fnName]); return menu; },
        addSeparator: function() { return menu; },
        addSubMenu: function() { return menu; },
        addToUi: function() { self._menus.push(name); },
      };
      return menu;
    },
    _alerts: [],
    _prompts: [],
    _menus: [],
    _menuItems: [],
  };
  return self;
}

/**
 * Install fakes onto `globalThis` and hand back the underlying objects.
 *
 * Every key is opt-in: pass `true` for a default fake, an options object where the factory takes
 * one, or a ready-made object to install verbatim (`{spreadsheetApp: {openById: ...}}`) — which
 * is how a test keeps its own sheet mocks while still sharing the uniform parts.
 *
 * @param {{
 *   properties: (boolean|!Object|undefined),
 *   cache: (boolean|!Object|undefined),
 *   logger: (boolean|undefined),
 *   lock: (boolean|undefined),
 *   ui: (boolean|!Object|undefined),
 *   spreadsheetApp: (boolean|!Object|undefined),
 * }=} options
 * @return {!Object} handles: `{properties, cache, logger, lock, ui, restore}`.
 */
function installGasEnv_(options) {
  options = options || {};
  var saved = {};
  var handles = {};

  function install_(name, value) {
    if (!Object.prototype.hasOwnProperty.call(saved, name)) saved[name] = globalThis[name];
    globalThis[name] = value;
  }

  if (options.properties) {
    handles.properties = makeFakeProperties_(
      options.properties === true ? undefined : options.properties);
    install_('PropertiesService', {
      getScriptProperties: function() { return handles.properties; },
    });
  }

  if (options.cache) {
    handles.cache = makeFakeCache_();
    install_('CacheService', { getScriptCache: function() { return handles.cache; } });
  }

  if (options.logger) {
    handles.logger = makeFakeLogger_();
    install_('GasLogger', handles.logger);
  }

  if (options.lock) {
    handles.lock = makeFakeLock_();
    install_('LockService', { getScriptLock: function() { return handles.lock; } });
  }

  if (options.ui || options.spreadsheetApp) {
    handles.ui = options.ui
      ? makeFakeUi_(options.ui === true ? undefined : options.ui)
      : null;
    var app = (options.spreadsheetApp && options.spreadsheetApp !== true)
      ? Object.assign({}, options.spreadsheetApp)
      : {};
    if (handles.ui && !app.getUi) app.getUi = function() { return handles.ui; };
    install_('SpreadsheetApp', app);
  }

  handles.restore = function() {
    Object.keys(saved).forEach(function(name) {
      if (saved[name] === undefined) delete globalThis[name];
      else globalThis[name] = saved[name];
    });
  };
  return handles;
}

module.exports = {
  makeFakeProperties_,
  makeFakeCache_,
  makeFakeLogger_,
  makeFakeLock_,
  makeFakeUi_,
  installGasEnv_,
};
