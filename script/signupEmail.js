/**
 * Build signup reuse email using SignupReuseEmailTemplate
 */

function resolveSignupEmailMode_(options) {
  if (options && options.mode) return options.mode;
  return options && options.usedPriorGoals ? 'reuse' : 'missing';
}

function buildSignupEmailCopy_(options) {
  var mode = resolveSignupEmailMode_(options);
  var registrationMonth = options && options.registrationMonth ? options.registrationMonth : 'this month';

  if (mode === 'confirmation') {
    return {
      mode: mode,
      headline: 'Your registration was updated',
      intro: 'We saved your current goals for ' + registrationMonth + '.',
      showSummary: true,
      summaryIntro: 'Current goals:',
      ctaIntro: 'If you want to make another change, use this form link:',
      ctaLabel: 'Open form'
    };
  }

  if (mode === 'new_signup') {
    return {
      mode: mode,
      headline: "You're signed up for " + registrationMonth + '!',
      intro: 'Your registration for ' + registrationMonth + ' is confirmed.',
      showSummary: true,
      summaryIntro: 'Your goals:',
      ctaIntro: null,
      ctaLabel: null
    };
  }

  if (mode === 'reuse') {
    return {
      mode: mode,
      headline: 'Your previous goals were reused',
      intro: 'We reused your most recent prior Go30 entries for this month.',
      showSummary: true,
      summaryIntro: 'Below is a summary of the values we copied for you.',
      ctaIntro: 'If you want to adjust those defaults, open this prefilled form link and submit again:',
      ctaLabel: 'Open prefilled form'
    };
  }

  return {
    mode: 'missing',
    headline: 'Please enter your goals',
    intro: 'We could not find a prior entry to reuse for this email address.',
    showSummary: false,
    summaryIntro: '',
    ctaIntro: 'Use this form link to enter or update your goals:',
    ctaLabel: 'Open form'
  };
}

function renderSignupReuseEmailHtml_(options) {
  var copy = buildSignupEmailCopy_(options || {});

  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    var lines = [];
    lines.push('<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;">');
    lines.push('<h1>' + copy.headline + '</h1>');
    lines.push('<p>' + copy.intro + '</p>');
    if (copy.showSummary && (options.summaryLines || []).length > 0) {
      lines.push('<p>' + copy.summaryIntro + '</p>');
      lines.push('<pre>' + (options.summaryLines || []).join('\n') + '</pre>');
    }
    if (options.prefilledUrl && copy.ctaIntro) {
      lines.push('<p>' + copy.ctaIntro + '</p>');
      lines.push('<p><a href="' + options.prefilledUrl + '">' + copy.ctaLabel + '</a></p>');
    }
    if (options.trackerUrl) lines.push('<p><a href="' + options.trackerUrl + '">View tracker</a></p>');
    lines.push('</body></html>');
    return lines.join('\n');
  }

  var template = HtmlService.createTemplateFromFile('SignupReuseEmailTemplate');
  template.emailMode = copy.mode;
  template.headline = copy.headline;
  template.intro = copy.intro;
  template.showSummary = copy.showSummary;
  template.summaryIntro = copy.summaryIntro;
  template.ctaIntro = copy.ctaIntro;
  template.ctaLabel = copy.ctaLabel;
  template.f3Name = options.f3Name;
  template.trackerUrl = options.trackerUrl;
  template.prefilledUrl = options.prefilledUrl;
  template.summaryLines = options.summaryLines || [];
  template.appVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '';
  return template.evaluate().getContent();
}

function buildSignupReuseEmailTemplate_(options) {
  options = options || {};
  var copy = buildSignupEmailCopy_(options);
  var subject = (copy.mode === 'confirmation')
    ? ('F3 Go30: registration updated for ' + (options.registrationMonth || 'this month'))
    : (copy.mode === 'new_signup')
    ? ('F3 Go30: registered for ' + (options.registrationMonth || 'this month'))
    : ('F3 Go30: ' + (copy.mode === 'reuse' ? "last month's goals reused" : 'enter your goals'));
  var bodyLines = [];
  bodyLines.push('F3 Name: ' + (options.f3Name || '(unknown)'));
  bodyLines.push('');
  bodyLines.push(copy.intro);
  if (copy.showSummary && (options.summaryLines || []).length > 0) {
    bodyLines.push('');
    bodyLines.push(copy.summaryIntro);
    bodyLines = bodyLines.concat(options.summaryLines || []);
  }
  if (options.prefilledUrl && copy.ctaIntro) {
    bodyLines.push('');
    bodyLines.push(copy.ctaIntro);
    bodyLines.push(options.prefilledUrl);
  }
  bodyLines.push('');
  if (options.trackerUrl) bodyLines.push('Tracker: ' + options.trackerUrl);

  return {
    subject: subject,
    body: bodyLines.join('\n'),
    htmlBody: renderSignupReuseEmailHtml_(options)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSignupReuseEmailTemplate_: buildSignupReuseEmailTemplate_,
    renderSignupReuseEmailHtml_: renderSignupReuseEmailHtml_,
    resolveSignupEmailMode_: resolveSignupEmailMode_,
    buildSignupEmailCopy_: buildSignupEmailCopy_
  };
}
