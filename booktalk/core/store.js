/* 북토킹 모듈 · 세션 저장소
 * 키는 booktalk.<아이 id>.sessions 로 분리해 호스트 앱 데이터와 섞이지 않게 한다.
 * 호스트가 storage 어댑터를 주면 그걸 쓰고, 없으면 localStorage.
 */
(function () {
  var BT = window.BookTalk;
  function adapter() {
    if (BT.host.storage) return BT.host.storage;
    return {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };
  }
  function key() { return 'booktalk.' + BT.host.child.id + '.sessions'; }
  BT.store = {
    load: function () {
      try { return JSON.parse(adapter().get(key()) || '[]'); } catch (e) { return []; }
    },
    save: function (session) {
      var list = BT.store.load().filter(function (s) { return s.id !== session.id; });
      list.unshift(session);
      list = list.slice(0, 400);
      adapter().set(key(), JSON.stringify(list));
      return list;
    },
    clear: function () { adapter().set(key(), '[]'); return []; }
  };
})();
