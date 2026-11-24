/*
 * Doctoral Council Election — shared election logic.
 * The SAME file runs in two places:
 *   1. Google Apps Script (copy it as "Logic.gs") — the real server.
 *   2. The browser in DEMO mode (no server), with a fake in-browser database.
 * All rules (dates, eligibility, one ballot per member, two-PIN controls,
 * seal, counting) live here so the demo behaves exactly like the real system.
 */

var ELECTION_POSITIONS = [
  { key: 'PRES',  title: 'President', seats: 1 },
  { key: 'VPIA',  title: 'Vice President for Internal Affairs', seats: 1 },
  { key: 'VPEA',  title: 'Vice President for External Affairs', seats: 1 },
  { key: 'EXSEC', title: 'Executive Secretary', seats: 1 },
  { key: 'DRD',   title: 'Director for Records and Documentation', seats: 1 },
  { key: 'AUD',   title: 'Auditor', seats: 1 },
  { key: 'BFO',   title: 'Budget and Finance Officer', seats: 1 },
  { key: 'PRO',   title: 'Public Relations Officer', seats: 2 },
  { key: 'ETO',   title: 'Events and Training Officer', seats: 1 },
  { key: 'SWO',   title: 'Student Welfare Officer', seats: 1 }
];

// Key: [default value, description shown in the Settings tab]
var ELECTION_DEFAULT_SETTINGS = {
  ELECTION_TITLE:      ['Doctoral Council Election 2026', 'Title shown on the site and reports'],
  NOMINATION_START:    ['2026-11-26T00:00:00+08:00', 'Nomination form opens (Philippine time)'],
  NOMINATION_END:      ['2026-11-28T00:00:00+08:00', 'Nomination form closes (end of Nov 27)'],
  NOMINEES_PUBLISH:    ['2026-12-01T00:00:00+08:00', 'Approved nominees become public'],
  FTS_DATE:            ['2026-12-03T00:00:00+08:00', 'Final Testing and Sealing day (sealing allowed from Nominees phase)'],
  VOTING_START:        ['2026-12-05T09:00:00+08:00', 'Voting starts'],
  VOTING_END:          ['2026-12-06T18:00:00+08:00', 'Voting ends'],
  OPEN_WINDOW_HOURS:   [3, 'Committee may press "Open voting" up to this many hours before Voting starts'],
  REQUIRE_OTP:         [false, 'FALSE = members log in to vote with NTC email + student no. only. TRUE = also email a 6-digit code'],
  REQUIRE_OTP_NOMINATION: [false, 'TRUE = also require the emailed code for NOMINATION login'],
  MAX_NOMINATIONS_PER_MEMBER: [1, 'How many persons one member may nominate (1 = one person only)'],
  ALLOW_SELF_NOMINATION: [true, 'TRUE = a First Year member may nominate himself/herself'],
  PUBLIC_TURNOUT:      [false, 'TRUE = show votes cast / turnout to everyone while voting'],
  SITE_URL:            ['', 'Your GitHub Pages link, e.g. https://yourname.github.io/ntc-election/'],
  GITHUB_REPO:         ['', 'owner/repo of the site, used to print the commit ID in the seal'],
  TWO_PIN_ACTIONS:     ['SEAL,RESULTS', 'Actions that need Chairman + Poll Clerk/Member PINs. Others need the Chairman PIN only. Choices: TEST_OPEN, TEST_CLOSE, REZERO, SEAL, OPEN, CLOSE, RESULTS'],
  TEST_MODE:           [false, 'TRUE = pretend the date/time is TEST_NOW (for rehearsal only)'],
  TEST_NOW:            ['', 'Simulated date/time when TEST_MODE is TRUE, e.g. 2026-12-05T10:00:00+08:00']
};

// Conditions the nominator must confirm about the nominee (checkboxes on the nomination form)
var NOMINATION_CONDITIONS = [
  'The nominee is willing to run and serve as an officer of the Doctoral Council.',
  'The nominee is currently residing in the Philippines.',
  'The nominee is willing to come to NTC when there are Doctoral Council events.',
  'The nominee is willing and committed to serve the Doctoral Council for the whole term.'
];

var COMMITTEE_ROLES = ['CHAIRMAN', 'POLL_CLERK', 'MEMBER'];
var ROLE_LABELS = { CHAIRMAN: 'Chairman', POLL_CLERK: 'Poll Clerk', MEMBER: 'Member', OBSERVER: 'Observer' };

