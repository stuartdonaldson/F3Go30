/**
 * Build signup reuse email using SignupReuseEmailTemplate
 */
var signupEmailUtilitiesModule_ = (typeof module !== 'undefined' && module.exports)
  ? require('./Utilities.js')
  : null;
var resolveWebAppBaseUrl_ = (signupEmailUtilitiesModule_ && signupEmailUtilitiesModule_.resolveWebAppBaseUrl_)
  || (typeof globalThis !== 'undefined' && globalThis.resolveWebAppBaseUrl_);
var buildStaticCheckinUrl_ = (signupEmailUtilitiesModule_ && signupEmailUtilitiesModule_.buildStaticCheckinUrl_)
  || (typeof globalThis !== 'undefined' && globalThis.buildStaticCheckinUrl_);
var buildStaticSignupUrl_ = (signupEmailUtilitiesModule_ && signupEmailUtilitiesModule_.buildStaticSignupUrl_)
  || (typeof globalThis !== 'undefined' && globalThis.buildStaticSignupUrl_);

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
      summaryIntro: 'Current goals:'
    };
  }

  if (mode === 'new_signup') {
    return {
      mode: mode,
      headline: "You're signed up for " + registrationMonth + '!',
      intro: "You're in for " + registrationMonth + '. Now the work begins: act on your Daily Challenge and report it every day.',
      showSummary: true,
      summaryIntro: 'Your goals:'
    };
  }

  if (mode === 'reuse') {
    return {
      mode: mode,
      headline: 'Your previous goals were carried forward',
      intro: 'We carried your most recent Go30 goals forward for ' + registrationMonth + '.',
      showSummary: true,
      summaryIntro: 'Here is what we carried forward for you:'
    };
  }

  return {
    mode: 'missing',
    headline: 'Please enter your goals',
    intro: 'We could not find a prior entry to carry forward for this email address. Open your registration below to enter your goals.',
    showSummary: false,
    summaryIntro: ''
  };
}

// The check-in page is the primary call to action (see docs/Go30-FAQ.md / docs/Go30-Intro.md):
// a personal, bookmarkable link that skips the name/email form on every future visit. The edit
// and tracker links are secondary. This copy is mode-independent — every confirmation variant
// (new signup, goal edit, plain reconfirm, missing) gets the same "here's how to use Go30" block.
var CHECKIN_EMAIL_COPY_ = {
  checkinHeading: 'Record your daily scores',
  checkinIntro: 'The Go30 check-in page is where you report your Daily Challenge each day — tap ' +
    "I Hit it! or Missed it. This is your own personal link: bookmark it (or Add to Home Screen) " +
    'and it will remember you, so you never have to type your name and email again.',
  checkinLabel: 'Open my check-in page',
  dashboardNote: "Right after you check in you'll see your dashboard — current streak, best 30-day " +
    "streak, 7-day rolling average, your month-progress ring, your team's tile, and the full PAX " +
    'board. Tap the trophy (🏆) to log bonus points.',
  editHeading: 'Need to change something?',
  editIntro: 'Update your goals, team, email, or Nag setting any time — this opens your registration ' +
    'prefilled with your current details:',
  editLabel: 'Update my registration',
  trackerIntro: 'All Go30 data lives in the shared Tracker sheet. You normally won’t need to open ' +
    'it — the check-in page does everything — but it’s here if you want it:',
  trackerLabel: 'Open the Tracker sheet'
};

// Both links open the static front end (GitHub Pages) wrapping this webapp as its API backend
// (buildStaticCheckinUrl_ / buildStaticSignupUrl_, Utilities.js — ADR-018 §7), falling back to
// the GAS ?cmd=checkin / ?cmd=signup pages directly when the static host isn't configured (e.g.
// Node tests, or before STATIC_PAGES_BASE_URL_ is set), which keeps old-style GAS links working
// for anyone still holding one. Both carry the PAX's session guid pre-installed (when known), so
// the very first tap lands them straight in the app already identified — see CheckinSessions.js.
function buildCheckinEmailLinks_(webAppBaseUrl, checkinSessionGuid) {
  if (!webAppBaseUrl) return { checkinUrl: '', editGoalsUrl: '' };
  var idSuffix = checkinSessionGuid ? ('&id=' + encodeURIComponent(checkinSessionGuid)) : '';
  var staticCheckinUrl = buildStaticCheckinUrl_ ? buildStaticCheckinUrl_(webAppBaseUrl, { id: checkinSessionGuid }) : '';
  var staticSignupUrl = buildStaticSignupUrl_ ? buildStaticSignupUrl_(webAppBaseUrl, { id: checkinSessionGuid }) : '';
  return {
    checkinUrl: staticCheckinUrl || (webAppBaseUrl + '?cmd=checkin' + idSuffix),
    editGoalsUrl: staticSignupUrl || (webAppBaseUrl + '?cmd=signup' + idSuffix)
  };
}

