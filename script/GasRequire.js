/*
 * GasRequire.js
 *
 * gasRequire_ collapses the per-symbol `(require(...) && mod.X) || (typeof globalThis !==
 * 'undefined' && globalThis.X)` preamble that every other script file used to hand-write once per
 * imported symbol (REVIEW-260910 finding; ~120 sites across 14 files, 55 of them in
 * dashboardWebapp.js alone — see docs/staging/review-260910.md's split-cache stage) down to one
 * call per required module.
 *
 * Same fallback semantics as the preamble it replaces, preserved exactly per symbol: under
 * node/test (where `module.exports` exists) it requires the named module and, for each requested
 * symbol, falls back to `globalThis` only if the module didn't export a truthy value under that
 * name; under the GAS runtime (no `module`) every top-level function/const declared in another
 * file is already a global, so every symbol resolves straight off `globalThis`.
 *
 * Callers still get one local variable per symbol at their existing `_xy_`-suffixed names — this
 * is a structural preamble collapse, not a call-site rewrite, so the ~3,000 existing call sites
 * across these files are untouched. Usage:
 *
 *   var dashboardWebappSignupModule_ = gasRequire_('./signupWebapp.js',
 *     ['getCurrentAndNextMonths_', 'selectTargetMonth_']);
 *   var getCurrentAndNextMonths_dw_ = dashboardWebappSignupModule_.getCurrentAndNextMonths_;
 *   var selectTargetMonth_dw_ = dashboardWebappSignupModule_.selectTargetMonth_;
 */
function gasRequire_(modulePath, symbolNames) {
  var mod = (typeof module !== 'undefined' && module.exports) ? require(modulePath) : null;
  var resolved = {};
  for (var i = 0; i < symbolNames.length; i++) {
    var name = symbolNames[i];
    resolved[name] = (mod && mod[name]) || (typeof globalThis !== 'undefined' && globalThis[name]);
  }
  return resolved;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gasRequire_: gasRequire_ };
}
