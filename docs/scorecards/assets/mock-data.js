/* Go30 scorecard mockups — one shared mock roster for every option in this folder.
 *
 * Deliberately ONE dataset shared by all five mockups: the options are meant to be compared
 * against each other, and that only works if they are all showing the same month, the same PAX
 * and the same numbers. Add a field here rather than hand-rolling a second roster in a page.
 *
 * The names are FABRICATED F3-style handles, not real PAX from any tracker. The shape of every
 * record matches what the live dashboard payload already carries per PAX
 * (script/dashboardWebapp.js buildDashboardPaxRow_ / groupByTeam_): name, team, score, rawScore,
 * scorePct, streak, maxStreak30, dayValues, bonusByType. Nothing here needs a new server field —
 * see README.md §Data.
 */
(function (global) {
  'use strict';

  // Deterministic PRNG (mulberry32) so every reload — and every screenshot — shows the same month.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var TOTAL_DAYS = 31;                       // July 2026
  var MONTH_LABEL = 'July 2026';

  var TEAMS = [
    { name: 'Anvil',     color: 'var(--team-1)', hex: '#2a78d6' },
    { name: 'Broadaxe',  color: 'var(--team-2)', hex: '#eb6834' },
    { name: 'Crucible',  color: 'var(--team-3)', hex: '#1baf7a' },
    { name: 'Dogwood',   color: 'var(--team-4)', hex: '#eda100' },
    { name: 'Everest',   color: 'var(--team-5)', hex: '#e87ba4' },
    { name: 'Foxhole',   color: 'var(--team-6)', hex: '#008300' }
  ];

  // 6 handles per team. Engagement (0..1) drives the day-value draw below.
  var ROSTER = [
    ['Anvil',    [['Ratchet', .97], ['Bandsaw', .93], ['Cornbread', .84], ['Sherpa', .78], ['Tinder', .62], ['Molasses', .45]]],
    ['Broadaxe', [['Slingshot', .95], ['Hushpuppy', .90], ['Dipstick', .81], ['Kickstand', .72], ['Waffle', .58], ['Snorkel', .40]]],
    ['Crucible', [['Bulldozer', .99], ['Backdraft', .92], ['Pothole', .86], ['Gumbo', .69], ['Rerun', .55], ['Doorbell', .34]]],
    ['Dogwood',  [['Whiplash', .94], ['Meatball', .88], ['Trailer', .76], ['Bobbin', .66], ['Sprocket', .52], ['Yardsale', .31]]],
    ['Everest',  [['Flatline', .91], ['Two-Step', .85], ['Ironbird', .79], ['Cricket', .64], ['Pinecone', .49], ['Hardtack', .37]]],
    ['Foxhole',  [['Deadlift', .96], ['Sawdust', .87], ['Crawdad', .74], ['Lockjaw', .68], ['Buttons', .53], ['Tumbleweed', .28]]]
  ];

  var BONUS_KEYS = ['fellowship', 'qpoint', 'inspire', 'ehfng'];
  var BONUS_LABEL = { fellowship: 'Fellowship', qpoint: 'Q-Point', inspire: 'Inspire', ehfng: 'EHing FNG' };
  var BONUS_PILL = { fellowship: 'fe', qpoint: 'q', inspire: 'ins', ehfng: 'eh' };

  function runLength(values, atEnd) {
    var best = 0, cur = 0;
    for (var i = 0; i < values.length; i++) {
      cur = values[i] === 1 ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    if (!atEnd) return best;
    cur = 0;
    for (var j = values.length - 1; j >= 0 && values[j] === 1; j--) cur++;
    return cur;
  }

  var r = rng(30713);
  var PAX = [];
  ROSTER.forEach(function (entry, teamIdx) {
    entry[1].forEach(function (person) {
      var name = person[0], engagement = person[1];
      var dayValues = [];
      for (var d = 0; d < TOTAL_DAYS; d++) {
        var roll = r();
        // A Hit is 1; a reported Miss is 0; a no-show (no check-in at all, Q-marked) is -1.
        // Higher-engagement PAX also *report* more, so their misses skew to 0 rather than -1.
        dayValues.push(roll < engagement ? 1 : (r() < 0.35 + engagement * 0.5 ? 0 : -1));
      }
      var rawScore = dayValues.reduce(function (a, b) { return a + b; }, 0);
      var bonusByType = {};
      var bonusTotal = 0;
      BONUS_KEYS.forEach(function (k) {
        var n = Math.floor(r() * (1 + engagement * 7));
        bonusByType[k] = n;
        bonusTotal += n;
      });
      var score = rawScore + bonusTotal;
      PAX.push({
        name: name,
        team: entry[0],
        teamIndex: teamIdx,
        score: score,
        rawScore: rawScore,
        bonusTotal: bonusTotal,
        bonusByType: bonusByType,
        scorePct: Math.round((score / TOTAL_DAYS) * 100),
        streak: runLength(dayValues, true),
        maxStreak30: runLength(dayValues, false),
        dayValues: dayValues,
        // Prior month's total, for "most improved" and rank-movement arrows. Real data source:
        // the previous month's tracker, already reachable via PaxCache history.
        priorScore: Math.max(0, Math.round(score - (r() * 16 - 7)))
      });
    });
  });

  function status(v) { return v === 1 ? 'done' : v === 0 ? 'missed' : v === -1 ? 'absent' : 'pending'; }

  function byScore() { return PAX.slice().sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }); }

  function teamStats() {
    return TEAMS.map(function (t, i) {
      var members = PAX.filter(function (p) { return p.teamIndex === i; });
      var sum = function (f) { return members.reduce(function (a, m) { return a + f(m); }, 0); };
      var hits = sum(function (m) { return m.dayValues.filter(function (v) { return v === 1; }).length; });
      return {
        name: t.name, index: i, color: t.color, hex: t.hex, members: members,
        avgScore: sum(function (m) { return m.score; }) / members.length,
        avgRaw: sum(function (m) { return m.rawScore; }) / members.length,
        avgBonus: sum(function (m) { return m.bonusTotal; }) / members.length,
        avgPrior: sum(function (m) { return m.priorScore; }) / members.length,
        // Participation = share of all member-days that were actually reported (Hit or Miss).
        participation: sum(function (m) { return m.dayValues.filter(function (v) { return v !== -1; }).length; }) /
          (members.length * TOTAL_DAYS),
        hitRate: hits / (members.length * TOTAL_DAYS)
      };
    }).sort(function (a, b) { return b.avgScore - a.avgScore; });
  }

  /** Team average score cumulative through day d (0-based) — drives the month race chart. */
  function teamCumulative(teamIndex) {
    var members = PAX.filter(function (p) { return p.teamIndex === teamIndex; });
    var out = [], running = 0;
    for (var d = 0; d < TOTAL_DAYS; d++) {
      running += members.reduce(function (a, m) { return a + m.dayValues[d]; }, 0) / members.length;
      out.push(running);
    }
    return out;
  }

  global.MOCK = {
    monthLabel: MONTH_LABEL,
    totalDays: TOTAL_DAYS,
    teams: TEAMS,
    pax: PAX,
    me: 'Cornbread',                 // the signed-in PAX in every mockup — mid-pack on purpose
    bonusKeys: BONUS_KEYS,
    bonusLabel: BONUS_LABEL,
    bonusPill: BONUS_PILL,
    status: status,
    byScore: byScore,
    teamStats: teamStats,
    teamCumulative: teamCumulative,
    find: function (name) { return PAX.filter(function (p) { return p.name === name; })[0]; }
  };
})(window);
