const assert = require('node:assert/strict');
const test = require('node:test');
const { installGasEnv_ } = require('./helpers/gasEnv.js');

// F3Go30-61ln.1/.3 (ADR-024): retiring the HC Google Form.
const env = installGasEnv_({ logger: true });

function makeFakeForm_(id, opts) {
  opts = opts || {};
  const form = {
    _accepting: opts.accepting !== false,
    _message: opts.message || '',
    _linked: opts.linked !== false,
    getId: () => id,
    isAcceptingResponses: () => form._accepting,
    setAcceptingResponses: (v) => { form._accepting = v; return form; },
    getCustomClosedFormMessage: () => form._message,
    setCustomClosedFormMessage: (m) => { form._message = m; return form; },
    removeDestination: () => { form._linked = false; return form; },
  };
  return form;
}

const forms = {};
const trashed = [];
globalThis.FormApp = {
  openById: (id) => { if (!forms[id]) throw new Error('No item with the given ID could be found'); return forms[id]; },
  openByUrl: (url) => { const id = url.replace('url:', ''); if (!forms[id]) throw new Error('no access'); return forms[id]; },
};
globalThis.DriveApp = { getFileById: (id) => ({ setTrashed: (v) => trashed.push(id + ':' + v) }) };

const { retireCopiedHcForm_, planHcFormClosures_, closeHcForms_, HC_FORM_CLOSED_MESSAGE_PREFIX_ } = require('../script/hcFormRetirement.js');

// --- retireCopiedHcForm_ (moved from CreateNewTracker.js) ---

test('retireCopiedHcForm_: no linked Form -> left alone', () => {
  assert.deepEqual(retireCopiedHcForm_({ getFormUrl: () => null }), { retired: false });
});

test('retireCopiedHcForm_: linked Form is unlinked and trashed', () => {
  forms.f1 = makeFakeForm_('f1'); trashed.length = 0;
  assert.deepEqual(retireCopiedHcForm_({ getFormUrl: () => 'url:f1' }), { retired: true, formId: 'f1' });
  assert.equal(forms.f1._linked, false);
  assert.deepEqual(trashed, ['f1:true']);
});

test('retireCopiedHcForm_: a failure is reported and logged, never thrown', () => {
  const result = retireCopiedHcForm_({ getFormUrl: () => 'url:gone' });
  assert.equal(result.retired, false);
  assert.equal(result.error, 'no access');
  assert.ok(env.logger._logs.some((e) => /retireCopiedHcForm_/.test(e[0])));
});

// --- planHcFormClosures_ ---

test('planHcFormClosures_: unique non-blank FormIds from TrackerDB rows', () => {
  const plan = planHcFormClosures_({
    a: { sheetId: 'a', formId: 'f1' }, b: { sheetId: 'b', formId: '' }, c: { sheetId: 'c', formId: 'f2' }, d: { sheetId: 'd', formId: 'f1' },
  });
  assert.deepEqual(plan, ['f1', 'f2']);
});

// --- closeHcForms_ ---

const SIGNUP_URL = 'https://f3go30.github.io/static-pages/dist/sit/?cmd=signup';

function setup_() {
  Object.keys(forms).forEach((k) => delete forms[k]);
  forms.f1 = makeFakeForm_('f1');
  forms.f2 = makeFakeForm_('f2', { accepting: false, message: HC_FORM_CLOSED_MESSAGE_PREFIX_ + SIGNUP_URL });
  forms.tpl = makeFakeForm_('tpl');
  return {
    template: { getFormUrl: () => (forms.tpl._linked ? 'url:tpl' : null) },
    rowsBySheetId: { a: { formId: 'f1' }, b: { formId: 'f2' }, c: { formId: 'missing' } },
  };
}

test('AC1 closeHcForms_ dryRun changes nothing and lists what it would do', () => {
  const { template, rowsBySheetId } = setup_();
  const result = closeHcForms_(template, rowsBySheetId, { dryRun: true, signupUrl: SIGNUP_URL });
  assert.deepEqual(result, {
    ok: true, dryRun: true, closed: ['f1', 'tpl'], alreadyClosed: ['f2'], missing: ['missing'], messageFailed: [],
    templateFormId: 'tpl', templateUnlinked: false,
  });
  assert.equal(forms.f1._accepting, true);
  assert.equal(forms.tpl._linked, true);
});

test('AC2/AC3/AC4 closeHcForms_ closes each Form with the sign-up link, unlinks the Template Form, reports a missing Form; rerun is all alreadyClosed', () => {
  const { template, rowsBySheetId } = setup_();
  const result = closeHcForms_(template, rowsBySheetId, { signupUrl: SIGNUP_URL });
  assert.deepEqual(result, {
    ok: true, dryRun: false, closed: ['f1', 'tpl'], alreadyClosed: ['f2'], missing: ['missing'], messageFailed: [],
    templateFormId: 'tpl', templateUnlinked: true,
  });
  ['f1', 'tpl'].forEach((id) => {
    assert.equal(forms[id]._accepting, false);
    assert.equal(forms[id]._message, HC_FORM_CLOSED_MESSAGE_PREFIX_ + SIGNUP_URL);
  });
  assert.equal(template.getFormUrl(), null, 'Template no longer has a linked Form');

  const rerun = closeHcForms_(template, rowsBySheetId, { signupUrl: SIGNUP_URL });
  assert.deepEqual(rerun.closed, []);
  assert.deepEqual(rerun.alreadyClosed, ['f1', 'f2']);
  assert.equal(rerun.templateFormId, null);
  assert.equal(rerun.templateUnlinked, false);
});

test('closeHcForms_: a Form that rejects the closed message is still closed, the failure reported, the sweep continues', () => {
  const { template, rowsBySheetId } = setup_();
  forms.f1.setCustomClosedFormMessage = () => { throw new Error('Invalid data updating form.'); };
  const result = closeHcForms_(template, rowsBySheetId, { signupUrl: SIGNUP_URL });
  assert.equal(forms.f1._accepting, false, 'closed even though the message was rejected');
  assert.deepEqual(result.messageFailed, [{ formId: 'f1', error: 'Invalid data updating form.' }]);
  assert.deepEqual(result.closed, ['f1', 'tpl']);
  assert.equal(forms.tpl._message, HC_FORM_CLOSED_MESSAGE_PREFIX_ + SIGNUP_URL, 'later Forms still processed');
  assert.equal(result.templateUnlinked, true);
});

test('closeHcForms_ sets the closed message while the Form is still open, then closes it', () => {
  const { template, rowsBySheetId } = setup_();
  const order = [];
  const realSet = forms.f1.setCustomClosedFormMessage;
  forms.f1.setCustomClosedFormMessage = (m) => { order.push('message:' + (forms.f1._accepting ? 'open' : 'closed')); return realSet(m); };
  closeHcForms_(template, rowsBySheetId, { signupUrl: SIGNUP_URL });
  assert.deepEqual(order, ['message:open']);
  assert.equal(forms.f1._accepting, false);
});

test('closeHcForms_ message override replaces the default closed message', () => {
  const { template, rowsBySheetId } = setup_();
  closeHcForms_(template, rowsBySheetId, { signupUrl: SIGNUP_URL, message: 'Closed.' });
  assert.equal(forms.f1._message, 'Closed.');
});

test('closeHcForms_ requires a sign-up URL for the closed message', () => {
  const { template, rowsBySheetId } = setup_();
  assert.deepEqual(closeHcForms_(template, rowsBySheetId, { signupUrl: '' }), { ok: false, error: 'signup_url_unavailable' });
});
