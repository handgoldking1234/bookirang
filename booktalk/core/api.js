/* 북토킹 모듈 · 서버 호출 (analyze / chat / report) */
(function () {
  var BT = window.BookTalk;
  BT.api = {
    call: function (payload) {
      var host = BT.host;
      var headers = { 'content-type': 'application/json' };
      if (typeof host.getAuthHeaders === 'function') Object.assign(headers, host.getAuthHeaders() || {});
      var body = Object.assign({ cid: host.child && host.child.id }, payload); // 사용량 집계용 아이 id
      return fetch((host.apiBase || '') + host.endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || '서버 오류'); return j; }); });
    }
  };
})();
