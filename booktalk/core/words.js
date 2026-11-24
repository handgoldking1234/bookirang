/* 북토킹 모듈 · 단어 카드와 단어장
 * BookTalk.words.lookup(word, sentence, level)  → Promise<{ word, ipa, pos, ko, example, exampleKo }> (한 번 찾은 낱말은 기억)
 * BookTalk.words.list() / isSaved(word) / toggle(card, from) / remove(word)  — 단어장 (booktalk.<아이id>.words)
 * BookTalk.words.due() / mark(word, knew)                                    — 복습 (알면 다음 복습을 1·2·4·7·14일 뒤로)
 * BookTalk.words.score(heard, target)                                       — 발음 확인: 들린 말과 낱말이 얼마나 같은지 (0~1)
 */
(function () {
  var BT = window.BookTalk;
  var GAPS = [1, 2, 4, 7, 14];          // 단계별 다음 복습까지 날짜
  var mem = {}, inflight = {};

  function adapter() {
    if (BT.host.storage) return BT.host.storage;
    return {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };
  }
  function key() { return 'booktalk.' + BT.host.child.id + '.words'; }
  function cacheKey() { return 'booktalk.wordcache'; }
  function norm(w) { return String(w || '').toLowerCase().replace(/[’]/g, "'").trim(); }
  function read(k, d) { try { return JSON.parse(adapter().get(k) || '') || d; } catch (e) { return d; } }
  function today() { var d = new Date(Date.now() + 9 * 3600 * 1000); return d.toISOString().slice(0, 10); }
  function addDays(n) { var d = new Date(Date.now() + 9 * 3600 * 1000 + n * 86400000); return d.toISOString().slice(0, 10); }

  var disk = read(cacheKey(), {});

  function lookup(word, sentence, level) {
    var k = norm(word);
    if (mem[k]) return Promise.resolve(mem[k]);
    if (disk[k]) { mem[k] = disk[k]; return Promise.resolve(disk[k]); }
    if (!inflight[k]) {
      inflight[k] = BT.api.call({ task: 'word', word: word, sentence: sentence || '', level: level })
        .then(function (r) {
          mem[k] = r; delete inflight[k];
          disk[k] = r;
          var ks = Object.keys(disk); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach(function (x) { delete disk[x]; });
          adapter().set(cacheKey(), JSON.stringify(disk));
          return r;
        }, function (e) { delete inflight[k]; throw e; });
    }
    return inflight[k];
  }

  function list() { return read(key(), []); }
  function save(l) { adapter().set(key(), JSON.stringify(l.slice(0, 1000))); return l; }
  function isSaved(word) { var k = norm(word); return list().some(function (x) { return norm(x.word) === k; }); }
  function remove(word) { var k = norm(word); return save(list().filter(function (x) { return norm(x.word) !== k; })); }
  function toggle(card, from) {
    if (!card || !card.word) return list();
    if (isSaved(card.word)) return remove(card.word);
    var l = list();
    l.unshift({ word: card.word, ipa: card.ipa || '', pos: card.pos || '', ko: card.ko || '', example: card.example || '', exampleKo: card.exampleKo || '',
      from: from || '', savedAt: today(), box: 0, due: today() });
    return save(l);
  }
  function due() { var t = today(); return list().filter(function (x) { return !x.due || x.due <= t; }); }
  function mark(word, knew) {
    var k = norm(word);
    return save(list().map(function (x) {
      if (norm(x.word) !== k) return x;
      var box = knew ? Math.min(GAPS.length - 1, (x.box || 0) + (x.seen ? 1 : 0)) : 0;
      return Object.assign({}, x, { box: box, seen: true, due: knew ? addDays(GAPS[box]) : today() });
    }));
  }

  // 들린 말 속에 낱말과 가장 비슷한 낱말을 찾아 0~1 점수로 (철자 거리 기준)
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function score(heard, targets) {
    var words = norm(heard).replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
    var best = 0;
    [].concat(targets).map(norm).filter(Boolean).forEach(function (t) {
      words.forEach(function (w) { var s = 1 - lev(w, t) / Math.max(w.length, t.length); if (s > best) best = s; });
    });
    return best;
  }

  BT.words = { lookup: lookup, list: list, isSaved: isSaved, toggle: toggle, remove: remove, due: due, mark: mark, score: score, norm: norm };
})();