function ElectionLogic(DB) {
  var P = ELECTION_POSITIONS;

  // ---------- helpers ----------
  function fail(msg) { var e = new Error(msg); e.userMessage = msg; throw e; }
  function bool(v) { return v === true || /^(true|yes|y|1|on)$/i.test(String(v == null ? '' : v).trim()); }
  function normSno(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function normEmail(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function parseDate(v) {
    if (v instanceof Date) return v;
    if (v && typeof v.getTime === 'function') return new Date(v.getTime());
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    s = s.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += '+08:00'; // no zone = Philippine time
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function isFirstYear(y) { return /(^|\b)(1|1st|first|i)(\b|$)/i.test(String(y == null ? '' : y).trim()); }
  function manilaParts(d) { // Philippine time has no daylight saving: UTC+8 always
    var m = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
    return { date: m.slice(0, 10), hour: m.slice(11, 13), text: m.slice(0, 10) + ' ' + m.slice(11, 19) };
  }
  function maskEmail(e) {
    var p = String(e).split('@'); if (p.length < 2) return '***';
    return p[0].slice(0, 2) + '***@' + p[1];
  }
  function nomId(sno) { return 'n' + DB.sha256('nominee|' + normSno(sno)).slice(0, 10); }
  function hashSecret(secret, salt) {
    var h = salt + '|' + secret;
    for (var i = 0; i < 200; i++) h = DB.sha256(salt + h);
    return h;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function settings() {
    var raw = DB.getSettingsRaw() || {}, s = {};
    for (var k in ELECTION_DEFAULT_SETTINGS) s[k] = ELECTION_DEFAULT_SETTINGS[k][0];
    for (var k2 in raw) if (raw[k2] !== '' && raw[k2] != null) s[k2] = raw[k2];
    return s;
  }
  function state() { try { return JSON.parse(DB.getProp('STATE') || '{}'); } catch (e) { return {}; } }
  function saveState(st) { DB.setProp('STATE', JSON.stringify(st)); }
  function nowFor(s) { return (bool(s.TEST_MODE) && parseDate(s.TEST_NOW)) ? parseDate(s.TEST_NOW) : DB.now(); }
  function t(s, key) { var d = parseDate(s[key]); if (!d) fail('Setting ' + key + ' is not a valid date.'); return d.getTime(); }

  function phaseOf(now, s, st) {
    var n = now.getTime();
    if (st.resultsPublished) return 'RESULTS';
    if (st.votingClosed) return 'CLOSED';
    if (n < t(s, 'NOMINATION_START')) return 'UPCOMING';
    if (n < t(s, 'NOMINATION_END')) return 'NOMINATION';
    if (n < t(s, 'NOMINEES_PUBLISH')) return 'EVALUATION';
    if (n < t(s, 'VOTING_START')) return 'NOMINEES';
    if (n < t(s, 'VOTING_END')) return st.votingOpened ? 'VOTING' : 'AWAITING_OPEN';
    return 'CLOSED';
  }
  function otpNeeded(c) { return c.phase === 'VOTING' ? bool(c.s.REQUIRE_OTP) : bool(c.s.REQUIRE_OTP_NOMINATION); }
  function ctx() { var s = settings(), st = state(), now = nowFor(s); return { s: s, st: st, now: now, phase: phaseOf(now, s, st) }; }

  function membersMap() {
    var m = {}, list = DB.getMembers();
    list.forEach(function (x) { m[normSno(x.studentNo)] = x; });
    return { map: m, list: list };
  }
  // By-laws: no member of the Election Committee may be a candidate.
  function committeeEmails() {
    var o = {}; officials().forEach(function (x) { if (COMMITTEE_ROLES.indexOf(x.role) >= 0) o[x.email] = 1; }); return o;
  }
  function approvedNominees() {
    return DB.getNominees().filter(function (n) { return bool(n.approved); })
      .map(function (n) { return { studentNo: normSno(n.studentNo), name: String(n.name).trim(), yearLevel: n.yearLevel, id: nomId(n.studentNo) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function schedule(s) {
    var keys = ['NOMINATION_START', 'NOMINATION_END', 'NOMINEES_PUBLISH', 'FTS_DATE', 'VOTING_START', 'VOTING_END'], o = {};
    keys.forEach(function (k) { var d = parseDate(s[k]); o[k] = d ? d.toISOString() : null; });
    return o;
  }
  function officials() {
    return DB.getOfficials().map(function (o) {
      return { role: String(o.role).trim().toUpperCase().replace(/\s+/g, '_'), name: String(o.name).trim(), email: normEmail(o.email), title: o.title || '' };
    }).filter(function (o) { return o.email; });
  }
  function committeeNames() {
    var out = {};
    officials().forEach(function (o) { if (COMMITTEE_ROLES.indexOf(o.role) >= 0 && !out[o.role]) out[o.role] = o.name; });
    return out;
  }

  // ---------- sessions & rate limits ----------
  function newSession(data, ttl) { var tok = DB.randomHex(24); DB.cachePut('sess:' + tok, JSON.stringify(data), ttl); return tok; }
  function getSession(tok, type) {
    if (!tok) fail('Please log in again.');
    var raw = DB.cacheGet('sess:' + tok); if (!raw) fail('Your session has expired. Please log in again.');
    var s = JSON.parse(raw); if (type && s.type !== type) fail('Not allowed.');
    return s;
  }
  function hit(key, max, sec) {
    var n = parseInt(DB.cacheGet('rl:' + key) || '0', 10) + 1;
    DB.cachePut('rl:' + key, String(n), sec);
    return n > max;
  }

  // ---------- seal ----------
  function sealParts(s) {
    var mem = DB.getMembers().map(function (m) { return [normSno(m.studentNo), String(m.name).trim(), normEmail(m.email), String(m.yearLevel).trim()]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var nom = approvedNominees().map(function (n) { return [n.studentNo, n.name]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var sch = schedule(s);
    var parts = {
      members: DB.sha256(JSON.stringify(mem)),
      nominees: DB.sha256(JSON.stringify(nom)),
      schedule: DB.sha256(JSON.stringify([sch, String(bool(s.REQUIRE_OTP))])),
      positions: DB.sha256(JSON.stringify(P))
    };
    var all = DB.sha256(JSON.stringify(parts));
    return { parts: parts, hash: all, code: all.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-'), memberCount: mem.length, nomineeCount: nom.length };
  }
  function sealStatus(s, st) {
    if (!st.seal) return { sealed: false, intact: null };
    var cur = sealParts(s);
    var broken = [];
    for (var k in cur.parts) if (cur.parts[k] !== st.seal.parts[k]) broken.push(k);
    return { sealed: true, intact: broken.length === 0, broken: broken, code: st.seal.code, hash: st.seal.hash, commit: st.seal.commit || '', at: st.seal.at, by: st.seal.by };
  }

  // ---------- ballot validation & counting ----------
  function cleanBallot(choices, approved) {
    var byId = {}; approved.forEach(function (n) { byId[n.id] = n; });
    var used = {}, out = {}, picks = 0;
    choices = choices || {};
    P.forEach(function (pos) {
      var arr = choices[pos.key] || [];
      if (!Array.isArray(arr)) arr = [arr];
      arr = arr.filter(function (x) { return x; });
      if (arr.length > pos.seats) fail('Too many choices for ' + pos.title + ' (maximum ' + pos.seats + ').');
      out[pos.key] = arr.map(function (id) {
        var n = byId[id]; if (!n) fail('Invalid candidate for ' + pos.title + '. Please reload the ballot.');
        if (used[id]) fail(n.name + ' was chosen for more than one position. A nominee may appear only once on a ballot.');
        used[id] = pos.key; picks++;
        return n.studentNo;
      });
    });
    for (var k in choices) if (!P.some(function (p) { return p.key === k; })) fail('Unknown position on ballot.');
    return { choices: out, picks: picks };
  }

  function tally(ballots, approved, tieBreaks) {
    var counts = {}; P.forEach(function (p) { counts[p.key] = {}; });
    var nonblank = {}; P.forEach(function (p) { nonblank[p.key] = 0; });
    ballots.forEach(function (b) {
      P.forEach(function (p) {
        var arr = (b.choices[p.key] || []).filter(function (x) { return x; });
        if (arr.length) nonblank[p.key]++;
        arr.forEach(function (sno) { sno = normSno(sno); counts[p.key][sno] = (counts[p.key][sno] || 0) + 1; });
      });
    });
    var total = ballots.length, electedTo = {}, ties = [], pendingTie = false;
    var positions = P.map(function (p) {
      var cands = approved.map(function (n) {
        return { id: n.id, studentNo: n.studentNo, name: n.name, votes: counts[p.key][n.studentNo] || 0 };
      }).sort(function (a, b) { return b.votes - a.votes || a.name.localeCompare(b.name); });
      cands.forEach(function (c) { c.pct = total ? Math.round(c.votes * 10000 / total) / 100 : 0; c.status = ''; });
      var eligible = cands.filter(function (c) { if (electedTo[c.studentNo]) { c.status = 'ELECTED_HIGHER'; c.note = 'Elected as ' + electedTo[c.studentNo]; return false; } return true; })
        .filter(function (c) { return c.votes > 0; });
      var winners = [], tie = false, tied = [];
      if (eligible.length > p.seats && eligible[p.seats - 1].votes === eligible[p.seats].votes) {
        var cut = eligible[p.seats - 1].votes;
        var clear = eligible.filter(function (c) { return c.votes > cut; });
        tied = eligible.filter(function (c) { return c.votes === cut; });
        var need = p.seats - clear.length;
        var tb = (tieBreaks || []).filter(function (x) {
          var key = String(x.position).trim().toUpperCase(); return key === p.key || key === p.title.toUpperCase();
        });
        var chosen = [];
        tb.forEach(function (x) {
          var w = String(x.winner).trim().toUpperCase();
          var c = tied.filter(function (c) { return c.studentNo === w || c.name.toUpperCase() === w; })[0];
          if (c && chosen.indexOf(c) < 0 && chosen.length < need) chosen.push(c);
        });
        if (chosen.length === need) {
          winners = clear.concat(chosen);
          chosen.forEach(function (c) { c.note = 'Tie resolved by the Election Committee'; });
        } else {
          tie = true; winners = clear;
          tied.forEach(function (c) { c.status = 'TIED'; });
          ties.push(p.title);
        }
      } else {
        winners = eligible.slice(0, p.seats);
      }
      var provisional = pendingTie;
      winners.forEach(function (c) { c.status = 'ELECTED'; electedTo[c.studentNo] = p.title; });
      if (tie) pendingTie = true;
      return {
        key: p.key, title: p.title, seats: p.seats, ballots: total, abstained: total - nonblank[p.key],
        tie: tie, provisional: provisional,
        winners: winners.map(function (c) { return c.name; }),
        candidates: cands.map(function (c) { return { id: c.id, name: c.name, votes: c.votes, pct: c.pct, status: c.status, note: c.note || '' }; })
      };
    });
    return { totalBallots: total, positions: positions, ties: ties };
  }

  // ---------- email ----------
  function mailShell(title, body) {
    return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #cfdcf3;border-radius:8px;overflow:hidden">' +
      '<div style="background:#123c8c;color:#fff;padding:14px 18px"><b>DOCTORAL COUNCIL</b><br><span style="font-size:12px">National Teachers College · Election Committee</span></div>' +
      '<div style="padding:18px;color:#1b2433"><h2 style="margin:0 0 12px;font-size:18px;color:#123c8c">' + esc(title) + '</h2>' + body +
      '<p style="font-size:12px;color:#667">This is an automated message from the Doctoral Council election system. If you did not request this, you may ignore it.</p></div></div>';
  }

  function sendPinLink(email, reason) {
    var c = ctx(), off = officials().filter(function (o) { return o.email === normEmail(email); })[0];
    if (!off) return false;
    var token = DB.randomHex(20);
    var exp = c.now.getTime() + 48 * 3600 * 1000;
    DB.setProp('setup:' + DB.sha256(token), JSON.stringify({ email: off.email, exp: exp }));
    var base = String(c.s.SITE_URL || '').trim() || '(site link)';
    var link = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'setup=' + token;
    var hasPin = !!DB.getProp('pin:' + off.email);
    DB.sendMail(off.email, (hasPin ? 'Reset' : 'Set up') + ' your Election PIN — Doctoral Council',
      mailShell((hasPin ? 'Reset' : 'Set up') + ' your 6-digit PIN',
        '<p>Hello ' + esc(off.name) + ' (' + esc(ROLE_LABELS[off.role] || off.role) + '),</p>' +
        '<p>Open this link to ' + (hasPin ? 'set a new' : 'create your') + ' 6-digit PIN for the Doctoral Council election system. Only you should know this PIN. The link works once and expires in 48 hours.</p>' +
        '<p><a href="' + esc(link) + '" style="background:#123c8c;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Set my PIN</a></p>' +
        '<p style="font-size:12px;word-break:break-all">' + esc(link) + '</p>'));
    DB.log(hasPin ? 'PIN_RESET_LINK_SENT' : 'PIN_SETUP_LINK_SENT', off.email, (reason || '') + ' ' + (ROLE_LABELS[off.role] || off.role));
    return true;
  }

  function checkPin(off, pin) {
    var lockKey = 'pinfail:' + off.email;
    if (parseInt(DB.cacheGet(lockKey) || '0', 10) >= 5) fail('Too many wrong PIN attempts for ' + off.name + '. Wait 15 minutes, or ask ALI or the Chairman to reset the PIN from the Google Sheet.');
    var rec = DB.getProp('pin:' + off.email);
    if (!rec) fail(off.name + ' has not created a PIN yet. Log in once with the NTC email to create it.');
    rec = JSON.parse(rec);
    if (!/^\d{6}$/.test(String(pin || '')) || hashSecret(String(pin), rec.salt) !== rec.hash) {
      var n = parseInt(DB.cacheGet(lockKey) || '0', 10) + 1;
      DB.cachePut(lockKey, String(n), 900);
      DB.log('PIN_FAILED', off.email, ROLE_LABELS[off.role] || off.role);
      return false;
    }
    DB.cacheDel(lockKey);
    return true;
  }

  function twoPinActions(s) { return String(s.TWO_PIN_ACTIONS == null ? '' : s.TWO_PIN_ACTIONS).toUpperCase().split(/[\s,;]+/).filter(Boolean); }
  function verifyPins(pins, act, s) {
    if (twoPinActions(s).indexOf(act) >= 0) return verifyTwoPins(pins);
    var chair = officials().filter(function (o) { return o.role === 'CHAIRMAN'; })[0];
    if (!chair) fail('No Chairman is listed in the Committee tab.');
    if (!checkPin(chair, (pins || {}).CHAIRMAN)) fail('The Chairman PIN is incorrect.');
    return [chair.name + ' (Chairman)'];
  }
  function verifyTwoPins(pins) {
    pins = pins || {};
    var offs = officials();
    var chair = offs.filter(function (o) { return o.role === 'CHAIRMAN'; })[0];
    if (!chair) fail('No Chairman is listed in the Committee tab.');
    if (!checkPin(chair, pins.CHAIRMAN)) fail('The Chairman PIN is incorrect.');
    var role = pins.SECOND_ROLE;
    if (role !== 'POLL_CLERK' && role !== 'MEMBER') fail('Choose the second signatory (Poll Clerk or Member).');
    var second = offs.filter(function (o) { return o.role === role; })[0];
    if (!second) fail('No ' + ROLE_LABELS[role] + ' is listed in the Committee tab.');
    if (!checkPin(second, pins.SECOND)) fail('The ' + ROLE_LABELS[role] + ' PIN is incorrect.');
    return [chair.name + ' (Chairman)', second.name + ' (' + ROLE_LABELS[role] + ')'];
  }

  // ---------- reports ----------
  function initReport(c, label) {
    var approved = approvedNominees();
    var ballots = DB.getBallots();
    var t2 = tally(ballots, approved, []);
    return {
      kind: 'init', label: label || 'Initialization Report', generatedAt: c.now.toISOString(),
      title: c.s.ELECTION_TITLE, schedule: schedule(c.s), ballotsInBox: ballots.length,
      registered: DB.getMembers().length,
      positions: t2.positions.map(function (p) { return { title: p.title, seats: p.seats, candidates: p.candidates.map(function (x) { return { name: x.name, votes: x.votes }; }) }; }),
      seal: sealStatus(c.s, state()), committee: committeeNames()
    };
  }

  function turnout() {
    var mem = DB.getMembers(), voted = 0, perHour = {}, byYear = {};
    mem.forEach(function (m) {
      var y = String(m.yearLevel || 'Not set').trim() || 'Not set';
      byYear[y] = byYear[y] || { registered: 0, voted: 0 };
      byYear[y].registered++;
      var d = m.votedAt ? parseDate(m.votedAt) : null;
      if (d) {
        voted++; byYear[y].voted++;
        var mp = manilaParts(d), k = mp.date + ' ' + mp.hour + ':00';
        perHour[k] = (perHour[k] || 0) + 1;
      }
    });
    return { registered: mem.length, voted: voted, pct: mem.length ? Math.round(voted * 1000 / mem.length) / 10 : 0, perHour: perHour, byYear: byYear };
  }

  // ---------- actions ----------
  var A = {};

  A.status = function () {
    var c = ctx(), out = {
      ok: true, now: c.now.toISOString(), phase: c.phase, title: c.s.ELECTION_TITLE,
      schedule: schedule(c.s), testMode: bool(c.s.TEST_MODE), requireOtp: otpNeeded(c),
      positions: P, sealed: !!c.st.seal, sealCode: c.st.seal ? c.st.seal.code : '',
      votingOpened: !!c.st.votingOpened, maxNominations: Number(c.s.MAX_NOMINATIONS_PER_MEMBER) || 1, nominationConditions: NOMINATION_CONDITIONS
    };
    if (['NOMINEES', 'AWAITING_OPEN', 'VOTING', 'CLOSED', 'RESULTS'].indexOf(c.phase) >= 0)
      out.nominees = approvedNominees().map(function (n) { return { id: n.id, name: n.name }; });
    if (c.phase === 'RESULTS' && c.st.results) out.results = c.st.results;
    if (bool(c.s.PUBLIC_TURNOUT) && ['VOTING', 'CLOSED'].indexOf(c.phase) >= 0) {
      var tt = turnout(); out.turnout = { registered: tt.registered, voted: tt.voted, pct: tt.pct };
    }
    return out;
  };

  A.login = function (r) {
    var c = ctx();
    if (c.phase !== 'NOMINATION' && c.phase !== 'VOTING') fail(c.phase === 'AWAITING_OPEN' ? 'Voting has not been opened yet by the Election Committee.' : 'Member login is available only during nomination and voting.');
    var sno = normSno(r.studentNo), email = normEmail(r.email);
    if (!sno || !email) fail('Enter your student number and email.');
    if (hit('login:' + sno, 10, 900)) fail('Too many attempts. Please wait 15 minutes.');
    var m = membersMap().map[sno];
    if (!m || normEmail(m.email) !== email) { DB.log('LOGIN_FAILED', sno, c.phase); fail('Student number and email do not match the list of members. Check your entry, or contact the Election Committee.'); }
    if (c.phase === 'VOTING' && m.votedAt) fail('Our records show you already voted (' + manilaParts(parseDate(m.votedAt)).text + ' PHT). Only one ballot per member is allowed.');
    if (otpNeeded(c)) {
      if (DB.cacheGet('otpcd:' + sno)) fail('A code was just sent. Please wait one minute before requesting another.');
      var code = String(Math.floor(100000 + Math.random() * 900000));
      var salt = DB.randomHex(8);
      DB.cachePut('otp:' + sno, JSON.stringify({ salt: salt, hash: hashSecret(code, salt), tries: 0 }), 600);
      DB.cachePut('otpcd:' + sno, '1', 60);
      DB.sendMail(email, 'Your login code: ' + code + ' — Doctoral Council Election',
        mailShell('Your login code', '<p>Hello ' + esc(m.name) + ',</p><p>Your one-time code is:</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#123c8c">' + code + '</p><p>It expires in 10 minutes. Do not share this code with anyone.</p>'));
      return { ok: true, otpRequired: true, maskedEmail: maskEmail(email) };
    }
    DB.log('MEMBER_LOGIN', sno, c.phase);
    return { ok: true, token: newSession({ type: 'voter', sno: sno }, 7200) };
  };

  A.verifyOtp = function (r) {
    var sno = normSno(r.studentNo), raw = DB.cacheGet('otp:' + sno);
    if (!raw) fail('The code has expired. Please log in again to get a new code.');
    var o = JSON.parse(raw);
    if (o.tries >= 5) { DB.cacheDel('otp:' + sno); fail('Too many wrong codes. Please log in again.'); }
    if (hashSecret(String(r.code || '').trim(), o.salt) !== o.hash) {
      o.tries++; DB.cachePut('otp:' + sno, JSON.stringify(o), 600);
      fail('Wrong code. Please check the latest email and try again.');
    }
    DB.cacheDel('otp:' + sno);
    DB.log('MEMBER_LOGIN', sno, ctx().phase + ' (code verified)');
    return { ok: true, token: newSession({ type: 'voter', sno: sno }, 7200) };
  };

  A.me = function (r) {
    var se = getSession(r.token, 'voter'), m = membersMap().map[se.sno];
    if (!m) fail('Member not found.');
    var mine = DB.getNominations().filter(function (n) { return normSno(n.nominatorNo) === se.sno; })
      .map(function (n) { return n.nomineeName; });
    return { ok: true, name: m.name, studentNo: se.sno, yearLevel: m.yearLevel, hasVoted: !!m.votedAt, myNominations: mine };
  };

  A.nominationOptions = function (r) {
    var c = ctx(); if (c.phase !== 'NOMINATION') fail('Nomination is closed.');
    var se = getSession(r.token, 'voter');
    var selfOk = bool(c.s.ALLOW_SELF_NOMINATION);
    var comm = committeeEmails();
    var list = DB.getMembers().filter(function (m) { return isFirstYear(m.yearLevel) && !comm[normEmail(m.email)] && (selfOk || normSno(m.studentNo) !== se.sno); })
      .map(function (m) { return { id: nomId(m.studentNo), name: String(m.name).trim() }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { ok: true, options: list };
  };

  A.nominate = function (r) {
    var c = ctx(); if (c.phase !== 'NOMINATION') fail('Nomination is closed.');
    var se = getSession(r.token, 'voter');
    return DB.withLock(function () {
      var mm = membersMap(), me = mm.map[se.sno];
      var target = mm.list.filter(function (m) { return nomId(m.studentNo) === r.nomineeId; })[0];
      if (!target) fail('Please choose a nominee from the list.');
      if (!isFirstYear(target.yearLevel)) fail('Only First Year members may be nominated.');
      if (committeeEmails()[normEmail(target.email)]) fail('Members of the Election Committee cannot be nominated.');
      var conf = r.conditions || [];
      if (conf.length !== NOMINATION_CONDITIONS.length || conf.some(function (x) { return x !== true; })) fail('Please confirm all ' + NOMINATION_CONDITIONS.length + ' conditions about your nominee before submitting.');
      if (!bool(c.s.ALLOW_SELF_NOMINATION) && normSno(target.studentNo) === se.sno) fail('Self-nomination is not allowed.');
      var mine = DB.getNominations().filter(function (n) { return normSno(n.nominatorNo) === se.sno; });
      if (mine.some(function (n) { return normSno(n.nomineeNo) === normSno(target.studentNo); })) fail('You already nominated ' + target.name + '.');
      var max = Number(c.s.MAX_NOMINATIONS_PER_MEMBER) || 1;
      if (mine.length >= max) fail(max === 1 ? 'You already submitted your nomination (' + mine[0].nomineeName + '). Each member may nominate only one person.' : 'You have reached the maximum of ' + max + ' nominations.');
      DB.addNomination({ ts: c.now.toISOString(), nominatorNo: se.sno, nominatorName: me.name, nomineeNo: normSno(target.studentNo), nomineeName: target.name, reason: String(r.reason || '').slice(0, 500), conditions: 'All ' + NOMINATION_CONDITIONS.length + ' confirmed' });
      refreshNominees();
      DB.log('NOMINATION', se.sno, 'nominated ' + target.name);
      return { ok: true, nominee: target.name };
    });
  };

  function isAuto(n) { return /AUTO/i.test(String(n.remarks || '')); }
  function sourceOf(n) { var a = isAuto(n), c = Number(n.count) > 0; return a && c ? 'Registration + Nominated' : a ? 'Registration' : 'Nominated by members'; }
  function nominationStats() {
    var noms = DB.getNominations(), nominees = DB.getNominees(), who = {};
    noms.forEach(function (n) { who[normSno(n.nominatorNo)] = 1; });
    var auto = nominees.filter(isAuto);
    return {
      total: noms.length, nominators: Object.keys(who).length, nominees: nominees.length,
      approved: nominees.filter(function (n) { return bool(n.approved); }).length,
      auto: auto.length,
      autoAlsoNominated: auto.filter(function (n) { return Number(n.count) > 0; }).length,
      nominatedOnly: nominees.filter(function (n) { return !isAuto(n); }).length
    };
  }

  function refreshNominees() {
    var mm = membersMap().map, agg = {};
    DB.getNominations().forEach(function (n) {
      var k = normSno(n.nomineeNo); var m = mm[k];
      agg[k] = agg[k] || { studentNo: k, name: m ? m.name : n.nomineeName, yearLevel: m ? m.yearLevel : '', count: 0 };
      agg[k].count++;
    });
    var list = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return b.count - a.count || String(a.name).localeCompare(String(b.name)); });
    DB.syncNominees(list);
    return list.length;
  }

  A.castBallot = function (r) {
    var c = ctx();
    if (c.phase !== 'VOTING') fail(c.phase === 'CLOSED' || c.phase === 'RESULTS' ? 'Voting is closed. Your ballot was not recorded.' : 'Voting is not open.');
    var se = getSession(r.token, 'voter');
    var clean = cleanBallot(r.choices, approvedNominees());
    return DB.withLock(function () {
      var c2 = ctx(); if (c2.phase !== 'VOTING') fail('Voting is closed. Your ballot was not recorded.');
      var m = membersMap().map[se.sno];
      if (!m) fail('Member not found.');
      if (m.votedAt) fail('You already voted. Only one ballot per member is allowed.');
      DB.addBallot(DB.randomHex(8).toUpperCase(), clean.choices); // no voter identity, no timestamp
      DB.markVoted(se.sno, c2.now.toISOString());
      DB.cacheDel('sess:' + r.token);
      DB.log('BALLOT_CAST', 'VOTER', 'one ballot received');
      return { ok: true, at: c2.now.toISOString() };
    });
  };

  A.officialLogin = function (r) {
    var email = normEmail(r.email), off = officials().filter(function (o) { return o.email === email; })[0];
    if (hit('olog:' + email, 10, 900)) fail('Too many attempts. Please wait 15 minutes.');
    if (!off) fail('This email is not listed as Election Committee or Observer.');
    if (!checkPin(off, r.pin)) fail('Wrong PIN.');
    DB.log('OFFICIAL_LOGIN', off.email, ROLE_LABELS[off.role] || off.role);
    return { ok: true, token: newSession({ type: 'official', email: off.email, role: off.role, name: off.name }, 21600), role: off.role, name: off.name };
  };

  // First login: an official enters only the NTC email. With no PIN yet, they create one (typed twice).
  A.officialStart = function (r) {
    var email = normEmail(r.email);
    if (!email) fail('Enter your NTC email.');
    if (hit('ostart:' + email, 20, 900)) fail('Too many attempts. Please wait 15 minutes.');
    var off = officials().filter(function (o) { return o.email === email; })[0];
    if (!off) fail('This email is not listed as Election Committee or Observer.');
    return { ok: true, email: off.email, name: off.name, role: off.role, hasPin: !!DB.getProp('pin:' + off.email) };
  };

  function validNewPin(pin) {
    if (!/^\d{6}$/.test(pin)) fail('The PIN must be exactly 6 digits.');
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.indexOf(pin) >= 0 || '9876543210'.indexOf(pin) >= 0) fail('This PIN is too easy to guess. Choose another.');
  }

  A.createPin = function (r) {
    var email = normEmail(r.email), pin = String(r.pin || ''), pin2 = String(r.pin2 || '');
    if (hit('ostart:' + email, 20, 900)) fail('Too many attempts. Please wait 15 minutes.');
    var off = officials().filter(function (o) { return o.email === email; })[0];
    if (!off) fail('This email is not listed as Election Committee or Observer.');
    return DB.withLock(function () {
      if (DB.getProp('pin:' + off.email)) fail('A PIN was already created for this email. Log in with it, or ask ALI or the Chairman to reset it from the Google Sheet.');
      validNewPin(pin);
      if (pin !== pin2) fail('The two PINs do not match.');
      var salt = DB.randomHex(12);
      DB.setProp('pin:' + off.email, JSON.stringify({ salt: salt, hash: hashSecret(pin, salt), at: DB.now().toISOString() }));
      DB.log('PIN_SET', off.email, 'created at first login · ' + (ROLE_LABELS[off.role] || off.role));
      DB.log('OFFICIAL_LOGIN', off.email, ROLE_LABELS[off.role] || off.role);
      return { ok: true, token: newSession({ type: 'official', email: off.email, role: off.role, name: off.name }, 21600), role: off.role, name: off.name };
    });
  };

  // Sheet menu: clear an official's PIN so they can create a new one at next login.
  function clearPin(email, by) {
    var off = officials().filter(function (o) { return o.email === normEmail(email); })[0];
    if (!off) return false;
    DB.delProp('pin:' + off.email); DB.cacheDel('pinfail:' + off.email);
    DB.log('PIN_CLEARED', off.email, 'cleared from Sheet menu' + (by ? ' by ' + by : '') + ' · ' + (ROLE_LABELS[off.role] || off.role));
    return true;
  }

  A.requestPinLink = function (r) {
    var email = normEmail(r.email);
    if (!email) fail('Enter your email.');
    if (DB.cacheGet('pinlinkcd:' + email)) fail('A link was sent recently. Please check your email (and Spam folder) or wait 2 minutes.');
    DB.cachePut('pinlinkcd:' + email, '1', 120);
    sendPinLink(email, 'requested from site');
    return { ok: true, message: 'If this email belongs to the Election Committee or an Observer, a PIN link was sent to it.' };
  };

  A.checkSetupToken = function (r) {
    var raw = DB.getProp('setup:' + DB.sha256(String(r.setupToken || '')));
    if (!raw) fail('This link is invalid or was already used. Request a new link.');
    var o = JSON.parse(raw), c = ctx();
    if (o.exp < DB.now().getTime() && o.exp < c.now.getTime()) fail('This link has expired. Request a new link.');
    var off = officials().filter(function (x) { return x.email === o.email; })[0];
    return { ok: true, name: off ? off.name : o.email, role: off ? off.role : '' };
  };

  A.setPin = function (r) {
    A.checkSetupToken(r);
    var key = 'setup:' + DB.sha256(String(r.setupToken || '')), o = JSON.parse(DB.getProp(key));
    var pin = String(r.pin || '');
    validNewPin(pin);
    var had = !!DB.getProp('pin:' + o.email), salt = DB.randomHex(12);
    DB.setProp('pin:' + o.email, JSON.stringify({ salt: salt, hash: hashSecret(pin, salt), at: DB.now().toISOString() }));
    DB.delProp(key);
    DB.cacheDel('pinfail:' + o.email);
    DB.log(had ? 'PIN_RESET' : 'PIN_SET', o.email, '');
    return { ok: true };
  };

  function official(r, committeeOnly) {
    var se = getSession(r.token, 'official');
    if (committeeOnly && COMMITTEE_ROLES.indexOf(se.role) < 0) fail('Observers have view-only access.');
    return se;
  }

  A.dashboard = function (r) {
    var me = official(r);
    var c = ctx(), tt = turnout(), nominees = DB.getNominees();
    return {
      ok: true, now: c.now.toISOString(), phase: c.phase, schedule: schedule(c.s), title: c.s.ELECTION_TITLE,
      testMode: bool(c.s.TEST_MODE),
      state: { sealed: !!c.st.seal, votingOpened: !!c.st.votingOpened, openedAt: c.st.openedAt || '', votingClosed: !!c.st.votingClosed, closedAt: c.st.closedAt || '', resultsPublished: !!c.st.resultsPublished, resultsAt: c.st.resultsAt || '', fts: Object.assign({}, c.st.fts || {}, { results: undefined, voters: undefined, votedCount: ((c.st.fts || {}).voters || []).length }), testBallots: testBox().length, officialsCount: officials().length, iVotedTest: ((c.st.fts || {}).voters || []).indexOf(me.email) >= 0 },
      seal: sealStatus(c.s, c.st), turnout: tt, ballotsInBox: DB.countBallots(),
      nominations: nominationStats(),
      committee: committeeNames(), openWindowHours: Number(c.s.OPEN_WINDOW_HOURS) || 0, twoPinActions: twoPinActions(c.s)
    };
  };

  A.nomineesAdmin = function (r) {
    official(r);
    return { ok: true, nominees: DB.getNominees().map(function (n) { return { name: n.name, yearLevel: n.yearLevel, count: Number(n.count) || 0, approved: bool(n.approved), remarks: n.remarks || '', source: sourceOf(n) }; }) };
  };

  // ----- Final Testing: test election with a separate TEST ballot box -----
  function testBox() { try { return JSON.parse(DB.getProp('FTS_BALLOTS') || '[]'); } catch (e) { return []; } }
  function ftsWindow(c) { var n = c.now.getTime(); return n >= t(c.s, 'NOMINEES_PUBLISH') && n < t(c.s, 'VOTING_START') && !c.st.votingOpened; }
  A.castTestBallot = function (r) {
    var se = official(r); // all 6 officials (Committee and Observers) cast one test ballot each
    return DB.withLock(function () {
      var c = ctx(), st = c.st, f = st.fts || {};
      if (!f.open) fail('Test voting is not open. The Chairman opens it in Election controls.');
      f.voters = f.voters || [];
      if (f.voters.indexOf(se.email) >= 0) fail('You already cast your test ballot. Each official casts one test ballot.');
      var clean = cleanBallot(r.choices, approvedNominees());
      var box = testBox();
      box.splice(Math.floor(Math.random() * (box.length + 1)), 0, { id: 'TEST-' + DB.randomHex(3).toUpperCase(), choices: clean.choices });
      DB.setProp('FTS_BALLOTS', JSON.stringify(box));
      f.voters.push(se.email); st.fts = f; saveState(st);
      DB.log('TEST_BALLOT_CAST', se.email, 'Test ballot ' + box.length + ' of ' + officials().length + ' in TEST box');
      return { ok: true, count: box.length, of: officials().length };
    });
  };
  function ftsReport(c, res) {
    return { kind: 'fts', title: c.s.ELECTION_TITLE, generatedAt: c.now.toISOString(), results: res, fts: c.st.fts || {}, committee: committeeNames(), seal: sealStatus(c.s, c.st), realBallots: DB.countBallots() };
  }

  A.ballotPreview = function (r) { // checks a ballot without saving anything
    var se = official(r), c = ctx();
    var approved = approvedNominees(); if (!approved.length) fail('There are no approved nominees yet.');
    var clean = cleanBallot(r.choices, approved);
    DB.log('DEMO_BALLOT_TEST', se.email, clean.picks + ' choices checked; NOT saved');
    return { ok: true, valid: true, picks: clean.picks, saved: false, phase: c.phase };
  };

  A.nomineesForDemo = function (r) {
    official(r);
    return { ok: true, nominees: approvedNominees().map(function (n) { return { id: n.id, name: n.name }; }) };
  };

  A.committeeAction = function (r) {
    var se = official(r, true);
    return DB.withLock(function () {
      var c = ctx(), st = c.st, n = c.now.getTime(), act = r.act;
      var by;
      if (act === 'TEST_OPEN' || act === 'TEST_CLOSE' || act === 'REZERO') {
        if (!ftsWindow(c)) fail('The test election is done during Final Testing and Sealing, after nominees are posted and before voting.');
        if (st.seal) fail('The election is already sealed. Testing is finished.');
        var f = st.fts || {};
        if (act === 'TEST_OPEN') {
          if (f.open) fail('Test voting is already open.');
          if (!approvedNominees().length) fail('There are no approved nominees yet.');
          if (testBox().length) fail('The TEST box still has ballots. Re-zero first.');
          by = verifyPins(r.pins, act, c.s);
          st.fts = { open: true, openedAt: c.now.toISOString(), openedBy: by }; saveState(st);
          DB.log('TEST_VOTING_OPENED', se.email, 'by ' + by.join(' & '));
          return { ok: true, message: 'Test voting is open. Each of the ' + officials().length + ' officials (Committee and Observers) logs in and casts one test ballot in the Test election tab.' };
        }
        if (act === 'TEST_CLOSE') {
          if (!f.open) fail('Test voting is not open.');
          by = verifyPins(r.pins, act, c.s);
          var tb = testBox(), tres = tally(tb, approvedNominees(), []);
          tres.generatedAt = c.now.toISOString();
          f.open = false; f.closed = true; f.closedAt = c.now.toISOString(); f.closedBy = by; f.count = tb.length; f.results = tres; f.rezeroedAt = '';
          st.fts = f; saveState(st);
          DB.log('TEST_VOTING_CLOSED', se.email, tb.length + ' test ballots · by ' + by.join(' & '));
          return { ok: true, message: 'Test voting closed with ' + tb.length + ' test ballots. Check the test results, then re-zero.', report: ftsReport(ctx(), tres) };
        }
        if (!f.closed) fail('Close the test voting first.');
        by = verifyPins(r.pins, act, c.s);
        var had = testBox().length;
        DB.setProp('FTS_BALLOTS', '[]');
        f.rezeroedAt = c.now.toISOString(); f.rezeroedBy = by; f.closed = false; f.done = true; st.fts = f; saveState(st);
        DB.log('REZERO', se.email, had + ' test ballots deleted; all counts back to zero · by ' + by.join(' & '));
        return { ok: true, message: 'Re-zero done. ' + had + ' test ballots deleted. All counts are zero. You may now seal.', report: initReport(ctx(), 'Zero Report (after re-zero)') };
      }
      if (act === 'SEAL') {
        if (st.votingOpened) fail('Voting was already opened. The election can no longer be sealed again.');
        var ff = st.fts || {};
        if (ff.open) fail('Close the test voting first.');
        if (!ff.done || !ff.rezeroedAt || testBox().length) fail('Run the test election and re-zero before sealing.');
        if (n < t(c.s, 'NOMINEES_PUBLISH') || n >= t(c.s, 'VOTING_START')) fail('Sealing is done during Final Testing and Sealing, after nominees are published and before voting starts.');
        if (!approvedNominees().length) fail('There are no approved nominees to seal.');
        if (DB.countBallots() > 0) fail('The ballot box is not empty. Ballots must be zero before sealing.');
        by = verifyPins(r.pins, act, c.s);
        var sp = sealParts(c.s), was = st.seal;
        st.seal = { parts: sp.parts, hash: sp.hash, code: sp.code, commit: String(r.commit || '').slice(0, 64), at: c.now.toISOString(), by: by, members: sp.memberCount, nominees: sp.nomineeCount };
        saveState(st);
        try { DB.protectSheets(); } catch (e) { DB.log('PROTECT_WARNING', 'SYSTEM', String(e)); }
        DB.log(was ? 'RESEALED' : 'SEALED', se.email, 'Seal ' + sp.code + (was ? ' (replaces ' + was.code + ')' : '') + ' · commit ' + (st.seal.commit || 'n/a') + ' · by ' + by.join(' & '));
        return { ok: true, message: 'Election sealed. Seal code ' + sp.code + '.', report: initReport(c, 'Initialization Report (Final Testing and Sealing)') };
      }
      if (act === 'OPEN') {
        if (!st.seal) fail('The election must be sealed first (Final Testing and Sealing).');
        if (st.votingOpened) fail('Voting is already open.');
        var win = (Number(c.s.OPEN_WINDOW_HOURS) || 0) * 3600 * 1000;
        if (n < t(c.s, 'VOTING_START') - win) fail('Too early. Voting can be opened starting ' + manilaParts(new Date(t(c.s, 'VOTING_START') - win)).text + ' PHT.');
        if (n >= t(c.s, 'VOTING_END')) fail('The voting period has already ended.');
        var ss = sealStatus(c.s, st);
        if (!ss.intact) { DB.log('SEAL_CHECK_FAILED', se.email, 'Changed: ' + ss.broken.join(', ')); fail('SEAL BROKEN: ' + ss.broken.join(', ') + ' changed after sealing. Voting cannot be opened. Restore the data or re-seal before voting.'); }
        if (st.seal.commit && r.commit && st.seal.commit !== r.commit) { DB.log('SEAL_CHECK_FAILED', se.email, 'Website commit changed ' + st.seal.commit + ' -> ' + r.commit); fail('SEAL BROKEN: the website code changed since sealing (commit ' + String(r.commit).slice(0, 7) + ' vs sealed ' + st.seal.commit.slice(0, 7) + ').'); }
        if (DB.countBallots() > 0) fail('The ballot box is not empty. Voting cannot be opened.');
        by = verifyPins(r.pins, act, c.s);
        st.votingOpened = true; st.openedAt = c.now.toISOString(); st.openedBy = by;
        saveState(st);
        DB.log('SEAL_VERIFIED', se.email, 'Seal intact ' + st.seal.code + (r.commit ? ' · commit ' + r.commit : ' · commit not checked'));
        DB.log('VOTING_OPENED', se.email, 'by ' + by.join(' & '));
        return { ok: true, message: 'Seal intact. Voting is now open' + (n < t(c.s, 'VOTING_START') ? ' (ballots accepted from ' + manilaParts(new Date(t(c.s, 'VOTING_START'))).text + ' PHT)' : '') + '.', report: initReport(c, 'Initialization Report (Opening of Voting)') };
      }
      if (act === 'CLOSE') {
        if (!st.votingOpened) fail('Voting was never opened.');
        if (st.votingClosed) fail('Voting is already closed.');
        if (n < t(c.s, 'VOTING_END')) fail('Voting can only be closed at or after ' + manilaParts(new Date(t(c.s, 'VOTING_END'))).text + ' PHT.');
        by = verifyPins(r.pins, act, c.s);
        st.votingClosed = true; st.closedAt = c.now.toISOString(); st.closedBy = by;
        saveState(st);
        DB.log('VOTING_CLOSED', se.email, 'Ballots in box: ' + DB.countBallots() + ' · by ' + by.join(' & '));
        return { ok: true, message: 'Voting closed. ' + DB.countBallots() + ' ballots in the box.' };
      }
      if (act === 'RESULTS') {
        if (!st.votingClosed) fail('Close the voting first.');
        by = verifyPins(r.pins, act, c.s);
        var res = tally(DB.getBallots(), approvedNominees(), DB.getTieBreaks());
        var tt = turnout();
        res.generatedAt = c.now.toISOString(); res.registered = tt.registered; res.voted = tt.voted; res.turnoutPct = tt.pct;
        res.sealCode = st.seal ? st.seal.code : ''; res.by = by;
        var again = !!st.resultsPublished;
        st.results = res; st.resultsPublished = true; st.resultsAt = res.generatedAt;
        saveState(st);
        DB.saveResults(res);
        DB.log(again ? 'RESULTS_REGENERATED' : 'RESULTS_GENERATED', se.email, res.totalBallots + ' ballots' + (res.ties.length ? ' · TIE in ' + res.ties.join(', ') : '') + ' · by ' + by.join(' & '));
        return { ok: true, message: 'Results generated and published.' + (res.ties.length ? ' Tie found in: ' + res.ties.join(', ') + '.' : ''), results: res };
      }
      fail('Unknown action.');
    });
  };

  A.report = function (r) {
    official(r);
    var c = ctx();
    if (r.kind === 'init') return { ok: true, report: initReport(c) };
    if (r.kind === 'fts') { var f = c.st.fts || {}; if (!f.results) fail('No test election results yet.'); return { ok: true, report: ftsReport(c, f.results) }; }
    if (r.kind === 'canvass') {
      if (!c.st.resultsPublished) fail('Results have not been generated yet.');
      return { ok: true, report: { kind: 'canvass', title: c.s.ELECTION_TITLE, generatedAt: c.now.toISOString(), results: c.st.results, seal: sealStatus(c.s, c.st), state: { openedAt: c.st.openedAt, closedAt: c.st.closedAt, openedBy: c.st.openedBy, closedBy: c.st.closedBy }, committee: committeeNames(), schedule: schedule(c.s), log: DB.getLog(400) } };
    }
    fail('Unknown report.');
  };

  A.auditLog = function (r) { official(r); return { ok: true, log: DB.getLog(500) }; };

  return {
    handle: function (req) {
      req = req || {};
      var fn = A[req.action];
      if (!fn) return { ok: false, error: 'Unknown action.' };
      try { return fn(req); }
      catch (e) { if (e && e.userMessage) return { ok: false, error: e.userMessage }; throw e; }
    },
    // used by Apps Script menu functions
    refreshNominees: refreshNominees,
    sendPinLink: sendPinLink,
    clearPin: clearPin,
    status: function () { return A.status(); },
    resetState: function () { DB.setProp('STATE', '{}'); },
    tally: tally,
    nomId: nomId
  };
}

if (typeof module !== 'undefined') module.exports = { NOMINATION_CONDITIONS: NOMINATION_CONDITIONS, ElectionLogic: ElectionLogic, ELECTION_POSITIONS: ELECTION_POSITIONS, ELECTION_DEFAULT_SETTINGS: ELECTION_DEFAULT_SETTINGS };
