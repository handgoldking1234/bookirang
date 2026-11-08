/* 북토킹 모듈 · 통계 계산 (화면과 무관한 순수 함수) */
(function () {
  var BT = window.BookTalk;
  var STOP = {};
  'a an the and or but so to of in on at for with is am are was were be been it its this that i you he she we they me my your his her our their them us do does did not no yes yeah oh um uh very really just there here what why how when where who because like'
    .split(' ').forEach(function (w) { STOP[w] = 1; });
  function tok(s) { return (String(s || '').toLowerCase().match(/[a-z']+/g) || []); }
  function dayKey(d) { return d.toISOString().slice(0, 10); }

  /* 한 번의 북토킹 → 숫자 */
  function calc(msgs, analysis, start, end, hints, turns) {
    var kid = msgs.filter(function (m) { return m.role === 'kid'; }).map(function (m) { return m.text; });
    var tutor = msgs.filter(function (m) { return m.role === 'tutor'; }).map(function (m) { return m.text; });
    var kidWords = [].concat.apply([], kid.map(tok));
    var tutorWords = [].concat.apply([], tutor.map(tok));
    var freq = {};
    kidWords.forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    var uniq = Object.keys(freq).length;
    var top = Object.keys(freq).filter(function (w) { return !STOP[w] && w.length > 1; })
      .sort(function (x, y) { return freq[y] - freq[x]; }).slice(0, 6).map(function (w) { return [w, freq[w]]; });
    var sentences = kid.reduce(function (n, t) { return n + Math.max(1, t.split(/[.!?]+/).filter(function (x) { return x.trim(); }).length); }, 0);
    var kidText = ' ' + kid.join(' ').toLowerCase() + ' ';
    var bookWords = ((analysis && analysis.words) || []).map(function (w) {
      var e = (w.en || '').toLowerCase();
      return [w.en, !!e && kidText.indexOf(e.split(' ')[0]) > -1];
    });
    var all = kidWords.length + tutorWords.length;
    return {
      total: kidWords.length, unique: uniq, top: top, sentences: sentences, turns: turns,
      avg: sentences ? Math.round(kidWords.length / sentences * 10) / 10 : 0,
      ratio: all ? Math.round(kidWords.length / all * 100) : 0,
      minutes: Math.max(1, Math.round((end - start) / 60000)),
      hints: hints, self: turns ? Math.max(0, Math.round((1 - hints / turns) * 100)) : 100,
      ttr: kidWords.length ? Math.round(uniq / kidWords.length * 100) : 0,
      bookWords: bookWords, words: Object.keys(freq)
    };
  }

  /* 여러 세션 → 주간(요일) / 월간(최근 4주) / 연간(최근 12개월) */
  function aggregate(sessions, period, now) {
    now = now || new Date();
    var buckets = [];
    if (period === 'week') {
      for (var i = 6; i >= 0; i--) { var d = new Date(now); d.setDate(now.getDate() - i); buckets.push({ label: ['일', '월', '화', '수', '목', '금', '토'][d.getDay()], match: dayKey(d) }); }
    } else if (period === 'month') {
      for (var j = 3; j >= 0; j--) { var e = new Date(now); e.setDate(now.getDate() - j * 7); var s = new Date(e); s.setDate(e.getDate() - 6); buckets.push({ label: (4 - j) + '주', from: dayKey(s), to: dayKey(e) }); }
    } else {
      for (var k = 11; k >= 0; k--) { var m = new Date(now.getFullYear(), now.getMonth() - k, 1); buckets.push({ label: (m.getMonth() + 1) + '월', ym: m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') }); }
    }
    function inB(x, b) { if (b.match) return x.date === b.match; if (b.ym) return x.date.slice(0, 7) === b.ym; return x.date >= b.from && x.date <= b.to; }
    var values = buckets.map(function (b) { return sessions.filter(function (x) { return inB(x, b); }).reduce(function (n, x) { return n + x.stats.sentences; }, 0); });
    var inPeriod = sessions.filter(function (x) { return buckets.some(function (b) { return inB(x, b); }); });
    var vocab = {}; sessions.forEach(function (x) { (x.stats.words || []).forEach(function (w) { vocab[w] = 1; }); });
    function avg(f) { return inPeriod.length ? inPeriod.reduce(function (n, x) { return n + f(x.stats); }, 0) / inPeriod.length : 0; }
    var sources = { book: 0, topic: 0, textbook: 0, novel: 0 };
    inPeriod.forEach(function (x) { var k = x.source || 'book'; sources[k] = (sources[k] || 0) + 1; });
    var gAll = 0, gUsed = 0;
    inPeriod.forEach(function (x) { (x.goals || []).forEach(function (g) { gAll++; if (g.used) gUsed++; }); });
    return {
      labels: buckets.map(function (b) { return b.label; }), values: values,
      sources: sources, goalRate: gAll ? Math.round(gUsed / gAll * 100) : null,
      books: inPeriod.length,
      minutes: inPeriod.reduce(function (n, x) { return n + x.stats.minutes; }, 0),
      words: inPeriod.reduce(function (n, x) { return n + x.stats.unique; }, 0),
      vocab: Object.keys(vocab).length,
      skills: {
        amount: Math.min(100, Math.round(avg(function (s) { return s.ratio; }) * 1.4)),
        length: Math.min(100, Math.round(avg(function (s) { return s.avg; }) * 10)),
        variety: Math.round(avg(function (s) { return s.ttr; })),
        self: Math.round(avg(function (s) { return s.self; }))
      }
    };
  }

  BT.stats = { calc: calc, aggregate: aggregate };
})();
