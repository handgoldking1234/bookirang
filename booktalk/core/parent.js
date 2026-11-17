/* 북토킹 모듈 · 부모님 리포트
 * - 대화가 끝날 때마다: 그 대화 리포트를 부모님 이메일로 보낸다 (설정에서 켜기)
 * - 기간 리포트: 주간(월~일) · 월간 · 분기 · 6개월(상·하반기) · 1년. 기간이 끝난 뒤 앱을 처음 열 때 한 번 보낸다.
 *   (아이 기록이 이 기기에만 있어서, 서버가 혼자 보낼 수 없다. 하루5분 연동 뒤에는 서버 예약 작업으로 옮긴다)
 * - 주간이 아닌 리포트에는 지난주 요약도 함께 넣는다.
 * 설정 키: booktalk.<아이 id>.parent = { email, each, periods, sent: { week: '2026-11-09', ... } }
 */
(function () {
  var BT = window.BookTalk;
  var KINDS = ['week', 'month', 'quarter', 'half', 'year'];
  var KO = { week: '주간', month: '월간', quarter: '분기', half: '6개월', year: '1년' };
  var SRC = { book: '북토킹', topic: '오늘의 주제', free: '프리토킹', textbook: '교과서', novel: '원서' };

  function key() { return 'booktalk.' + BT.host.child.id + '.parent'; }
  function get() {
    var d = { email: '', each: true, periods: true, sent: {} };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(key()) || '{}')); } catch (e) { return d; }
  }
  function set(patch) { var v = Object.assign(get(), patch); try { localStorage.setItem(key(), JSON.stringify(v)); } catch (e) {} return v; }

  /* ---- 날짜 (한국 시간 기준 YYYY-MM-DD 문자열로 비교) ---- */
  function kst(d) { return new Date(d.getTime() + 9 * 3600 * 1000); }
  function ymd(y, m, day) { var t = new Date(Date.UTC(y, m, day)); return t.toISOString().slice(0, 10); }
  function addDays(s, n) { var t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function startOf(kind, s) {
    var t = new Date(s + 'T00:00:00Z'), y = t.getUTCFullYear(), m = t.getUTCMonth();
    if (kind === 'week') return addDays(s, -((t.getUTCDay() + 6) % 7));   // 월요일
    if (kind === 'month') return ymd(y, m, 1);
    if (kind === 'quarter') return ymd(y, m - m % 3, 1);
    if (kind === 'half') return ymd(y, m < 6 ? 0 : 6, 1);
    return ymd(y, 0, 1);
  }
  function months(kind) { return { month: 1, quarter: 3, half: 6, year: 12 }[kind]; }
  // 'today'가 속한 기간의 바로 앞(이미 끝난) 기간 [from, to]
  function lastClosed(kind, today) {
    var curStart = startOf(kind, today);
    if (kind === 'week') return { from: addDays(curStart, -7), to: addDays(curStart, -1) };
    var t = new Date(curStart + 'T00:00:00Z'), n = months(kind);
    var from = ymd(t.getUTCFullYear(), t.getUTCMonth() - n, 1);
    return { from: from, to: addDays(curStart, -1) };
  }
  function before(kind, r) { return lastClosed(kind, r.from); }
  function rangeLabel(kind, r) {
    var f = r.from.split('-'), t = r.to.split('-');
    if (kind === 'week') return Number(f[1]) + '/' + Number(f[2]) + '~' + Number(t[1]) + '/' + Number(t[2]);
    if (kind === 'month') return f[0] + '년 ' + Number(f[1]) + '월';
    if (kind === 'quarter') return f[0] + '년 ' + (Math.floor((Number(f[1]) - 1) / 3) + 1) + '분기';
    if (kind === 'half') return f[0] + '년 ' + (Number(f[1]) < 7 ? '상반기' : '하반기');
    return f[0] + '년';
  }

  /* ---- 기간 요약 숫자 ---- */
  function inR(x, r) { return x.date >= r.from && x.date <= r.to; }
  function summarize(all, r) {
    var list = all.filter(function (x) { return inR(x, r); });
    var seen = {};
    all.forEach(function (x) { if (x.date < r.from) (x.stats.words || []).forEach(function (w) { seen[w] = 1; }); });
    var fresh = {}; list.forEach(function (x) { (x.stats.words || []).forEach(function (w) { if (!seen[w]) fresh[w] = 1; }); });
    var days = {}; list.forEach(function (x) { days[x.date] = 1; });
    var sum = function (f) { return list.reduce(function (n, x) { return n + (f(x) || 0); }, 0); };
    var words = sum(function (x) { return x.stats.total; }), sents = sum(function (x) { return x.stats.sentences; });
    var gAll = 0, gUsed = 0; list.forEach(function (x) { (x.goals || []).forEach(function (g) { gAll++; if (g.used) gUsed++; }); });
    var avg = function (f) { return list.length ? Math.round(sum(f) / list.length) : 0; };
    return {
      sessions: list.length, days: Object.keys(days).length, minutes: sum(function (x) { return x.stats.minutes; }),
      sentences: sents, avgLen: sents ? Math.round(words / sents * 10) / 10 : 0, newWords: Object.keys(fresh).length,
      goalRate: gAll ? Math.round(gUsed / gAll * 100) : null, self: avg(function (x) { return x.stats.self; }),
      ratio: avg(function (x) { return x.stats.ratio; }), koreanTurns: sum(function (x) { return x.koreanTurns; }), list: list
    };
  }
  function kidLines(list, fromEnd) {
    var lines = [];
    list.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (x) { (x.talk || []).forEach(function (m) { if (m.role === 'kid') lines.push(m.text); }); });
    return fromEnd ? lines.slice(-6) : lines.slice(0, 6);
  }
  function strip(c) { var o = Object.assign({}, c); delete o.list; return o; }

  function call(p) { return BT.api.call(p); }

  /* ---- 대화 하나 보내기 ---- */
  function sendSession(x, to) {
    var email = to || get().email;
    if (!email) return Promise.reject(new Error('부모님 이메일이 없어요'));
    return call({ task: 'mail', to: email, kind: 'session', data: {
      child: BT.host.child.name, title: x.title, date: x.date, sourceName: SRC[x.source] || '북토킹',
      stats: x.stats, report: x.report || {}, goals: x.goals || []
    } });
  }

  /* ---- 기간 리포트 하나 만들어 보내기 ---- */
  function sendPeriod(kind, sessions, today, to) {
    var email = to || get().email;
    if (!email) return Promise.reject(new Error('부모님 이메일이 없어요'));
    var r = lastClosed(kind, today), cur = summarize(sessions, r);
    if (!cur.sessions) return Promise.resolve({ skipped: true, kind: kind });
    var prev = summarize(sessions, before(kind, r));
    var wk = kind === 'week' ? null : lastClosed('week', today);
    var fixes = []; cur.list.forEach(function (x) { ((x.report && x.report.fixes) || []).forEach(function (f) { fixes.push(f); }); });
    var titles = cur.list.map(function (x) { return x.title; });
    var range = rangeLabel(kind, r);
    return call({ task: 'period', kind: kind, range: range, level: BT.host.child.level, cur: strip(cur), prev: strip(prev),
      titles: titles, early: kidLines(cur.list, false), late: kidLines(cur.list, true), fixes: fixes.slice(-12) })
      .catch(function () { return {}; })   // 분석이 실패해도 숫자 리포트는 보낸다
      .then(function (an) {
        var data = { kind: kind, child: BT.host.child.name, range: range, analysis: an, cur: strip(cur), prev: strip(prev), fixes: fixes.slice(-5), titles: titles };
        if (wk) { data.week = strip(summarize(sessions, wk)); data.weekPrev = strip(summarize(sessions, before('week', wk))); }
        return call({ task: 'mail', to: email, kind: 'period', data: data });
      })
      .then(function (res) { return Object.assign({ kind: kind }, res); });
  }

  /* ---- 앱을 열 때: 끝난 기간 중 아직 안 보낸 것 보내기 (가장 긴 기간부터, 한 번에 최대 2통) ---- */
  function checkDue(sessions, now) {
    var cfg = get();
    if (!cfg.email || !cfg.periods || !sessions.length) return Promise.resolve([]);
    var today = kst(now || new Date()).toISOString().slice(0, 10);
    var due = KINDS.slice().reverse().filter(function (k) {
      var r = lastClosed(k, today);
      return cfg.sent[k] !== r.from && sessions.some(function (x) { return inR(x, r); });
    });
    // 첫 설정 직후에는 예전 기간을 몰아서 보내지 않도록, 처음 본 기간은 '보낸 것'으로 기록만 한다
    if (!cfg.armed) { var sent = {}; KINDS.forEach(function (k) { sent[k] = lastClosed(k, today).from; }); set({ armed: true, sent: Object.assign({}, cfg.sent, sent) }); return Promise.resolve([]); }
    var out = [];
    return due.slice(0, 2).reduce(function (p, k) {
      return p.then(function () {
        return sendPeriod(k, sessions, today).then(function (res) {
          var c = get(); c.sent[k] = lastClosed(k, today).from; set({ sent: c.sent }); out.push(res);
        }).catch(function (e) { out.push({ kind: k, error: e.message }); });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  BT.parent = { get: get, set: set, sendSession: sendSession, sendPeriod: sendPeriod, checkDue: checkDue, summarize: summarize, lastClosed: lastClosed, rangeLabel: rangeLabel, KO: KO,
    today: function () { return kst(new Date()).toISOString().slice(0, 10); } };
})();