function renderSignupReuseEmailHtml_(options) {
  options = options || {};
  var copy = buildSignupEmailCopy_(options);
  var webAppBaseUrl = resolveWebAppBaseUrl_ ? resolveWebAppBaseUrl_() : '';
  var links = buildCheckinEmailLinks_(webAppBaseUrl, options.checkinSessionGuid);
  var c = CHECKIN_EMAIL_COPY_;

  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    var lines = [];
    lines.push('<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;">');
    lines.push('<h1>' + copy.headline + '</h1>');
    lines.push('<p>' + copy.intro + '</p>');
    if (copy.showSummary && (options.summaryLines || []).length > 0) {
      lines.push('<p>' + copy.summaryIntro + '</p>');
      lines.push('<pre>' + (options.summaryLines || []).join('\n') + '</pre>');
    }
    // Primary CTA: personal, bookmarkable check-in link.
    if (links.checkinUrl) {
      lines.push('<h2>' + c.checkinHeading + '</h2>');
      lines.push('<p>' + c.checkinIntro + '</p>');
      lines.push('<p><a href="' + links.checkinUrl + '">' + c.checkinLabel + '</a></p>');
      lines.push('<p>' + c.dashboardNote + '</p>');
    }
    // Secondary: edit registration (same session guid, signup route).
    if (links.editGoalsUrl) {
      lines.push('<h3>' + c.editHeading + '</h3>');
      lines.push('<p>' + c.editIntro + '</p>');
      lines.push('<p><a href="' + links.editGoalsUrl + '">' + c.editLabel + '</a></p>');
    }
    // Demoted: the Tracker sheet.
    if (options.trackerUrl) {
      lines.push('<p>' + c.trackerIntro + ' <a href="' + options.trackerUrl + '">' + c.trackerLabel + '</a></p>');
    }
    lines.push('</body></html>');
    return lines.join('\n');
  }

  var template = HtmlService.createTemplateFromFile('SignupReuseEmailTemplate');
  template.emailMode = copy.mode;
  template.headline = copy.headline;
  template.intro = copy.intro;
  template.showSummary = copy.showSummary;
  template.summaryIntro = copy.summaryIntro;
  template.f3Name = options.f3Name;
  template.trackerUrl = options.trackerUrl;
  template.checkinUrl = links.checkinUrl;
  template.editGoalsUrl = links.editGoalsUrl;
  template.copy = c;
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
  var webAppBaseUrl = resolveWebAppBaseUrl_ ? resolveWebAppBaseUrl_() : '';
  var links = buildCheckinEmailLinks_(webAppBaseUrl, options.checkinSessionGuid);
  var c = CHECKIN_EMAIL_COPY_;

  // Primary CTA first: personal, bookmarkable check-in link.
  if (links.checkinUrl) {
    bodyLines.push('');
    bodyLines.push(c.checkinHeading.toUpperCase());
    bodyLines.push(c.checkinIntro);
    bodyLines.push(links.checkinUrl);
    bodyLines.push('');
    bodyLines.push(c.dashboardNote);
  }
  if (links.editGoalsUrl) {
    bodyLines.push('');
    bodyLines.push(c.editHeading);
    bodyLines.push(c.editIntro);
    bodyLines.push(links.editGoalsUrl);
  }
  if (options.trackerUrl) {
    bodyLines.push('');
    bodyLines.push(c.trackerIntro);
    bodyLines.push(options.trackerUrl);
  }

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
