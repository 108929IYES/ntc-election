/* Doctoral Council Election — website logic (GitHub Pages). */
(function () {
  'use strict';
  var CFG = window.ELECTION_CONFIG || {};
  var DEMO = !CFG.API_URL;
  var LOGO = 'logo.png';
  var PH = 'Asia/Manila';
  var SAME_TZ = new Date().getTimezoneOffset() === -480;
  var LOCAL_TZ = (Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone');
  var ROLE = { CHAIRMAN: 'Chairman', POLL_CLERK: 'Poll Clerk', MEMBER: 'Member', OBSERVER: 'Observer' };
  var COMMITTEE = ['CHAIRMAN', 'POLL_CLERK', 'MEMBER'];

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { } }
  };

  // ---------------- server connection ----------------
  var MDB = null, LOGIC = null;
  var DEMO_START = '2026-11-26T10:00:00+08:00';
  if (DEMO) {
    MDB = window.MockDB({ storage: { getItem: store.get, setItem: store.set }, startAt: DEMO_START });
    LOGIC = window.ElectionLogic(MDB);
    demoSeed();
  }
  function demoSeed() {
    if (!MDB.demo.data().seeded) {
      MDB.demo.data().seeded = true; MDB.demo.save();
      LOGIC.refreshNominees();
      MDB.getNominees().forEach(function (n) { MDB.demo.setApproved(n.studentNo, n.studentNo !== '2025-1009'); });
    }
  }
  function api(action, params) {
    var req = Object.assign({ action: action }, params || {});
    if (DEMO) {
      return new Promise(function (res) {
        setTimeout(function () {
          try { res(LOGIC.handle(req)); } catch (e) { console.error(e); res({ ok: false, error: 'Demo error: ' + e.message }); }
        }, 120);
      });
    }
    return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(req) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Cannot reach the election server. Check your internet connection and try again.' }; });
  }
  function getCommit() {
    if (DEMO) return Promise.resolve('d3m0c0mm17a9b4e2f6c81d5e0b7a3f9c2e4d6b8a');
    if (!CFG.GITHUB_REPO) return Promise.resolve('');
    return fetch('https://api.github.com/repos/' + CFG.GITHUB_REPO + '/commits?per_page=1')
      .then(function (r) { return r.json(); }).then(function (j) { return (j && j[0] && j[0].sha) || ''; })
      .catch(function () { return ''; });
  }

  // ---------------- state ----------------
  var S = {
    status: null, drift: 0, view: 'home', msg: null,
    voter: null, otp: null, me: null, options: null, ballot: {}, purpose: null,
    official: null, offTab: 'dashboard', dash: null, report: null, modal: null, adminNominees: null, log: null,
    demoNominees: null, demoBallot: {}, setup: null, demoOpen: store.get('demoOpen') ? store.get('demoOpen') === '1' : window.innerWidth >= 1100, busy: false
  };
  try { var so = JSON.parse(sessionStorage.getItem('officialSession') || 'null'); if (so) S.official = so; } catch (e) { }

  // ---------------- helpers ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(iso, tz, o) {
    var opt = Object.assign({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, o || {});
    if (tz) opt.timeZone = tz;
    Object.keys(opt).forEach(function (k) { if (opt[k] === undefined) delete opt[k]; });
    return new Intl.DateTimeFormat('en-US', opt).format(new Date(iso));
  }
  function ph(iso, o) { return fmt(iso, PH, o) + ' PHT'; }
  function both(iso, o) { return esc(ph(iso, o)) + (SAME_TZ ? '' : ' <span class="muted small">· ' + esc(fmt(iso, null, Object.assign({ timeZoneName: 'short' }, o || {}))) + ' your time</span>'); }
  function dateOnly(iso, tz) { return fmt(iso, tz || PH, { hour: undefined, minute: undefined, year: undefined }); }
  function now() { return new Date(Date.now() + S.drift); }
  function dur(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var p = function (n) { return ('0' + n).slice(-2); };
    return (d ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(x);
  }
  function initials(n) { return String(n).replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }
  function $(sel) { return document.querySelector(sel); }
  function msgHTML() { return S.msg ? '<div class="msg ' + S.msg.type + '" role="status">' + esc(S.msg.text) + '</div>' : ''; }
  function flash(type, text) { S.msg = { type: type, text: text }; }
  function sch() { return S.status.schedule; }
  function isCommittee() { return S.official && COMMITTEE.indexOf(S.official.role) >= 0; }

  var PHASES = {
    UPCOMING: { pill: 'Coming soon', eyebrow: 'Doctoral Council Election', h: 'Nominations open soon', p: function () { return 'Members may nominate First Year members starting ' + both(sch().NOMINATION_START) + '.'; } },
    NOMINATION: { pill: 'Nominations open', eyebrow: 'Now open · Nomination', h: 'Nominate our next officers', p: function () { return 'Every member may nominate First Year members of the Doctoral Council. You nominate a person only; positions are chosen by voters on election day. Nominations close ' + both(new Date(new Date(sch().NOMINATION_END).getTime() - 1000).toISOString()) + '.'; } },
    EVALUATION: { pill: 'Nominations closed', eyebrow: 'Evaluation', h: 'Nominations are closed', p: function () { return 'The Election Committee is evaluating the nominees. The official list of approved nominees will be posted on ' + esc(dateOnly(sch().NOMINEES_PUBLISH)) + '.'; } },
    NOMINEES: { pill: 'Nominees posted', eyebrow: 'Official list of nominees', h: 'Meet the nominees', p: function () { return 'Online voting runs from ' + both(sch().VOTING_START) + ' to ' + both(sch().VOTING_END) + '. Every member may vote once.'; } },
    AWAITING_OPEN: { pill: 'Opening soon', eyebrow: 'Election day', h: 'Voting will open shortly', p: function () { return 'The Election Committee is completing the opening of the polls. Please refresh this page in a few minutes.'; } },
    VOTING: { pill: 'Voting open', eyebrow: 'Election day · Voting is open', h: 'Cast your vote', p: function () { return 'Log in with your student number and email to receive your official ballot. Voting closes ' + both(sch().VOTING_END) + '.'; } },
    CLOSED: { pill: 'Voting closed', eyebrow: 'Canvassing', h: 'Voting has closed', p: function () { return 'Thank you for voting. The Election Committee is canvassing the votes. Official results will be posted on this page.'; } },
    RESULTS: { pill: 'Official results', eyebrow: 'Official results', h: 'Election results', p: function () { return 'Certified by the Election Committee. Positions are counted from President down; a nominee already elected to a higher position is skipped.'; } }
  };

  // ---------------- loading status ----------------
  function loadStatus() {
    return api('status').then(function (s) {
      if (!s.ok) { flash('err', s.error || 'Cannot load the election status.'); return; }
      var prev = S.status && S.status.phase;
      S.status = s; S.drift = new Date(s.now).getTime() - Date.now();
      if (prev && prev !== s.phase && (S.view === 'ballot' || S.view === 'nominate' || S.view === 'review')) {
        S.voter = null; S.view = 'home'; flash('info', 'The election moved to the next stage: ' + PHASES[s.phase].pill + '.');
      }
    });
  }

  // ---------------- rendering ----------------
  function render() {
    var app = $('#app');
    if (!S.status) { app.innerHTML = '<div class="wrap hero"><p class="muted">Loading the election…</p>' + msgHTML() + '</div>'; return; }
    var v = S.view, html;
    if (v === 'login') html = loginHTML();
    else if (v === 'otp') html = otpHTML();
    else if (v === 'nominate') html = nominateHTML();
    else if (v === 'ballot') html = ballotPageHTML();
    else if (v === 'review') html = reviewHTML();
    else if (v === 'done') html = doneHTML();
    else if (v === 'officials') html = officialsHTML();
    else if (v === 'setup') html = setupHTML();
    else html = homeHTML();
    app.innerHTML = html + (S.modal ? modalHTML() : '');
    $('#phasePill').textContent = PHASES[S.status.phase].pill;
    $('#electionTitle').textContent = S.status.title;
    var ban = [];
    if (DEMO) ban.push('DEMO MODE — dummy students only. Nothing here is real or sent anywhere. Use the yellow "Demo controls" button to change the date.');
    if (S.status.testMode) ban.push('TEST MODE is ON — the system is using a simulated date. Turn it off in the Sheet before the real election.');
    $('#banner').hidden = !ban.length; $('#bannerText').textContent = ban.join(' ');
    $('#footSeal').innerHTML = S.status.sealed ? 'Seal code <span class="mono">' + esc(S.status.sealCode) + '</span>' : '';
    if (DEMO) renderDemo();
    tick();
  }

  function timelineHTML() {
    var s = sch(), ph_ = S.status.phase;
    var cur = { UPCOMING: -1, NOMINATION: 0, EVALUATION: 1, NOMINEES: 2, AWAITING_OPEN: 4, VOTING: 4, CLOSED: 5, RESULTS: 5 }[ph_];
    var nd = now();
    if (ph_ === 'NOMINEES' && dateOnly(nd.toISOString()) === dateOnly(s.FTS_DATE)) cur = 3;
    var endNom = new Date(new Date(s.NOMINATION_END).getTime() - 1000).toISOString();
    var endEval = new Date(new Date(s.NOMINEES_PUBLISH).getTime() - 1000).toISOString();
    var endNominees = new Date(new Date(s.VOTING_START).getTime() - 12 * 3600000).toISOString();
    var items = [
      [dateOnly(s.NOMINATION_START) + ' – ' + dateOnly(endNom), 'Nomination'],
      [dateOnly(s.NOMINATION_END) + ' – ' + dateOnly(endEval), 'Evaluation by the Election Committee'],
      [dateOnly(s.NOMINEES_PUBLISH) + ' – ' + dateOnly(endNominees), 'Posting of approved nominees'],
      [dateOnly(s.FTS_DATE), 'Final Testing and Sealing'],
      [fmt(s.VOTING_START, PH, { year: undefined }) + ' – ' + fmt(s.VOTING_END, PH, { year: undefined }), 'Online voting (PHT)'],
      ['After voting closes', 'Canvassing and results']
    ];
    return '<section class="block wrap" aria-label="Election calendar"><h2>Election calendar</h2><div class="timeline">' + items.map(function (it, i) {
      var cls = i === cur ? 'now' : (i < cur && !(cur === 3 && i === 2) ? 'done' : '');
      if (cur === 3 && i === 2) cls = 'now';
      return '<div class="' + cls + '"><div class="when">' + esc(it[0]) + '</div><div class="what">' + esc(it[1]) + '</div>' + (i === cur ? '<span class="pill">Now</span>' : '') + '</div>';
    }).join('') + '</div>' + (SAME_TZ ? '' : '<p class="small muted">Times are Philippine Standard Time (PHT, UTC+8). Your device is set to ' + esc(LOCAL_TZ) + '; your local time is shown beside key times.</p>') + '</section>';
  }

  function nomineesGridHTML(list) {
    if (!list || !list.length) return '<p class="muted">No approved nominees yet.</p>';
    return '<div class="nominees">' + list.map(function (n) { return '<div class="nominee"><span class="avatar">' + esc(initials(n.name)) + '</span><span>' + esc(n.name) + '</span></div>'; }).join('') + '</div>';
  }

  function homeHTML() {
    var s = S.status, P = PHASES[s.phase], cta = '', extra = '';
    if (s.phase === 'UPCOMING') cta = countdownHTML('Nominations open in', sch().NOMINATION_START);
    if (s.phase === 'NOMINATION') cta = '<div class="row"><button class="btn big" data-act="start-login">Nominate now</button>' + countdownHTML('Closes in', sch().NOMINATION_END, true) + '</div>';
    if (s.phase === 'NOMINEES') cta = countdownHTML('Voting opens in', sch().VOTING_START);
    if (s.phase === 'VOTING') cta = '<div class="row"><button class="btn big" data-act="start-login">Vote now</button>' + countdownHTML('Voting closes in', sch().VOTING_END, true) + '</div>' +
      (s.turnout ? '<p class="small muted">Turnout so far: <b>' + s.turnout.voted + '</b> of ' + s.turnout.registered + ' members (' + s.turnout.pct + '%)</p>' : '');
    if (s.phase === 'CLOSED' && s.turnout) extra = '<p>Final turnout: <b>' + s.turnout.voted + '</b> of ' + s.turnout.registered + ' members (' + s.turnout.pct + '%)</p>';
    var html = '<div class="wrap hero"><div class="eyebrow">' + esc(P.eyebrow) + '</div><h1>' + esc(P.h) + '</h1><p>' + P.p() + '</p>' + cta + extra + msgHTML() + '</div>';
    if (s.phase === 'RESULTS' && s.results) html += resultsHTML(s.results);
    else if (s.nominees) html += '<section class="block wrap"><h2>Approved nominees</h2><p class="small muted">Listed alphabetically. On the ballot you may choose any nominee for any position; each nominee can be chosen only once per ballot.</p>' + nomineesGridHTML(s.nominees) + '</section>';
    if (s.phase === 'RESULTS' || s.phase === 'NOMINEES' || s.phase === 'AWAITING_OPEN') html += positionsHTML();
    html += timelineHTML();
    if (s.phase === 'NOMINATION' || s.phase === 'UPCOMING') html += positionsHTML();
    return html;
  }

  function positionsHTML() {
    return '<section class="block wrap"><h2>Positions to be filled</h2><div class="panel"><ol style="margin:0;padding-left:20px;columns:2 240px">' +
      S.status.positions.map(function (p) { return '<li>' + esc(p.title) + (p.seats > 1 ? ' <span class="muted small">(' + p.seats + ' seats)</span>' : '') + '</li>'; }).join('') +
      '</ol><p class="small muted" style="margin:10px 0 0">Article VI, Section 11 of the Doctoral Council Constitution · 11 officers in all. Only First Year members may be nominated.</p></div></section>';
  }

  function countdownHTML(label, iso, inline) {
    return '<div class="' + (inline ? '' : 'panel ') + 'small" style="' + (inline ? '' : 'max-width:420px') + '"><span class="muted">' + esc(label) + '</span> <b class="num" style="font-size:18px" data-countdown="' + esc(iso) + '">–</b></div>';
  }

  // ----- member login -----
  function loginHTML() {
    var voting = S.status.phase === 'VOTING';
    return '<section class="block wrap"><div class="panel"><div class="form">' +
      '<div class="formhead"><img src="' + LOGO + '" alt="Doctoral Council logo"><div><div class="eyebrow">Member login</div><h2>' + (voting ? 'Log in to vote' : 'Log in to nominate') + '</h2></div></div>' +
      '<p class="small muted" style="margin:0">Use the student number and email registered with the Doctoral Council (from the Registrar\'s list).' + (S.status.requireOtp ? ' We will email you a 6-digit code.' : '') + '</p>' +
      '<form id="fLogin" class="form" autocomplete="on"><div class="field"><label for="sno">Student number</label><input id="sno" name="sno" required autocomplete="username" inputmode="text"></div>' +
      '<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"></div>' + msgHTML() +
      '<div class="row"><button class="btn" type="submit">Continue</button><button class="btn ghost" type="button" data-act="home">Cancel</button></div></form></div></div></section>';
  }
  function otpHTML() {
    return '<section class="block wrap"><div class="panel"><div class="form"><div class="formhead"><img src="' + LOGO + '" alt=""><div><div class="eyebrow">Check your email</div><h2>Enter your 6-digit code</h2></div></div>' +
      '<p style="margin:0">We sent a code to <b>' + esc(S.otp.masked) + '</b>. It expires in 10 minutes. Check your Spam folder if you do not see it.</p>' +
      '<form id="fOtp" class="form"><div class="field"><label for="code">Code</label><input id="code" class="pin" inputmode="numeric" maxlength="6" pattern="\\d{6}" required autocomplete="one-time-code"></div>' + msgHTML() +
      '<div class="row"><button class="btn" type="submit">Verify</button><button class="btn ghost" type="button" data-act="start-login">Send a new code</button></div></form></div></div></section>';
  }

  // ----- nomination -----
  function nominateHTML() {
    var me = S.me, max = S.status.maxNominations, mine = me.myNominations || [];
    var left = max - mine.length;
    var one = max === 1;
    return '<section class="block wrap"><div class="panel"><div class="formhead"><img src="' + LOGO + '" alt=""><div><div class="eyebrow">Nomination form</div><h2>Hello, ' + esc(me.name) + '</h2></div></div></div>' +
      (mine.length ? '<div class="panel"><h3 style="font-size:16px">' + (one ? 'Your nominee' : 'Your nominations (' + mine.length + ' of ' + max + ')') + '</h3><div class="nominees" style="margin-top:10px">' + mine.map(function (n) { return '<div class="nominee"><span class="avatar">' + esc(initials(n)) + '</span>' + esc(n) + '</div>'; }).join('') + '</div></div>' : '') +
      (left > 0 ? '<div class="panel"><form id="fNominate" class="form" style="max-width:none">' +
        '<p style="margin:0">' + (one ? 'You may nominate <b>one (1)</b> First Year member. Choose carefully: you cannot change it after submitting.' : 'You may nominate up to ' + max + ' First Year members.') + '</p>' +
        '<div class="field"><label for="nomSearch">Choose a First Year member</label><input id="nomSearch" placeholder="Type a name to search" autocomplete="off"></div>' +
        '<div id="nomList" style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px">' + nomOptionsHTML('') + '</div>' +
        '<fieldset class="panel" style="display:grid;gap:8px;background:var(--sky);border-color:var(--line)"><legend style="font-weight:700;padding:0 6px">I confirm that my nominee (even if it is myself):</legend>' +
        (S.status.nominationConditions || []).map(function (c, i) { return '<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="cond" id="cond' + i + '" style="margin-top:4px;width:18px;height:18px;flex:none"> <span>' + esc(c.replace(/^The nominee is /, 'is ')) + '</span></label>'; }).join('') +
        '<span class="small muted">All boxes must be checked. The nominee must also be a First Year member.</span></fieldset>' +
        '<div class="field"><label for="reason">Reason for nomination <span class="muted">(optional)</span></label><textarea id="reason" rows="3" maxlength="500"></textarea></div>' + msgHTML() +
        '<div class="row"><button class="btn" type="submit">Submit nomination</button><button class="btn ghost" type="button" data-act="logout">Log out</button></div></form></div>'
        : msgHTML() + '<p>' + (one ? 'Your nomination has been recorded. Thank you!' : 'You have used all your nominations. Thank you!') + '</p><button class="btn secondary" data-act="logout">Log out</button>') +
      '<p class="small muted">Only First Year members can be nominated. You may nominate yourself or another First Year member. You nominate the person only, not a position. A person nominated by several members appears only once on the list. The Election Committee will evaluate all nominees.</p></section>';
  }
  function nomOptionsHTML(q) {
    q = q.trim().toLowerCase();
    var done = (S.me.myNominations || []);
    var list = S.options.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) >= 0; });
    if (!list.length) return '<p class="muted small" style="padding:10px">No First Year member matches "' + esc(q) + '".</p>';
    return list.map(function (o) {
      var already = done.indexOf(o.name) >= 0;
      return '<label style="display:flex;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line);cursor:' + (already ? 'default' : 'pointer') + '"><input type="radio" name="nominee" value="' + esc(o.id) + '"' + (already ? ' disabled' : '') + '> <span>' + esc(o.name) + (already ? ' <span class="pill good">Nominated</span>' : '') + '</span></label>';
    }).join('');
  }

  // ----- ballot -----
  function ballotHTML(nominees, choices, ctx) {
    return S.status.positions.map(function (pos) {
      var mine = choices[pos.key] || [], used = {};
      Object.keys(choices).forEach(function (k) { if (k !== pos.key) (choices[k] || []).forEach(function (id) { used[id] = k; }); });
      var visible = nominees.filter(function (n) { return !used[n.id]; });
      var hidden = nominees.length - visible.length;
      return '<div class="position" id="pos-' + pos.key + '"><header><h3>' + esc(pos.title) + '</h3><span class="small muted">Vote for ' + (pos.seats === 1 ? 'one (1)' : 'up to two (2)') + ' · ' + mine.length + ' selected</span></header>' +
        '<div class="choices">' + (visible.length ? visible.map(function (n) {
          var on = mine.indexOf(n.id) >= 0;
          return '<button type="button" class="choice' + (pos.seats > 1 ? ' multi' : '') + '" aria-pressed="' + on + '" data-act="pick" data-ctx="' + ctx + '" data-pos="' + pos.key + '" data-id="' + esc(n.id) + '"><span class="box"></span><span>' + esc(n.name) + '</span></button>';
        }).join('') : '<p class="muted small" style="margin:0">All nominees are already chosen for other positions on your ballot.</p>') + '</div>' +
        (hidden ? '<div class="hiddennote">' + hidden + ' nominee' + (hidden > 1 ? 's are' : ' is') + ' hidden because already chosen for another position.</div>' : '') + '</div>';
    }).join('');
  }
  function countPicks(ch) { return Object.keys(ch).reduce(function (a, k) { return a + (ch[k] || []).length; }, 0); }
  function ballotHeadHTML(sub) {
    return '<div class="ballot-head"><img src="' + LOGO + '" alt="Doctoral Council logo"><div><div class="t">OFFICIAL BALLOT</div><div><b>' + esc(S.status.title) + '</b></div><div class="small muted">Doctoral Council · National Teachers College' + (sub ? ' · ' + sub : '') + '</div></div></div>';
  }
  function ballotPageHTML() {
    var total = S.status.positions.reduce(function (a, p) { return a + p.seats; }, 0);
    return '<section class="block wrap">' + ballotHeadHTML('Voter: ' + esc(S.me.name)) +
      '<div class="msg info">Choose one nominee for each position (two for Public Relations Officer). Once you choose a nominee, he or she disappears from the other positions. You may leave a position blank. Nothing is recorded until you press <b>Cast my ballot</b> on the next screen.</div>' +
      msgHTML() + ballotHTML(S.status.nominees, S.ballot, 'vote') + '</section>' +
      '<div class="stickybar"><div class="wrap"><span class="num"><b>' + countPicks(S.ballot) + '</b> of ' + total + ' selections</span><div class="row"><button class="btn ghost" data-act="logout">Cancel</button><button class="btn" data-act="review">Review my ballot</button></div></div></div>';
  }
  function reviewHTML() {
    var byId = {}; S.status.nominees.forEach(function (n) { byId[n.id] = n.name; });
    var blanks = 0;
    var rows = S.status.positions.map(function (p) {
      var c = (S.ballot[p.key] || []).map(function (id) { return byId[id]; });
      if (c.length < p.seats) blanks++;
      return '<tr><td>' + esc(p.title) + '</td><td>' + (c.length ? c.map(esc).join('<br>') : '<span class="pill warn">No vote</span>') + (p.seats > 1 && c.length === 1 ? '<br><span class="muted small">(1 of 2)</span>' : '') + '</td></tr>';
    }).join('');
    return '<section class="block wrap">' + ballotHeadHTML('Review') + '<h2>Review your ballot</h2>' +
      (blanks ? '<div class="msg info">Some positions have no vote. That is allowed, but you cannot change your ballot after casting it.</div>' : '') +
      '<div class="panel tablewrap"><table><thead><tr><th>Position</th><th>Your choice</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + msgHTML() +
      '<div class="row"><button class="btn secondary" data-act="edit-ballot">Change my choices</button><button class="btn big" data-act="cast"' + (S.busy ? ' disabled' : '') + '>Cast my ballot</button></div>' +
      '<p class="small muted">Your ballot is secret. It is stored without your name or student number; the system only marks that you have voted.</p></section>';
  }
  function doneHTML() {
    return '<section class="block wrap"><div class="panel" style="text-align:center;display:grid;gap:10px;justify-items:center">' +
      '<img src="' + LOGO + '" alt="" style="width:84px"><div class="pill good">Ballot recorded</div><h1 style="color:var(--navy)">Thank you for voting!</h1>' +
      '<p style="margin:0">Your ballot was received on ' + both(S.doneAt) + '.</p><p class="small muted" style="margin:0;max-width:52ch">Your choices are stored without your identity. You have been logged out. Results will be posted on this site after the Election Committee completes the canvass.</p>' +
      '<button class="btn secondary" data-act="home">Back to home</button></div></section>';
  }

  // ----- results -----
  function resultsHTML(r) {
    var elected = [];
    r.positions.forEach(function (p) {
      p.winners.forEach(function (w) { elected.push([p.title, w]); });
      var tied = r.ties.some(function (t) { return String(t).indexOf(p.title) === 0; });
      for (var k = p.winners.length; k < (p.seats || 1); k++) elected.push([p.title, tied ? 'Tie, for resolution' : 'No one elected', true]);
    });
    var vacant = elected.filter(function (e) { return e[1] === 'No one elected'; }).length;
    var html = '<section class="block wrap"><div class="dash">' +
      '<div class="tile"><span class="label">Ballots cast</span><span class="big">' + r.totalBallots + '</span></div>' +
      '<div class="tile"><span class="label">Registered members</span><span class="big">' + r.registered + '</span></div>' +
      '<div class="tile"><span class="label">Turnout</span><span class="big">' + r.turnoutPct + '%</span></div></div>' +
      '<p class="small muted">Generated ' + both(r.generatedAt) + (r.sealCode ? ' · Seal <span class="mono">' + esc(r.sealCode) + '</span>' : '') + '</p>' +
      (r.ties.length ? '<div class="msg err">Tie in: ' + esc(r.ties.join(', ')) + '. To be resolved by the Election Committee. Positions after a tie are provisional.</div>' : '') +
      '<h2>Elected officers</h2><div class="panel"><div class="winners">' + elected.map(function (e) { return '<div><span class="muted">' + esc(e[0]) + '</span>' + (e[2] ? '<i class="muted">' + esc(e[1]) + '</i>' : '<b>' + esc(e[1]) + '</b>') + '</div>'; }).join('') + '</div>' + (vacant ? '<p class="small muted" style="margin:10px 0 0">No one elected: every remaining nominee for that position was already elected to a higher position or received no votes. The Election Committee decides how to fill it.</p>' : '') + '</div>' +
      '<h2>Votes by position</h2>';
    r.positions.forEach(function (p) {
      var top = Math.max.apply(null, p.candidates.map(function (c) { return c.votes; }).concat([1]));
      html += '<div class="position"><header><h3>' + esc(p.title) + '</h3><span class="small muted">' + (p.seats > 1 ? p.seats + ' seats · ' : '') + p.abstained + (p.abstained === 1 ? ' ballot' : ' ballots') + ' with no vote' + (p.provisional ? ' · <b>provisional</b>' : '') + '</span></header>' +
        p.candidates.map(function (c, i) {
          var badge = c.status === 'ELECTED' ? '<span class="pill good">✓ Elected</span>' : c.status === 'TIED' ? '<span class="pill warn">Tie</span>' : c.status === 'ELECTED_HIGHER' ? '<span class="pill">' + esc(c.note) + '</span>' : '';
          return '<div class="cand' + (c.status === 'ELECTED' ? ' elected' : '') + '"><div><b>' + esc(c.name) + '</b> ' + badge + (c.status === 'ELECTED' && c.note ? '<div class="small muted">' + esc(c.note) + '</div>' : '') + '</div>' +
            '<div class="bar" title="' + c.votes + ' votes"><i style="width:' + (c.votes / top * 100) + '%"></i></div><div class="num" style="text-align:right"><b>' + c.votes + '</b></div><div class="num muted small" style="text-align:right">' + c.pct.toFixed(2) + '%</div></div>';
        }).join('') + '</div>';
    });
    return html + '<p class="small muted">Percentage = votes ÷ total ballots cast. A nominee elected to a higher position is skipped in lower positions, and the next highest is elected.</p></section>';
  }

  function offLoginHTML() {
    var o = S.offStart, h = '<div class="panel" style="max-width:460px">';
    if (!o) {
      h += '<form id="fOffStart" class="form"><h3>Log in</h3><div class="field"><label for="oemail">NTC email</label><input id="oemail" type="email" required autocomplete="username" placeholder="name@ntc.edu.ph"></div>' +
        '<button class="btn" type="submit">Continue</button><p class="small muted" style="margin:0">For the Election Committee (Chairman, Poll Clerk, Member) and Observers only.</p></form>';
    } else if (o.hasPin) {
      h += '<form id="fOff" class="form"><h3>Welcome, ' + esc(o.name) + '</h3><p class="small muted" style="margin:0">' + esc(o.email) + ' · ' + esc(ROLE[o.role] || o.role) + '</p>' +
        '<div class="field"><label for="opin">Your 6-digit PIN</label><input id="opin" class="pin" type="password" inputmode="numeric" maxlength="6" required autocomplete="current-password" autofocus></div>' +
        '<button class="btn" type="submit">Log in</button><p class="small muted" style="margin:0">Forgot your PIN? Ask ALI or the Chairman to reset it from the Google Sheet. Then log in again and create a new one.</p>' +
        '<button class="btn secondary" type="button" data-act="offBack">Use a different email</button></form>';
    } else {
      h += '<form id="fNewPin" class="form"><h3>Create your PIN</h3><p class="small muted" style="margin:0">' + esc(o.name) + ' · ' + esc(o.email) + ' · ' + esc(ROLE[o.role] || o.role) + '</p>' +
        '<p class="small" style="margin:0">This is your first login. Choose a 6-digit PIN that only you know. You will use it to log in and to approve election actions.</p>' +
        '<div class="field"><label for="np1">New 6-digit PIN</label><input id="np1" class="pin" type="password" inputmode="numeric" maxlength="6" required autocomplete="new-password" autofocus></div>' +
        '<div class="field"><label for="np2">Confirm PIN</label><input id="np2" class="pin" type="password" inputmode="numeric" maxlength="6" required autocomplete="new-password"></div>' +
        '<button class="btn" type="submit">Save PIN and log in</button>' +
        '<button class="btn secondary" type="button" data-act="offBack">Use a different email</button></form>';
    }
    return '<div class="dash">' + h + '</div></div></section>';
  }

  function offLoggedIn(r, keepMsg) {
    S.official = { token: r.token, role: r.role, name: r.name }; if (!keepMsg) S.msg = null; S.offTab = 'dashboard'; S.offStart = null;
    try { sessionStorage.setItem('officialSession', JSON.stringify(S.official)); } catch (e) { }
    loadDash().then(render);
  }

  // ----- officials -----
  function officialsHTML() {
    if (!S.official) {
      return '<section class="block wrap"><div class="formhead"><img src="' + LOGO + '" alt=""><div><div class="eyebrow">Restricted</div><h1 style="color:var(--navy);font-size:28px">Election Committee & Observers</h1></div></div>' + msgHTML() +
        offLoginHTML();
    }
    var tabs = [['dashboard', 'Live dashboard'], ['controls', 'Election controls'], ['demo', 'Test election'], ['reports', 'Reports'], ['nominees', 'Nominees'], ['log', 'Audit log']]
      .filter(function (t) { return isCommittee() || t[0] !== 'controls'; });
    var body = '';
    if (S.offTab === 'dashboard') body = dashHTML();
    if (S.offTab === 'controls') body = controlsHTML();
    if (S.offTab === 'demo') body = demoBallotHTML();
    if (S.offTab === 'reports') body = reportsHTML();
    if (S.offTab === 'nominees') body = adminNomineesHTML();
    if (S.offTab === 'log') body = logHTML();
    return '<section class="block wrap"><div class="row" style="justify-content:space-between"><div><div class="eyebrow">' + esc(ROLE[S.official.role] || S.official.role) + (isCommittee() ? ' · Election Committee' : ' · view only') + '</div><h2 style="color:var(--navy)">' + esc(S.official.name) + '</h2></div><button class="btn ghost" data-act="off-logout">Log out</button></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button role="tab" aria-selected="' + (S.offTab === t[0]) + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' + msgHTML() + body + '</section>';
  }

  function stateLabel(d) {
    var st = d.state;
    if (st.resultsPublished) return ['Results published', 'good'];
    if (st.votingClosed || d.phase === 'CLOSED') return ['Closed', 'warn'];
    if (st.votingOpened) return [d.phase === 'VOTING' ? 'Open' : 'Opened · starts ' + fmt(d.schedule.VOTING_START, PH, { year: undefined, month: undefined, day: undefined }), 'good'];
    if (st.sealed) return ['Sealed', ''];
    return ['Not yet sealed', 'warn'];
  }
  function sealPill(seal) {
    if (!seal.sealed) return '<span class="pill warn">Not sealed</span>';
    return seal.intact ? '<span class="pill good">✓ Seal intact · <span class="mono">' + esc(seal.code) + '</span></span>' : '<span class="pill bad">✕ SEAL BROKEN — changed: ' + esc(seal.broken.join(', ')) + '</span>';
  }
  function gaugeSVG(pct, voted, reg) {
    var r = 70, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, pct)) / 100;
    return '<svg viewBox="0 0 180 180" role="img" aria-label="Turnout ' + pct + ' percent"><circle cx="90" cy="90" r="' + r + '" fill="none" stroke="var(--sky)" stroke-width="16"/>' +
      '<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="var(--blue)" stroke-width="16" stroke-linecap="round" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 90 90)"/>' +
      '<text x="90" y="90" text-anchor="middle" font-size="30" font-weight="700" fill="var(--navy)" font-family="Archivo, Arial">' + pct + '%</text>' +
      '<text x="90" y="114" text-anchor="middle" font-size="12" fill="var(--muted)">' + voted + ' of ' + reg + ' voted</text></svg>';
  }
  function hourKeys(d) {
    var a = new Date(d.schedule.VOTING_START).getTime(), b = new Date(d.schedule.VOTING_END).getTime(), out = [];
    for (var t = a - (a % 3600000); t < b; t += 3600000) { var m = new Date(t + 8 * 3600000).toISOString(); out.push({ key: m.slice(0, 10) + ' ' + m.slice(11, 13) + ':00', t: t, h: parseInt(m.slice(11, 13), 10) }); }
    return out;
  }
  function hourChartSVG(d) {
    var keys = hourKeys(d), data = d.turnout.perHour, W = 660, H = 190, L = 34, B = 30, T = 12;
    var max = Math.max(1, Math.max.apply(null, keys.map(function (k) { return data[k.key] || 0; })));
    var step = max <= 5 ? 1 : Math.ceil(max / 4 / 5) * 5; var top = Math.ceil(max / step) * step;
    var bw = (W - L - 6) / keys.length, y = function (v) { return T + (H - T - B) * (1 - v / top); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Votes cast per hour">';
    for (var v = 0; v <= top; v += step) s += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + '</text>';
    keys.forEach(function (k, i) {
      var val = data[k.key] || 0, x = L + i * bw + 1, hgt = H - B - y(val);
      var label = fmt(new Date(k.t).toISOString(), PH, { year: undefined }) + ' · ' + val + ' vote' + (val === 1 ? '' : 's');
      s += '<g><title>' + esc(label) + '</title><rect x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="transparent"/>';
      if (val) s += '<path d="M' + x + ' ' + (H - B) + 'V' + (H - B - hgt + 4) + 'q0 -4 4 -4h' + Math.max(0, bw - 10) + 'q4 0 4 4V' + (H - B) + 'Z" fill="var(--blue)"/>';
      s += '</g>';
      if (k.h % 3 === 0 || i === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + (k.h === 0 ? '12AM' : k.h < 12 ? k.h + 'AM' : k.h === 12 ? '12PM' : (k.h - 12) + 'PM') + '</text>';
      if (k.h === 0 || i === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-weight="600">' + esc(dateOnly(new Date(k.t).toISOString())) + '</text>';
    });
    return s + '<line x1="' + L + '" x2="' + W + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-width="1"/></svg>';
  }
  function dashHTML() {
    var d = S.dash;
    if (!d) return '<p class="muted">Loading the dashboard…</p>';
    var lab = stateLabel(d), tt = d.turnout, sc = d.schedule, n = now().getTime();
    var cd = n < new Date(sc.VOTING_START).getTime() ? ['Voting opens in', sc.VOTING_START] : (n < new Date(sc.VOTING_END).getTime() && !d.state.votingClosed ? ['Time remaining', sc.VOTING_END] : null);
    var match = d.ballotsInBox === tt.voted;
    var years = Object.keys(tt.byYear).sort();
    var nm = d.nominations, early = ['UPCOMING', 'NOMINATION', 'EVALUATION', 'NOMINEES'].indexOf(d.phase) >= 0;
    var nomPanel = '<div class="panel" style="margin-top:12px;display:grid;gap:12px"><h3 style="font-size:16px">Nomination Monitoring</h3><div class="dash">' +
      '<div class="tile"><span class="label">Members who nominated</span><span class="big">' + nm.nominators.toLocaleString() + '</span><span class="small muted">of ' + tt.registered.toLocaleString() + ' members (' + (tt.registered ? Math.round(nm.nominators * 1000 / tt.registered) / 10 : 0) + '%)</span></div>' +
      '<div class="tile"><span class="label">Nominations received</span><span class="big">' + nm.total.toLocaleString() + '</span></div>' +
      '<div class="tile"><span class="label">Total nominees</span><span class="big">' + nm.nominees + '</span><span class="small muted">Approved by the Committee: ' + nm.approved + '</span></div></div>' +
      '<h3 style="font-size:16px">Nominees by source</h3><div class="dash">' +
      '<div class="tile"><span class="label">Auto-nominees (from registration)</span><span class="big">' + nm.auto + '</span><span class="small muted">First Year members who said YES</span></div>' +
      '<div class="tile"><span class="label">Nominated by members</span><span class="big">' + nm.nominatedOnly + '</span><span class="small muted">New nominees from the nomination form</span></div>' +
      '<div class="tile"><span class="label">Auto-nominees also nominated by members</span><span class="big">' + nm.autoAlsoNominated + '</span><span class="small muted">of ' + nm.auto + ' auto-nominees</span></div></div>' +
      '<p class="small muted" style="margin:0">Counts only. Who nominated whom is not shown. See the Nominees tab for each name.</p></div>';
    return '<div class="row" style="margin-top:14px"><span class="pill ' + lab[1] + '">Status: ' + esc(lab[0]) + '</span>' + sealPill(d.seal) +
      '<span class="pill ' + (match ? 'good' : 'bad') + '">' + (match ? '✓ Ballots in box match voters marked (' + d.ballotsInBox + ')' : '✕ Ballot count mismatch: ' + d.ballotsInBox + ' ballots vs ' + tt.voted + ' voters') + '</span>' +
      '<span class="small muted">Updated ' + esc(fmt(d.now, PH, { second: '2-digit', year: undefined })) + ' PHT · refreshes every 30 seconds</span></div>' +
      (early ? nomPanel : '') +
      '<div class="dash" style="margin-top:12px">' +
      '<div class="tile"><span class="label">Turnout</span><div class="gauge">' + gaugeSVG(tt.pct, tt.voted, tt.registered) + '</div></div>' +
      '<div class="tile"><span class="label">Registered voters</span><span class="big">' + tt.registered.toLocaleString() + '</span><span class="label" style="margin-top:12px">Votes cast</span><span class="big">' + tt.voted.toLocaleString() + '</span></div>' +
      '<div class="tile"><span class="label">' + (cd ? cd[0] : 'Voting period') + '</span>' + (cd ? '<span class="big" data-countdown="' + esc(cd[1]) + '">–</span><span class="small muted">' + (cd[0] === 'Time remaining' ? 'Closes ' : 'Opens ') + both(cd[1]) + '</span>' : '<span class="big" style="font-size:24px">' + (d.state.votingClosed || n >= new Date(sc.VOTING_END).getTime() ? 'Ended' : '—') + '</span>') +
      '<span class="small muted">Opened: ' + (d.state.openedAt ? esc(ph(d.state.openedAt)) : '—') + '<br>Closed: ' + (d.state.closedAt ? esc(ph(d.state.closedAt)) : '—') + '</span></div></div>' +
      '<div class="panel chart" style="margin-top:12px"><h3 style="font-size:16px;margin-bottom:8px">Votes cast per hour (PHT)</h3>' + hourChartSVG(d) + '</div>' +
      '<div class="panel tablewrap" style="margin-top:12px"><h3 style="font-size:16px">Turnout by year level</h3><table><thead><tr><th>Year level</th><th class="r">Registered</th><th class="r">Voted</th><th class="r">Turnout</th></tr></thead><tbody>' +
      years.map(function (y) { var x = tt.byYear[y]; return '<tr><td>' + esc(y) + '</td><td class="r num">' + x.registered + '</td><td class="r num">' + x.voted + '</td><td class="r num">' + (x.registered ? Math.round(x.voted * 1000 / x.registered) / 10 : 0) + '%</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<p class="small muted">No candidate vote counts are shown while voting is open.</p>' + (early ? '' : nomPanel);
  }

  function controlsHTML() {
    var d = S.dash; if (!d) return '<p class="muted">Loading…</p>';
    var st = d.state, sc = d.schedule, n = now().getTime();
    var vs = new Date(sc.VOTING_START).getTime(), ve = new Date(sc.VOTING_END).getTime(), win = (d.openWindowHours || 0) * 3600000;
    var ft = st.fts || {}, ftsOk = !st.sealed && !st.votingOpened && n >= new Date(sc.NOMINEES_PUBLISH).getTime() && n < vs;
    var ftWhy = st.sealed ? 'Testing finished: the election is sealed.' : 'Available after nominees are posted (' + dateOnly(sc.NOMINEES_PUBLISH) + ') and before voting.';
    var steps = [
      { act: 'TEST_OPEN', title: 'Final Testing: open test voting', when: dateOnly(sc.FTS_DATE), done: !!(ft.openedAt), desc: ft.openedAt ? 'Opened ' + ph(ft.openedAt) + '.' : 'Opens a separate TEST ballot box. The real ballot box stays at zero.', btn: 'Open test voting', can: ftsOk && !ft.open && !ft.openedAt, why: ftWhy },
      { act: '', title: 'Final Testing: each official casts one test ballot', when: dateOnly(sc.FTS_DATE), done: !!(ft.closedAt || ft.done), desc: (ft.votedCount || 0) + ' of ' + st.officialsCount + ' test ballots cast (Chairman, Poll Clerk, Member, Program Head, OSA, ALI). Use the Test election tab.', btn: 'Go to Test election', can: !!ft.open, why: 'Available while test voting is open.', tab: 'demo' },
      { act: 'TEST_CLOSE', title: 'Final Testing: close test voting and check results', when: dateOnly(sc.FTS_DATE), done: !!(ft.closedAt), desc: ft.closedAt ? 'Closed ' + ph(ft.closedAt) + ' with ' + ft.count + ' test ballots. Compare the test results with what the officials voted.' : 'Shows the test results so the Committee can check that every vote was counted correctly.', btn: 'Close test voting', can: !!ft.open, why: 'Available while test voting is open.' },
      { act: 'REZERO', title: 'Re-zero', when: dateOnly(sc.FTS_DATE), done: !!ft.rezeroedAt, desc: ft.rezeroedAt ? 'Done ' + ph(ft.rezeroedAt) + '. All test ballots deleted; all counts are zero.' : 'Deletes all test ballots and prints the Zero Report.', btn: 'Re-zero', can: !!ft.closed && !ft.rezeroedAt, why: 'Close the test voting first.' },
      { act: 'SEAL', title: 'Seal the election', when: dateOnly(sc.FTS_DATE), done: st.sealed,
        desc: st.sealed ? 'Sealed ' + ph(d.seal.at) + ' by ' + (d.seal.by || []).join(' & ') + '. Seal code ' + d.seal.code + '.' : 'The seal fingerprints the members list, approved nominees, schedule and website version.',
        btn: st.sealed ? 'Re-seal' : 'Seal the election', can: !st.votingOpened && !!ft.rezeroedAt && n >= new Date(sc.NOMINEES_PUBLISH).getTime() && n < vs, why: st.votingOpened ? 'Voting already opened.' : 'Finish the test election and re-zero first.' },
      { act: 'OPEN', title: 'Verify seal and open voting', when: fmt(sc.VOTING_START, PH, { year: undefined }), done: st.votingOpened,
        desc: st.votingOpened ? 'Opened ' + ph(st.openedAt) + '.' : 'The system checks that the seal is intact and the ballot box is empty, then opens voting and regenerates the Initialization Report.',
        btn: 'Open voting', can: st.sealed && !st.votingOpened && n >= vs - win && n < ve, why: !st.sealed ? 'Seal the election first.' : 'Available from ' + ph(new Date(vs - win).toISOString()) + '.' },
      { act: 'CLOSE', title: 'Close voting', when: fmt(sc.VOTING_END, PH, { year: undefined }), done: st.votingClosed,
        desc: st.votingClosed ? 'Closed ' + ph(st.closedAt) + '.' : 'Ballots stop being accepted automatically at the closing time. This step formally closes the polls.',
        btn: 'Close voting', can: st.votingOpened && !st.votingClosed && n >= ve, why: 'Available at ' + ph(sc.VOTING_END) + '.' },
      { act: 'RESULTS', title: 'Generate results', when: 'After closing', done: st.resultsPublished,
        desc: st.resultsPublished ? 'Published ' + ph(st.resultsAt) + '. To settle a tie, enter the winner in the TieBreaks tab of the Sheet, then regenerate.' : 'Counts all ballots from President down and publishes the results on the public site at the same time for everyone.',
        btn: st.resultsPublished ? 'Regenerate results' : 'Generate results', can: st.votingClosed, why: 'Close the voting first.' }
    ];
    var two = d.twoPinActions || [];
    return '<p class="small muted" style="margin-top:14px">Actions marked "2 PINs" need the Chairman plus the Poll Clerk or the Member. The others need the Chairman PIN only. Every action is written to the audit log.</p><div class="steps">' + steps.map(function (s, i) {
      return '<div class="step' + (s.done ? ' done' : '') + '"><span class="n">' + (s.done ? '✓' : i + 1) + '</span><div style="min-width:0"><b>' + esc(s.title) + '</b> <span class="muted small">· ' + esc(s.when) + (s.act ? ' · ' + (two.indexOf(s.act) >= 0 ? '2 PINs' : 'Chairman PIN') : '') + '</span><div class="small">' + esc(s.desc) + '</div>' + (!s.can && !s.done ? '<div class="small muted">' + esc(s.why) + '</div>' : '') + '</div>' +
        (s.tab ? '<button class="btn secondary" data-act="tab" data-tab="' + s.tab + '"' + (s.can ? '' : ' disabled') + '>' + esc(s.btn) + '</button>' :
        '<button class="btn' + (s.done ? ' secondary' : '') + '" data-act="ask-pins" data-a="' + s.act + '"' + (s.can && !(s.done && s.act.indexOf('TEST') === 0) ? '' : ' disabled') + '>' + esc(s.btn) + '</button>') + '</div>';
    }).join('') + '</div>';
  }

  function modalHTML() {
    var m = S.modal;
    return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="panel"><form id="fPins" class="form" style="max-width:none">' +
      '<div class="formhead"><img src="' + LOGO + '" alt=""><div><div class="eyebrow">' + (m.two ? 'Two PINs required' : 'Chairman PIN required') + '</div><h3 id="mt">' + esc(m.title) + '</h3></div></div>' +
      '<p class="small" style="margin:0">' + esc(m.note) + '</p>' +
      '<div class="field"><label for="pChair">Chairman PIN</label><input id="pChair" class="pin" type="password" inputmode="numeric" maxlength="6" required autocomplete="off"></div>' +
      (m.two ? '<div class="field"><label for="pRole">Second signatory</label><select id="pRole"><option value="POLL_CLERK">Poll Clerk</option><option value="MEMBER">Member</option></select></div>' +
      '<div class="field"><label for="pSecond">PIN of second signatory</label><input id="pSecond" class="pin" type="password" inputmode="numeric" maxlength="6" required autocomplete="off"></div>' : '') +
      (m.err ? '<div class="msg err">' + esc(m.err) + '</div>' : '') +
      '<div class="row"><button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Working…' : 'Confirm') + '</button><button class="btn ghost" type="button" data-act="close-modal">Cancel</button></div></form></div></div>';
  }

  function demoBallotHTML() {
    var d = S.dash; if (!d || !S.demoNominees) return '<p class="muted">Loading…</p>';
    var st = d.state, ft = st.fts || {};
    var head = '<div style="display:grid;gap:12px;margin-top:14px">' + ballotHeadHTML('TEST BALLOT · Final Testing and Sealing');
    if (st.sealed) return head + '<div class="msg ok">Final Testing is finished and the election is sealed. Test ballots were deleted at re-zero.</div></div>';
    if (ft.open) {
      var cnt = '<div class="msg info">Test voting is OPEN. ' + (ft.votedCount || 0) + ' of ' + st.officialsCount + ' officials have cast their test ballot. Test ballots go to a separate TEST box; the real ballot box stays at zero.</div>';
      if (st.iVotedTest) return head + cnt + '<div class="msg ok">You already cast your test ballot. Thank you.</div></div>';
      return head + cnt + ballotHTML(S.demoNominees, S.demoBallot, 'demo') +
        '<div class="row"><button class="btn" data-act="test-cast">Cast my test ballot</button><button class="btn ghost" data-act="demo-clear">Clear</button></div></div>';
    }
    if (ft.closed) return head + '<div class="msg info">Test voting is closed (' + ft.count + ' test ballots). Check the results below, then the Chairman does the Re-zero in Election controls.</div>' + (S.ftsReport ? '<div style="overflow-x:auto">' + reportBody(S.ftsReport) + '</div>' : '') + '</div>';
    if (ft.rezeroedAt) return head + '<div class="msg ok">Re-zero done ' + esc(ph(ft.rezeroedAt)) + '. Next: Seal the election.</div></div>';
    return head + '<div class="msg info">Waiting for the Chairman to open test voting (Election controls). Then each of the ' + st.officialsCount + ' officials logs in here and casts one test ballot.</div>' +
      ballotHTML(S.demoNominees, S.demoBallot, 'demo') + '<div class="row"><button class="btn secondary" data-act="demo-test">Check this ballot (not saved)</button></div></div>';
  }

  function reportsHTML() {
    var canv = S.dash && S.dash.state.resultsPublished;
    return '<div class="row" style="margin-top:14px"><button class="btn secondary" data-act="report" data-kind="init">Initialization Report</button>' +
      '<button class="btn secondary" data-act="report" data-kind="fts"' + (S.dash && S.dash.state.fts && S.dash.state.fts.closedAt ? '' : ' disabled title="Available after test voting is closed"') + '>Test Election Results</button>' +
      '<button class="btn secondary" data-act="report" data-kind="canvass"' + (canv ? '' : ' disabled title="Available after results are generated"') + '>Certificate of Canvass</button></div>' +
      (S.report ? '<div class="row" style="margin-top:12px"><button class="btn" data-act="print">Print / Save as PDF</button>' + (DEMO ? '<span class="small muted">Printing works on the real site. Some preview windows block it.</span>' : '') + '</div><div id="reportView" style="margin-top:12px;overflow-x:auto">' + reportBody(S.report) + '</div>' : '<p class="muted small">Choose a report to view and print. The Initialization Report shows zero votes for every nominee before voting starts.</p>');
  }

  function adminNomineesHTML() {
    var list = S.adminNominees; if (!list) return '<p class="muted">Loading…</p>';
    return '<p class="small muted" style="margin-top:14px">' + (DEMO ? 'DEMO: tick the boxes here to simulate the Committee ticking "Approved" in the Nominees tab of the Google Sheet.' : 'To approve a nominee, tick the "Approved" box in the Nominees tab of the Google Sheet. Changes after sealing will break the seal.') + '</p>' +
      '<div class="panel tablewrap"><table><thead><tr><th>Nominee</th><th>Year level</th><th>Source</th><th class="r">Nominations</th><th>Approved</th><th>Remarks</th></tr></thead><tbody>' +
      list.map(function (n, i) { return '<tr><td>' + esc(n.name) + '</td><td>' + esc(n.yearLevel) + '</td><td><span class="pill' + (n.source === 'Nominated by members' ? '' : ' good') + '">' + esc(n.source) + '</span></td><td class="r num">' + n.count + '</td><td>' + (DEMO ? '<input type="checkbox" data-act="demo-approve" data-i="' + i + '"' + (n.approved ? ' checked' : '') + ' aria-label="Approve ' + esc(n.name) + '">' : (n.approved ? '<span class="pill good">✓ Approved</span>' : '<span class="muted">—</span>')) + '</td><td>' + esc(n.remarks) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function logHTML() {
    var l = S.log; if (!l) return '<p class="muted">Loading…</p>';
    return '<div class="panel tablewrap" style="margin-top:14px"><table><thead><tr><th>Time (PHT)</th><th>Event</th><th>By</th><th>Details</th></tr></thead><tbody>' +
      l.slice().reverse().map(function (x) { return '<tr><td class="num small" style="white-space:nowrap">' + esc(x.ts) + '</td><td><b class="small">' + esc(x.event) + '</b></td><td class="small">' + esc(x.actor) + '</td><td class="small">' + esc(x.details) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  // ----- printable reports -----
  function reportHead(title, r) {
    return '<div class="rhead"><img src="' + LOGO + '" alt="Doctoral Council logo"><b style="letter-spacing:.12em">DOCTORAL COUNCIL</b><span>National Teachers College · Doctor of Education</span><span>Election Committee</span>' +
      '<h1>' + esc(title) + '</h1><b>' + esc(r.title) + '</b><span>Generated ' + esc(ph(r.generatedAt, { second: '2-digit' })) + '</span></div>';
  }
  function sealBox(seal) {
    if (!seal || !seal.sealed) return '<div class="sealbox"><b>SEAL:</b> Not yet sealed.</div>';
    return '<div class="sealbox"><div><b>SEAL CODE:</b> <span class="mono" style="font-size:16px">' + esc(seal.code) + '</span> &nbsp; <b>Status:</b> ' + (seal.intact ? 'INTACT' : 'BROKEN (' + esc(seal.broken.join(', ')) + ')') + '</div>' +
      '<div class="small"><b>Seal hash (SHA-256):</b> <span class="mono" style="word-break:break-all">' + esc(seal.hash) + '</span></div>' +
      '<div class="small"><b>Website GitHub commit:</b> <span class="mono">' + esc(seal.commit || 'not recorded') + '</span></div>' +
      '<div class="small"><b>Sealed:</b> ' + esc(ph(seal.at)) + ' by ' + esc((seal.by || []).join(' and ')) + '</div></div>';
  }
  function sigs(c) {
    c = c || {};
    return '<div class="sig">' + ['CHAIRMAN', 'POLL_CLERK', 'MEMBER'].map(function (k) { return '<div><b>' + esc(c[k] || '') + '</b><br>' + ROLE[k] + ', Election Committee</div>'; }).join('') + '</div>';
  }
  function reportBody(r) {
    if (r.kind === 'init') {
      var total = 0;
      var body = r.positions.map(function (p) {
        return '<div class="pos"><h3>' + esc(p.title) + (p.seats > 1 ? ' (' + p.seats + ' seats)' : '') + '</h3><table><thead><tr><th>Nominee</th><th style="width:90px;text-align:right">Votes</th></tr></thead><tbody>' +
          p.candidates.map(function (c) { total += c.votes; return '<tr><td>' + esc(c.name) + '</td><td style="text-align:right">' + c.votes + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }).join('');
      return '<div class="report">' + reportHead(r.label || 'INITIALIZATION REPORT', r) +
        '<p>This certifies that, at the time stated above, the online election system of the Doctoral Council shows <b>' + r.ballotsInBox + ' ballot(s)</b> in the ballot box and <b>' + total + ' vote(s)</b> for every nominee in every position, with <b>' + r.registered + '</b> registered voters. Voting period: ' + esc(ph(r.schedule.VOTING_START)) + ' to ' + esc(ph(r.schedule.VOTING_END)) + '.</p>' +
        sealBox(r.seal) + body + sigs(r.committee) + '</div>';
    }
    if (r.kind === 'fts') {
      var f = r.fts || {};
      return '<div class="report">' + reportHead('FINAL TESTING: TEST ELECTION RESULTS', r) +
        '<p><b>TEST BALLOTS ONLY. NOT OFFICIAL.</b> Test voting opened ' + esc(f.openedAt ? ph(f.openedAt) : '—') + ' and closed ' + esc(f.closedAt ? ph(f.closedAt) : '—') + '. Test ballots in the TEST box: <b>' + r.results.totalBallots + '</b>. Real ballot box: <b>' + r.realBallots + '</b>.</p>' +
        r.results.positions.map(function (p) {
          return '<div class="pos"><h3>' + esc(p.title) + (p.seats > 1 ? ' (' + p.seats + ' seats)' : '') + '</h3><table><thead><tr><th>Nominee</th><th style="text-align:right">Test votes</th><th>Remarks</th></tr></thead><tbody>' +
            p.candidates.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td style="text-align:right">' + c.votes + '</td><td>' + (c.status === 'ELECTED' ? 'Leading' : c.status === 'TIED' ? 'Tie' : esc(c.note)) + '</td></tr>'; }).join('') +
            '<tr><td colspan="3" style="color:#555">Test ballots with no vote for this position: ' + p.abstained + '</td></tr></tbody></table></div>';
        }).join('') +
        '<p style="margin-top:16px">We certify that the test results above match the test ballots cast by the officials during Final Testing.</p>' + sigs(r.committee) + '</div>';
    }
    var res = r.results, st = r.state;
    var elected = [];
    res.positions.forEach(function (p) { p.winners.forEach(function (w) { elected.push('<tr><td>' + esc(p.title) + '</td><td><b>' + esc(w) + '</b></td></tr>'); }); });
    return '<div class="report">' + reportHead('CERTIFICATE OF CANVASS', r) +
      '<table><tbody><tr><th>Registered voters</th><td>' + res.registered + '</td><th>Ballots cast</th><td>' + res.totalBallots + '</td><th>Turnout</th><td>' + res.turnoutPct + '%</td></tr>' +
      '<tr><th>Voting opened</th><td colspan="2">' + esc(st.openedAt ? ph(st.openedAt) : '—') + '</td><th>Voting closed</th><td colspan="2">' + esc(st.closedAt ? ph(st.closedAt) : '—') + '</td></tr></tbody></table>' +
      sealBox(r.seal) +
      '<h3>Elected officers</h3><table><thead><tr><th>Position</th><th>Name</th></tr></thead><tbody>' + elected.join('') + '</tbody></table>' +
      (res.ties.length ? '<p><b>Tie, for resolution by the Election Committee:</b> ' + esc(res.ties.join(', ')) + '. Positions after a tie are provisional.</p>' : '') +
      res.positions.map(function (p) {
        return '<div class="pos"><h3>' + esc(p.title) + (p.seats > 1 ? ' (' + p.seats + ' seats)' : '') + '</h3><table><thead><tr><th>Nominee</th><th style="text-align:right">Votes</th><th style="text-align:right">%</th><th>Remarks</th></tr></thead><tbody>' +
          p.candidates.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td style="text-align:right">' + c.votes + '</td><td style="text-align:right">' + c.pct.toFixed(2) + '</td><td>' + (c.status === 'ELECTED' ? '<b>ELECTED</b>' + (c.note ? ' — ' + esc(c.note) : '') : c.status === 'TIED' ? 'TIE' : esc(c.note)) + '</td></tr>'; }).join('') +
          '<tr><td colspan="4" style="color:#555">Ballots with no vote for this position: ' + p.abstained + '</td></tr></tbody></table></div>';
      }).join('') +
      '<p style="margin-top:18px">We, the undersigned members of the Election Committee, certify that the foregoing is a true and correct canvass of the votes cast in the ' + esc(r.title) + ', counted from the highest position downward, where a nominee already elected to a higher position is skipped and the next highest is declared elected.</p>' +
      sigs(r.committee) +
      '<h3 style="margin-top:30px">Annex: Audit log</h3><table><thead><tr><th>Time (PHT)</th><th>Event</th><th>By</th><th>Details</th></tr></thead><tbody>' +
      r.log.filter(function (x) { return x.event !== 'BALLOT_CAST' && x.event !== 'MEMBER_LOGIN'; }).map(function (x) { return '<tr><td style="white-space:nowrap">' + esc(x.ts) + '</td><td>' + esc(x.event) + '</td><td>' + esc(x.actor) + '</td><td>' + esc(x.details) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="small">Member logins and individual "ballot received" entries are omitted from this annex; they remain in the AuditLog tab.</p></div>';
  }

  // ----- PIN setup -----
  function setupHTML() {
    var s = S.setup || {};
    return '<section class="block wrap"><div class="panel"><div class="form"><div class="formhead"><img src="' + LOGO + '" alt=""><div><div class="eyebrow">Election Committee & Observers</div><h2>Set your 6-digit PIN</h2></div></div>' +
      (s.done ? '<div class="msg ok">Your PIN is saved. Keep it private. You can now log in.</div><button class="btn" data-act="go-officials">Go to login</button>' :
        s.err ? '<div class="msg err">' + esc(s.err) + '</div><button class="btn secondary" data-act="go-officials">Request a new link</button>' :
          !s.name ? '<p class="muted">Checking your link…</p>' :
            '<p style="margin:0">Hello <b>' + esc(s.name) + '</b> (' + esc(ROLE[s.role] || s.role) + '). Choose a PIN only you know. Avoid birthdays and simple patterns like 123456.</p>' +
            '<form id="fSetPin" class="form"><div class="field"><label for="np1">New PIN</label><input id="np1" class="pin" type="password" inputmode="numeric" maxlength="6" pattern="\\d{6}" required autocomplete="new-password"></div>' +
            '<div class="field"><label for="np2">Type the PIN again</label><input id="np2" class="pin" type="password" inputmode="numeric" maxlength="6" pattern="\\d{6}" required autocomplete="new-password"></div>' + msgHTML() +
            '<button class="btn" type="submit">Save my PIN</button></form>') + '</div></div></section>';
  }

  // ---------------- clock & countdowns ----------------
  function tick() {
    if (!S.status) return;
    var n = now().toISOString();
    $('#clockPH').textContent = fmt(n, PH, { second: '2-digit', year: undefined }) + ' PHT';
    $('#clockLocal').textContent = SAME_TZ ? '' : 'Your time: ' + fmt(n, null, { year: undefined, timeZoneName: 'short' });
    var due = false;
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var ms = new Date(el.getAttribute('data-countdown')).getTime() - now().getTime();
      el.textContent = dur(ms);
      if (ms <= 0 && ms > -1500) due = true;
    });
    if (due) setTimeout(function () { loadStatus().then(render); }, 1600);
  }
  setInterval(tick, 1000);
  setInterval(function () { if (S.view === 'home') loadStatus().then(render); }, 60000);
  setInterval(function () { if (S.view === 'officials' && S.official && S.offTab === 'dashboard' && !S.modal && document.visibilityState !== 'hidden') loadDash().then(render); }, 30000);

  // ---------------- actions ----------------
  function go(view) { S.view = view; window.scrollTo(0, 0); render(); }
  function formMsg(f, type, text) { // show a message inside the form without clearing what the person picked
    var el = f.querySelector('.msg'); if (!el) { el = document.createElement('div'); f.querySelector('.row').before(el); }
    el.className = 'msg ' + type; el.setAttribute('role', 'alert'); el.textContent = text;
  }
  function busy(form, on) { var b = form && form.querySelector('button[type=submit]'); if (b) { b.disabled = on; } S.busy = on; }

  function afterVoterLogin(token) {
    S.voter = { token: token };
    return api('me', { token: token }).then(function (me) {
      if (!me.ok) { flash('err', me.error); return go('login'); }
      S.me = me; S.msg = null;
      if (S.status.phase === 'NOMINATION') {
        return api('nominationOptions', { token: token }).then(function (o) { if (!o.ok) { flash('err', o.error); return go('home'); } S.options = o.options; go('nominate'); });
      }
      S.ballot = {}; go('ballot');
    });
  }
  function loadDash() {
    return api('dashboard', { token: S.official.token }).then(function (d) { if (d.ok) S.dash = d; else offErr(d); });
  }
  function offErr(d) {
    if (/session|log in/i.test(d.error || '')) { S.official = null; try { sessionStorage.removeItem('officialSession'); } catch (e) { } }
    flash('err', d.error);
  }
  function loadTab() {
    var t = S.offTab, tok = S.official.token;
    if (t === 'dashboard' || t === 'controls' || t === 'reports') return loadDash();
    if (t === 'nominees') return api('nomineesAdmin', { token: tok }).then(function (r) { if (r.ok) S.adminNominees = r.nominees; else offErr(r); });
    if (t === 'log') return api('auditLog', { token: tok }).then(function (r) { if (r.ok) S.log = r.log; else offErr(r); });
    if (t === 'demo') return Promise.all([loadDash(), api('nomineesForDemo', { token: tok }).then(function (r) { if (r.ok) S.demoNominees = r.nominees; else offErr(r); })])
      .then(function () { var f = S.dash && S.dash.state.fts; if (f && f.closed) return api('report', { token: tok, kind: 'fts' }).then(function (x) { if (x.ok) S.ftsReport = x.report; }); });
    return Promise.resolve();
  }

  var SUBMIT = {
    fLogin: function (f) {
      busy(f, true);
      var sno = f.sno.value, email = f.email.value;
      api('login', { studentNo: sno, email: email }).then(function (r) {
        busy(f, false);
        if (!r.ok) { flash('err', r.error); return render(); }
        S.msg = null;
        if (r.otpRequired) { S.otp = { sno: sno, masked: r.maskedEmail }; return go('otp'); }
        afterVoterLogin(r.token);
      });
    },
    fOtp: function (f) {
      busy(f, true);
      api('verifyOtp', { studentNo: S.otp.sno, code: f.code.value }).then(function (r) {
        busy(f, false);
        if (!r.ok) { flash('err', r.error); return render(); }
        afterVoterLogin(r.token);
      });
    },
    fNominate: function (f) {
      var sel = f.querySelector('input[name=nominee]:checked');
      if (!sel) return formMsg(f, 'err', 'Please choose a First Year member from the list.');
      var conds = Array.prototype.map.call(f.querySelectorAll('input.cond'), function (x) { return x.checked; });
      if (conds.some(function (x) { return !x; })) return formMsg(f, 'err', 'Please check all ' + conds.length + ' conditions before submitting. Nominate only someone who meets all of them.');
      busy(f, true);
      api('nominate', { token: S.voter.token, nomineeId: sel.value, reason: f.reason.value, conditions: conds }).then(function (r) {
        busy(f, false);
        if (!r.ok) return formMsg(f, 'err', r.error);
        flash('ok', 'Nomination received: ' + r.nominee + '.');
        return api('me', { token: S.voter.token }).then(function (me) { if (me.ok) S.me = me; render(); });
      });
    },
    fOffStart: function (f) {
      busy(f, true);
      api('officialStart', { email: f.oemail.value }).then(function (r) {
        busy(f, false);
        if (!r.ok) { flash('err', r.error); return render(); }
        S.msg = null; S.offStart = { email: r.email, name: r.name, role: r.role, hasPin: r.hasPin }; render();
      });
    },
    fOff: function (f) {
      busy(f, true);
      api('officialLogin', { email: S.offStart.email, pin: f.opin.value }).then(function (r) {
        busy(f, false);
        if (!r.ok) { flash('err', r.error); return render(); }
        offLoggedIn(r);
      });
    },
    fNewPin: function (f) {
      if (f.np1.value !== f.np2.value) { flash('err', 'The two PINs do not match. Please type them again.'); return render(); }
      busy(f, true);
      api('createPin', { email: S.offStart.email, pin: f.np1.value, pin2: f.np2.value }).then(function (r) {
        busy(f, false);
        if (!r.ok) { flash('err', r.error); return render(); }
        flash('ok', 'Your PIN is saved. Remember it: you will need it for every login and to approve election actions.');
        offLoggedIn(r, true);
      });
    },
    fSetPin: function (f) {
      if (f.np1.value !== f.np2.value) { flash('err', 'The two PINs do not match.'); return render(); }
      busy(f, true);
      api('setPin', { setupToken: S.setup.token, pin: f.np1.value }).then(function (r) {
        busy(f, false);
        if (!r.ok) { flash('err', r.error); return render(); }
        S.msg = null; S.setup.done = true; render();
      });
    },
    fPins: function (f) {
      var m = S.modal, pins = { CHAIRMAN: f.pChair.value, SECOND_ROLE: f.pRole ? f.pRole.value : '', SECOND: f.pSecond ? f.pSecond.value : '' };
      S.busy = true; m.err = null; render();
      getCommit().then(function (commit) {
        return api('committeeAction', { token: S.official.token, act: m.act, pins: pins, commit: commit });
      }).then(function (r) {
        S.busy = false;
        if (!r.ok) { m.err = r.error; if (/session|log in/i.test(r.error)) { S.modal = null; offErr(r); } return render(); }
        S.modal = null; flash('ok', r.message);
        if (r.report) { S.report = r.report; S.offTab = 'reports'; }
        if (m.act === 'RESULTS') { S.offTab = 'reports'; }
        return Promise.all([loadStatus(), loadDash()]).then(function () {
          if (m.act === 'RESULTS') return api('report', { token: S.official.token, kind: 'canvass' }).then(function (x) { if (x.ok) S.report = x.report; });
        }).then(render);
      });
    }
  };

  var ACT = {
    home: function () { S.msg = null; go('home'); },
    offBack: function () { S.msg = null; S.offStart = null; render(); },
    'start-login': function () { S.msg = null; if (S.status.phase !== 'NOMINATION' && S.status.phase !== 'VOTING') return go('home'); go('login'); },
    logout: function () { S.voter = null; S.me = null; S.ballot = {}; S.msg = null; go('home'); },
    pick: function (el) {
      var ctx = el.getAttribute('data-ctx'), key = el.getAttribute('data-pos'), id = el.getAttribute('data-id');
      var ch = ctx === 'demo' ? S.demoBallot : S.ballot;
      var pos = S.status.positions.filter(function (p) { return p.key === key; })[0];
      var cur = (ch[key] || []).slice(), i = cur.indexOf(id);
      S.msg = null;
      if (i >= 0) cur.splice(i, 1);
      else if (pos.seats === 1) cur = [id];
      else if (cur.length < pos.seats) cur.push(id);
      else flash('err', 'You can choose only ' + pos.seats + ' for ' + pos.title + '. Unselect one first.');
      ch[key] = cur;
      var y = window.scrollY; render(); window.scrollTo(0, y);
    },
    review: function () { S.msg = null; go('review'); },
    'edit-ballot': function () { go('ballot'); },
    cast: function () {
      S.busy = true; render();
      api('castBallot', { token: S.voter.token, choices: S.ballot }).then(function (r) {
        S.busy = false;
        if (!r.ok) { flash('err', r.error); return render(); }
        S.doneAt = r.at; S.voter = null; S.me = null; S.ballot = {}; S.msg = null; go('done');
      });
    },
    'go-officials': function () { S.msg = null; S.setup = null; go('officials'); if (S.official) loadTab().then(render); },
    'off-logout': function () { S.official = null; S.dash = null; S.report = null; try { sessionStorage.removeItem('officialSession'); } catch (e) { } S.msg = null; render(); },
    tab: function (el) { S.offTab = el.getAttribute('data-tab'); S.msg = null; render(); loadTab().then(render); },
    'ask-pins': function (el) {
      var a = el.getAttribute('data-a');
      var t = { TEST_OPEN: ['Open test voting', 'Opens the TEST ballot box for Final Testing. The real ballot box is not touched.'],
        TEST_CLOSE: ['Close test voting', 'Closes the TEST box and shows the test results.'],
        REZERO: ['Re-zero', 'Deletes all test ballots. Every count goes back to zero.'],
        SEAL: ['Seal the election', 'This fingerprints the members list, approved nominees, schedule and website version. Any change after this will show as "Seal broken".'],
        OPEN: ['Verify seal and open voting', 'The system will check the seal and the empty ballot box, then open voting. This cannot be undone.'],
        CLOSE: ['Close voting', 'No more ballots will be accepted.'],
        RESULTS: ['Generate and publish results', 'Results will appear on the public site for everyone.'] }[a];
      S.modal = { act: a, title: t[0], note: t[1], two: ((S.dash && S.dash.twoPinActions) || []).indexOf(a) >= 0 }; render();
      setTimeout(function () { var x = $('#pChair'); if (x) x.focus(); }, 30);
    },
    'close-modal': function () { S.modal = null; S.busy = false; render(); },
    'demo-test': function () {
      api('ballotPreview', { token: S.official.token, choices: S.demoBallot }).then(function (r) {
        flash(r.ok ? 'ok' : 'err', r.ok ? 'Valid ballot: ' + r.picks + ' selection(s) accepted by the server. NOT saved. The ballot box is still empty.' : r.error); render();
      });
    },
    'test-cast': function () {
      api('castTestBallot', { token: S.official.token, choices: S.demoBallot }).then(function (r) {
        if (!r.ok) { flash('err', r.error); return render(); }
        S.demoBallot = {}; flash('ok', 'Your test ballot was recorded in the TEST box (' + r.count + ' of ' + r.of + ').');
        loadTab().then(render);
      });
    },
    'demo-clear': function () { S.demoBallot = {}; S.msg = null; render(); },
    report: function (el) {
      api('report', { token: S.official.token, kind: el.getAttribute('data-kind') }).then(function (r) {
        if (!r.ok) { flash('err', r.error); return render(); }
        S.report = r.report; S.msg = null; render();
      });
    },
    print: function () {
      var pa = $('#printArea'); pa.innerHTML = reportBody(S.report);
      try { window.print(); } catch (e) { }
    }
  };

  document.addEventListener('submit', function (e) {
    var f = e.target; if (!SUBMIT[f.id]) return;
    e.preventDefault(); SUBMIT[f.id](f);
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
    var a = el.getAttribute('data-act');
    if (ACT[a]) { e.preventDefault(); ACT[a](el); }
    else if (DEMO && DEMO_ACT[a]) { e.preventDefault(); DEMO_ACT[a](el); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (DEMO && el.getAttribute('data-act') === 'demo-approve') {
      var n = MDB.getNominees()[parseInt(el.getAttribute('data-i'), 10)];
      MDB.demo.setApproved(n.studentNo, el.checked);
      loadTab().then(function () { return loadStatus(); }).then(render);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'nomSearch') $('#nomList').innerHTML = nomOptionsHTML(e.target.value);
  });

  // ---------------- DEMO controls (only when no API_URL) ----------------
  var PRESETS = [
    ['Nov 24 · before', '2026-11-24T10:00:00+08:00'], ['Nov 26 · nomination', '2026-11-26T10:00:00+08:00'], ['Nov 29 · evaluation', '2026-11-29T10:00:00+08:00'],
    ['Dec 1 · nominees', '2026-12-01T10:00:00+08:00'], ['Dec 3 · sealing', '2026-12-03T10:00:00+08:00'], ['Dec 5 · 8:30 AM', '2026-12-05T08:30:00+08:00'],
    ['Dec 5 · 10:00 AM', '2026-12-05T10:00:00+08:00'], ['Dec 6 · 5:55 PM', '2026-12-06T17:55:00+08:00'], ['Dec 6 · 6:05 PM', '2026-12-06T18:05:00+08:00']
  ];
  function renderDemo() {
    var box = $('#demo');
    $('#demoToggle').hidden = false;
    $('#demoToggle').textContent = S.demoOpen ? 'Hide demo controls' : 'Demo controls';
    box.hidden = !S.demoOpen;
    document.body.classList.toggle('demo-docked', S.demoOpen);
    if (!S.demoOpen) return;
    var d = MDB.demo.data(), cur = now().getTime();
    var members = [d.members[2], d.members[6], d.members[11], d.members[12], d.members[0]];
    box.innerHTML = '<b>Demo controls</b><span class="muted">Simulated date: <b>' + esc(ph(now().toISOString())) + '</b></span>' +
      '<h4>Jump to a date</h4><div class="chips">' + PRESETS.map(function (p) { return '<button data-act="demo-time" data-t="' + p[1] + '" class="' + (Math.abs(new Date(p[1]).getTime() - cur) < 3600000 ? 'on' : '') + '">' + p[0] + '</button>'; }).join('') + '</div>' +
      '<h4>Try as a member (click to fill the login)</h4><div class="chips">' + members.map(function (m) { return '<button data-act="demo-fill" data-s="' + esc(m.studentNo) + '" data-e="' + esc(m.email) + '">' + esc(m.name) + (m.votedAt ? ' ✓' : '') + '</button>'; }).join('') + '</div>' +
      '<h4>Committee & observer PINs (demo only)</h4><div class="small">' + d.officials.map(function (o) { return '<div>' + esc(ROLE[o.role]) + ': <span class="mono">' + esc(o.email) + '</span> · PIN <b class="mono">' + MDB.demo.pins[o.email] + '</b> <button class="btn ghost" style="padding:2px 6px" data-act="demo-off" data-e="' + esc(o.email) + '">use</button></div>'; }).join('') + '</div>' +
      '<h4>Shortcuts</h4><div class="chips"><button data-act="demo-votes">Add 5 random votes</button><button data-act="demo-ff">Run the whole election</button><button data-act="demo-reset">Reset demo</button></div>' +
      '<h4>Emails the system sent (' + d.outbox.length + ')</h4>' + (d.outbox.length ? d.outbox.slice(0, 5).map(function (m) {
        var tok = /setup=([0-9a-f]+)/.exec(m.html);
        return '<div class="mail"><span class="small muted">' + esc(m.at) + ' · to ' + esc(m.to) + '</span><b class="small">' + esc(m.subject) + '</b>' + (tok ? '<button class="btn ghost" style="justify-self:start;padding:2px 0" data-act="demo-setup" data-t="' + tok[1] + '">Open PIN link →</button>' : '') + '</div>';
      }).join('') : '<span class="muted small">Login codes and PIN links appear here.</span>');
  }
  function demoRandomVotes(n) {
    var st = LOGIC.handle({ action: 'status' });
    if (st.phase !== 'VOTING') return 0;
    var ids = st.nominees.map(function (x) { return x.id; }), cast = 0;
    MDB.getMembers().filter(function (m) { return !m.votedAt; }).sort(function () { return Math.random() - .5; }).slice(0, n).forEach(function (m) {
      var order = ids.slice();
      for (var i = 0; i < order.length - 1; i++) if (Math.random() < .35) { var t = order[i]; order[i] = order[i + 1]; order[i + 1] = t; }
      var ch = {}, k = 0;
      st.positions.forEach(function (p) { ch[p.key] = []; for (var s = 0; s < p.seats; s++) if (order[k] && Math.random() > .06) ch[p.key].push(order[k++]); else k++; });
      var tok = MDB.randomHex(24);
      MDB.cachePut('sess:' + tok, JSON.stringify({ type: 'voter', sno: m.studentNo.toUpperCase() }), 60);
      if (LOGIC.handle({ action: 'castBallot', token: tok, choices: ch }).ok) cast++;
    });
    return cast;
  }
  function demoTestElection(tok, pins) { // Final Testing: open test voting, 6 officials vote, close, re-zero
    var d0 = LOGIC.handle({ action: 'dashboard', token: tok }).state.fts || {};
    if (d0.rezeroedAt) return;
    if (!d0.openedAt) LOGIC.handle({ action: 'committeeAction', token: tok, act: 'TEST_OPEN', pins: pins });
    var ids = LOGIC.handle({ action: 'nomineesForDemo', token: tok }).nominees.map(function (n) { return n.id; });
    MDB.demo.data().officials.forEach(function (o, k) {
      var t = LOGIC.handle({ action: 'officialLogin', email: o.email, pin: MDB.demo.pins[o.email] }).token;
      var ch = {}, i = k % 3;
      ELECTION_POSITIONS.forEach(function (p) { ch[p.key] = []; for (var x = 0; x < p.seats; x++) if (ids[i]) ch[p.key].push(ids[i++]); });
      LOGIC.handle({ action: 'castTestBallot', token: t, choices: ch });
    });
    LOGIC.handle({ action: 'committeeAction', token: tok, act: 'TEST_CLOSE', pins: pins });
    LOGIC.handle({ action: 'committeeAction', token: tok, act: 'REZERO', pins: pins });
  }
  var DEMO_ACT = {
    'demo-toggle': function () { S.demoOpen = !S.demoOpen; store.set('demoOpen', S.demoOpen ? '1' : '0'); render(); },
    'demo-time': function (el) { MDB.demo.setTime(el.getAttribute('data-t')); S.voter = null; S.msg = null; if (S.view !== 'officials') S.view = 'home'; refreshAll(); },
    'demo-fill': function (el) {
      if (S.view !== 'login') { if (S.status.phase !== 'NOMINATION' && S.status.phase !== 'VOTING') { flash('info', 'Member login works only during nomination (Nov 26–27) or voting (Dec 5–6). Jump to one of those dates first.'); S.view = 'home'; return render(); } S.view = 'login'; render(); }
      $('#sno').value = el.getAttribute('data-s'); $('#email').value = el.getAttribute('data-e');
    },
    'demo-off': function (el) {
      if (S.official) { S.official = null; S.dash = null; S.report = null; }
      var em = el.getAttribute('data-e');
      S.view = 'officials'; S.msg = null;
      api('officialStart', { email: em }).then(function (r) {
        S.offStart = r.ok ? { email: r.email, name: r.name, role: r.role, hasPin: r.hasPin } : null; render();
        if ($('#opin')) $('#opin').value = MDB.demo.pins[em] || '';
      });
    },
    'demo-setup': function (el) { S.setup = { token: el.getAttribute('data-t') }; S.msg = null; go('setup'); checkSetup(); },
    'demo-votes': function () {
      var c = demoRandomVotes(5);
      flash(c ? 'ok' : 'info', c ? c + ' random demo votes added.' : 'Random votes work only while voting is open (jump to Dec 5 · 10:00 AM after sealing and opening).');
      refreshAll();
    },
    'demo-ff': function () {
      var pins = { CHAIRMAN: MDB.demo.pins['chairman@demo.edu.ph'], SECOND_ROLE: 'POLL_CLERK', SECOND: MDB.demo.pins['pollclerk@demo.edu.ph'] };
      var tok = LOGIC.handle({ action: 'officialLogin', email: 'chairman@demo.edu.ph', pin: pins.CHAIRMAN }).token;
      var commit = 'd3m0c0mm17a9b4e2f6c81d5e0b7a3f9c2e4d6b8a';
      var st = LOGIC.handle({ action: 'status' });
      if (st.phase === 'RESULTS') { flash('info', 'The election is already finished. Use "Reset demo" to start again.'); return render(); }
      if (!st.sealed) {
        if (new Date(st.now) < new Date('2026-12-03T10:00:00+08:00')) MDB.demo.setTime('2026-12-03T10:00:00+08:00');
        demoTestElection(tok, pins);
        LOGIC.handle({ action: 'committeeAction', token: tok, act: 'SEAL', pins: pins, commit: commit });
      }
      if (!st.votingOpened) { MDB.demo.setTime('2026-12-05T08:45:00+08:00'); LOGIC.handle({ action: 'committeeAction', token: tok, act: 'OPEN', pins: pins, commit: commit }); }
      [['2026-12-05T09:20:00+08:00', 4], ['2026-12-05T11:10:00+08:00', 2], ['2026-12-05T14:30:00+08:00', 3], ['2026-12-05T20:05:00+08:00', 2], ['2026-12-06T08:40:00+08:00', 3], ['2026-12-06T16:50:00+08:00', 3]]
        .forEach(function (x) { MDB.demo.setTime(x[0]); demoRandomVotes(x[1]); });
      MDB.demo.setTime('2026-12-06T18:05:00+08:00');
      LOGIC.handle({ action: 'committeeAction', token: tok, act: 'CLOSE', pins: pins });
      var r = LOGIC.handle({ action: 'committeeAction', token: tok, act: 'RESULTS', pins: pins });
      flash(r.ok ? 'ok' : 'err', r.ok ? 'Demo election completed: sealed, opened, ' + r.results.totalBallots + ' votes cast, closed and results generated.' : r.error);
      S.view = 'home'; refreshAll();
    },
    'demo-reset': function () {
      MDB.demo.reset(DEMO_START); demoSeed();
      S.voter = null; S.official = null; S.dash = null; S.report = null; S.adminNominees = null; S.log = null; S.demoBallot = {}; S.view = 'home';
      try { sessionStorage.removeItem('officialSession'); } catch (e) { }
      flash('info', 'Demo reset to Nov 26, 10:00 AM (nomination period).'); refreshAll();
    }
  };
  function refreshAll() {
    var p = loadStatus();
    if (S.view === 'officials' && S.official) p = p.then(loadTab);
    p.then(render);
  }
  function checkSetup() {
    api('checkSetupToken', { setupToken: S.setup.token }).then(function (r) {
      if (!r.ok) S.setup.err = r.error; else { S.setup.name = r.name; S.setup.role = r.role; }
      render();
    });
  }

  // ---------------- start ----------------
  var q = new URLSearchParams(location.search);
  if (q.get('setup')) {
    S.setup = { token: q.get('setup') }; S.view = 'setup';
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { }
  }
  if (location.hash === '#officials' || location.hash === '#committee') S.view = 'officials';
  document.getElementById('offLink').addEventListener('click', function (e) { e.preventDefault(); ACT['go-officials'](); });
  document.getElementById('homeLink').addEventListener('click', function (e) { e.preventDefault(); ACT.home(); });
  if (DEMO) document.getElementById('demoToggle').addEventListener('click', function () { DEMO_ACT['demo-toggle'](); });
  render();
  loadStatus().then(function () {
    if (S.view === 'setup') checkSetup();
    if (S.view === 'officials' && S.official) return loadTab().then(render);
    render();
  });
})();
