/**
 * Daily NAG processing.
 * - setupDailyNagTrigger(): installs a daily trigger at 10:00 local time
 * - sendNagEmail(): invoked by trigger; for each team, if anyone on the team
 *   has not checked in for the previous day, email all team members who opted
 *   into the "NAG Email?" column with a list of missing people.
 */

function setupDailyNagTrigger() {
  clearDailyNagTrigger();
  ScriptApp.newTrigger('sendNagEmail')
    .timeBased()
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .atHour(10)
    .nearMinute(0)
    .create();
}

function clearDailyNagTrigger() {
  var existingTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === 'sendNagEmail') {
      ScriptApp.deleteTrigger(existingTriggers[i]);
    }
  }
}

function isYesLike_(val) {
  if (val === undefined || val === null) return false;
  var s = String(val).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s.indexOf('yes') === 0;
}

function sendNagEmail() {
  GasLogger.init('sendNagEmail');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tracker = ss.getSheetByName('Tracker');
  var responses = ss.getSheetByName('Responses');
  if (!tracker || !responses) {
    Logger.log('sendNagEmail: Tracker or Responses sheet missing');
    return;
  }

  var tz = ss.getSpreadsheetTimeZone();
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  var targetDateString = Utilities.formatDate(yesterday, tz, 'MM/dd/yyyy');

  // Find the column in row 3 that matches yesterday's date
  var lastCol = tracker.getLastColumn();
  var row3 = tracker.getRange(3, 1, 1, lastCol).getValues()[0];
  var dateCol = -1;
  for (var c = 0; c < row3.length; c++) {
    var v = row3[c];
    if (v instanceof Date) {
      var s = Utilities.formatDate(v, tz, 'MM/dd/yyyy');
      if (s === targetDateString) { dateCol = c + 1; break; }
    } else if (String(v || '').trim() === targetDateString) {
      dateCol = c + 1; break;
    }
  }

  if (dateCol === -1) {
    Logger.log('sendNagEmail: date column not found for ' + targetDateString);
    return;
  }

  var startRow = 4;
  var lastRow = tracker.getLastRow();
  if (lastRow < startRow) return;

  // Read tracker basics (Name, Team) and yesterday's column values
  var nameTeamRange = tracker.getRange(startRow, 1, lastRow - startRow + 1, Math.max(2, Math.min(2, tracker.getLastColumn())));
  var nameTeam = nameTeamRange.getValues();
  var dayVals = tracker.getRange(startRow, dateCol, lastRow - startRow + 1, 1).getValues();

  // Load responses to map latest info (email, NAG opt-in, WHO)
  var respData = responses.getDataRange().getValues();
  if (respData.length < 2) {
    Logger.log('sendNagEmail: Responses has no data');
    return;
  }
  var responseColumns = resolveResponseColumns_(respData[0]);

  // Build latest response map by F3 Name (scan from bottom)
  var latestByName = {};
  for (var r = respData.length - 1; r >= 1; r--) {
    var row = respData[r];
    var name = String(getResponseValue_(row, responseColumns, 'F3_NAME') || '').trim();
    if (!name) continue;
    if (!(name in latestByName)) latestByName[name] = row;
  }

  // Group by team
  var teams = {}; // teamName -> { members: [{name, email, who, nagOpt, checked}] }
  for (var i = 0; i < nameTeam.length; i++) {
    var name = String(nameTeam[i][0] || '').trim();
    if (!name) continue;
    var team = String(nameTeam[i][1] || '').trim() || '(Unassigned)';
    var val = dayVals[i][0];
    var checked = (val === 1 || val === '1' || val === 0 || val === '0');

    var respRow = latestByName[name] || [];
    var email = String(getResponseValue_(respRow, responseColumns, 'EMAIL') || '').trim();
    var nagOpt = isYesLike_(getOptionalResponseValue_(respRow, responseColumns, 'NAG_EMAIL'));
    var who = String(getResponseValue_(respRow, responseColumns, 'WHO') || '').trim();

    if (!teams[team]) teams[team] = { members: [] };
    teams[team].members.push({ name: name, email: email, who: who, nagOpt: nagOpt, checked: checked });
  }

  // Load inspiration quote (optional)
  var quote = '';
  var insp = ss.getSheetByName('Inspiration');
  if (insp) {
    var inspData = insp.getDataRange().getValues();
    if (inspData.length > 1) {
      var idx = Math.floor(Math.random() * (inspData.length - 1)) + 1;
      var q = inspData[idx][0] || '';
      var a = inspData[idx][1] || '';
      quote = (q ? ('"' + q + '"') : '') + (a ? (' - ' + a) : '');
    }
  }

  var sentSummary = [];
  for (var teamName in teams) {
    var group = teams[teamName];
    var missing = group.members.filter(function(m){ return !m.checked; });
    if (missing.length === 0) continue; // nobody missing, skip

    // Recipients are members who opted in and have an email
    var recipients = group.members.filter(function(m){ return m.nagOpt && m.email; });
    if (recipients.length === 0) continue; // no recipients

    var recipientList = recipients.map(function(r){ return r.name + ' <' + r.email + '>'; }).join(',');

    var subject = 'Go30 Daily Nag — ' + targetDateString + ' — Team: ' + teamName;
    var bodyLines = [];
    if (quote) bodyLines.push(quote, '', '');
    bodyLines.push('Hello,');
    bodyLines.push('');
    bodyLines.push('The following team members have not yet checked in for ' + targetDateString + ':');
    bodyLines.push('');
    missing.forEach(function(m) {
      var whoPart = m.who ? (', who wants to be ' + m.who) : '';
      bodyLines.push('- ' + m.name + whoPart);
    });
    bodyLines.push('');
    bodyLines.push('This notice was sent to everyone on the team who requested Nag Emails.');
    bodyLines.push('Keep going — you got this.');

    try {
      MailApp.sendEmail(recipientList, subject, bodyLines.join('\n'));
      sentSummary.push({ team: teamName, recipients: recipients.length, missing: missing.length });
    } catch (e) {
      Logger.log('sendNagEmail: MailApp.sendEmail failed for team ' + teamName + ' — ' + e.message);
    }
  }

  GasLogger.log('sendNagEmail', { date: targetDateString, teamsNotified: sentSummary }, true);
}
