/*
 * DEMO database — used only when config.js has no API_URL.
 * Pretends to be the Google Sheet, so you can try the whole election in the browser.
 * Data is kept in this browser only (localStorage). Nothing is sent anywhere.
 */
(function (root) {
  // Small synchronous SHA-256 (the real server uses Google's Utilities.computeDigest).
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var bytes = unescape(encodeURIComponent(String(ascii)));
    var K = sha256.K || (sha256.K = (function () {
      var k = [], p = 2, n = 0;
      while (n < 64) { var ok = true; for (var d = 2; d * d <= p; d++) if (p % d === 0) { ok = false; break; } if (ok) { k[n++] = (Math.pow(p, 1 / 3) * 4294967296) | 0; } p++; }
      return k;
    })());
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var words = [], bl = bytes.length * 8, i, j;
    bytes += '\x80'; while (bytes.length % 64 - 56) bytes += '\x00';
    for (i = 0; i < bytes.length; i++) words[i >> 2] |= bytes.charCodeAt(i) << ((3 - i) % 4) * 8;
    words[words.length] = (bl / 4294967296) | 0; words[words.length] = bl;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = H.slice(0);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = H[0], e = H[4];
        var t1 = H[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + K[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
        H = [(t1 + t2) | 0].concat(H); H[4] = (H[4] + t1) | 0; H.length = 8;
      }
      for (i = 0; i < 8; i++) H[i] = (H[i] + old[i]) | 0;
    }
    var out = ''; for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }

  function randomHex(n) {
    var a = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var FIRST = ['Andrea Reyes', 'Benjie Santos', 'Carla Mendoza', 'Dennis Villanueva', 'Elena Bautista', 'Francis Garcia', 'Grace Aquino', 'Henry Ramos',
    'Iris Navarro', 'Joanna Lacson', 'Kevin Manalo', 'Lorna Gatchalian', 'Marco Tolentino'];
  var OTHERS = [['Jose Castillo', 'Second Year'], ['Karen Dizon', 'Second Year'], ['Leo Fernandez', 'Second Year'],
    ['Noel Cruz', 'Third Year'], ['Olive Pascual', 'Third Year'], ['Paolo Lim', 'Third Year'], ['Queenie Ocampo', 'Third Year']];

  function seed() {
    var members = [];
    FIRST.forEach(function (n, i) { members.push({ studentNo: '2025-' + (1001 + i), name: n, email: n.toLowerCase().replace(' ', '.') + '@demo.edu.ph', yearLevel: 'First Year', votedAt: '' }); });
    OTHERS.forEach(function (x, i) { members.push({ studentNo: (x[1] === 'Second Year' ? '2024-' : '2023-') + (2001 + i), name: x[0], email: x[0].toLowerCase().replace(' ', '.') + '@demo.edu.ph', yearLevel: x[1], votedAt: '' }); });
    var noms = [], ts = '2026-11-26T08:00:00.000Z';
    var plan = [];
    // members 0-5 said YES in registration (auto-nominees); 13-19 already nominated; 0-12 can still nominate in the demo
    var plan = [[13, 6], [14, 7], [15, 0], [16, 8], [17, 9], [18, 1], [19, 10]];
    plan.forEach(function (p) { var a = members[p[0]], b = members[p[1]]; noms.push({ ts: ts, nominatorNo: a.studentNo, nominatorName: a.name, nomineeNo: b.studentNo, nomineeName: b.name, reason: '' }); });
    return {
      settings: {}, members: members, nominations: noms,
      nominees: members.slice(0, 6).map(function (m) { return { studentNo: m.studentNo, name: m.name, yearLevel: m.yearLevel, count: 0, approved: false, remarks: 'AUTO-NOMINEE: said YES in registration' }; }),
      officials: [
        { role: 'CHAIRMAN', name: 'Dr. Maria Clara Soriano', email: 'chairman@demo.edu.ph', title: 'Chairman, Election Committee' },
        { role: 'POLL_CLERK', name: 'Mr. Ramon Velasco', email: 'pollclerk@demo.edu.ph', title: 'Poll Clerk' },
        { role: 'MEMBER', name: 'Ms. Teresa Abad', email: 'member@demo.edu.ph', title: 'Member' },
        { role: 'OBSERVER', name: 'ALI (Observer)', email: 'observer.ali@demo.edu.ph', title: 'Observer' },
        { role: 'OBSERVER', name: 'Program Head / Adviser', email: 'adviser@demo.edu.ph', title: 'Program Head / Adviser' },
        { role: 'OBSERVER', name: 'OSA Representative', email: 'osa@demo.edu.ph', title: 'Office of Student Affairs' }
      ],
      props: {}, cache: {}, ballots: [], log: [], tieBreaks: [], results: null, outbox: [], protectedAt: ''
    };
  }

  var DEMO_PINS = { 'chairman@demo.edu.ph': '246810', 'pollclerk@demo.edu.ph': '135790', 'member@demo.edu.ph': '864209',
    'observer.ali@demo.edu.ph': '470213', 'adviser@demo.edu.ph': '582914', 'osa@demo.edu.ph': '693025' };

  function MockDB(opts) {
    opts = opts || {};
    var KEY = opts.storageKey || 'ntc-election-demo-v3';
    var data = null, offset = 0;
    function load() {
      if (data) return data;
      try { var raw = opts.storage && opts.storage.getItem(KEY); if (raw) { var o = JSON.parse(raw); data = o.data; offset = o.offset || 0; } } catch (e) { data = null; }
      if (!data) reset(opts.startAt);
      return data;
    }
    function save() { try { opts.storage && opts.storage.setItem(KEY, JSON.stringify({ data: data, offset: offset })); } catch (e) { } }
    function reset(startAt) {
      data = seed(); offset = startAt ? new Date(startAt).getTime() - Date.now() : 0;
      // pre-set demo PINs (in the real system each person sets their own via the emailed link)
      Object.keys(DEMO_PINS).forEach(function (em) {
        var salt = randomHex(12), h = salt + '|' + DEMO_PINS[em];
        for (var i = 0; i < 200; i++) h = sha256(salt + h);
        data.props['pin:' + em] = JSON.stringify({ salt: salt, hash: h, at: new Date().toISOString() });
      });
      save();
    }
    function cacheGet(k) { var c = load().cache[k]; if (!c) return null; if (c.exp < Date.now()) { delete data.cache[k]; return null; } return c.v; }
    function phtText(d) { return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); }

    var db = {
      now: function () { load(); return new Date(Date.now() + offset); },
      getSettingsRaw: function () { return load().settings; },
      getMembers: function () { return load().members.map(function (m) { return Object.assign({}, m); }); },
      markVoted: function (sno, iso) { load().members.forEach(function (m) { if (m.studentNo.toUpperCase() === sno) m.votedAt = iso; }); save(); },
      getNominations: function () { return load().nominations.slice(); },
      addNomination: function (n) { load().nominations.push(n); save(); },
      getNominees: function () { return load().nominees.map(function (n) { return Object.assign({}, n); }); },
      syncNominees: function (list) {
        var old = {}; load().nominees.forEach(function (n) { old[n.studentNo.toUpperCase()] = n; });
        var listed = {};
        data.nominees = list.map(function (n) { listed[n.studentNo] = 1; var o = old[n.studentNo] || {}; return { studentNo: n.studentNo, name: n.name, yearLevel: n.yearLevel, count: n.count, approved: !!o.approved, remarks: o.remarks || '' }; });
        // keep rows added directly by the Committee (e.g. auto-nominees from the survey), like the real Sheet does
        Object.keys(old).forEach(function (k) { if (!listed[k]) data.nominees.push(Object.assign({}, old[k], { count: 0 })); });
        save();
      },
      getOfficials: function () { return load().officials.slice(); },
      getProp: function (k) { var v = load().props[k]; return v == null ? null : v; },
      setProp: function (k, v) { load().props[k] = v; save(); },
      delProp: function (k) { delete load().props[k]; save(); },
      cacheGet: function (k) { return cacheGet(k); },
      cachePut: function (k, v, sec) { load().cache[k] = { v: v, exp: Date.now() + sec * 1000 }; save(); },
      cacheDel: function (k) { delete load().cache[k]; save(); },
      countBallots: function () { return load().ballots.length; },
      getBallots: function () { return JSON.parse(JSON.stringify(load().ballots)); },
      addBallot: function (id, choices) { var b = load().ballots; b.splice(Math.floor(Math.random() * (b.length + 1)), 0, { id: id, choices: choices }); save(); },
      log: function (event, actor, details) { load().log.push({ ts: phtText(db.now()), event: event, actor: actor, details: details }); save(); },
      getLog: function (limit) { var l = load().log; return l.slice(Math.max(0, l.length - (limit || 500))); },
      getTieBreaks: function () { return load().tieBreaks.slice(); },
      saveResults: function (r) { load().results = r; save(); },
      sendMail: function (to, subject, html) { load().outbox.unshift({ at: phtText(db.now()), to: to, subject: subject, html: html }); data.outbox = data.outbox.slice(0, 40); save(); },
      withLock: function (fn) { return fn(); },
      sha256: sha256,
      randomHex: randomHex,
      protectSheets: function () { load().protectedAt = db.now().toISOString(); save(); },

      // ----- demo-only helpers (simulate what the Committee does in the Google Sheet) -----
      demo: {
        data: function () { return load(); },
        save: save,
        reset: function (startAt) { reset(startAt); },
        setTime: function (iso) { load(); offset = new Date(iso).getTime() - Date.now(); save(); },
        getOffset: function () { load(); return offset; },
        addNomineeRow: function (row) { load().nominees.push(row); save(); },
        setApproved: function (sno, val) { load().nominees.forEach(function (n) { if (n.studentNo === sno) n.approved = !!val; }); save(); },
        setSetting: function (k, v) { load().settings[k] = v; save(); },
        addTieBreak: function (position, winner) { load().tieBreaks.push({ position: position, winner: winner }); save(); },
        pins: DEMO_PINS
      }
    };
    return db;
  }

  root.MockDB = MockDB;
  root.mockSha256 = sha256;
  if (typeof module !== 'undefined') module.exports = { MockDB: MockDB, sha256: sha256 };
})(typeof window !== 'undefined' ? window : globalThis);
