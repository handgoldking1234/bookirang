/* 북토킹 모듈 · 호스트 연결 설정
 * 북토킹을 다른 앱(예: 하루5분)에 넣을 때는 이 파일을 로드하기 "전에"
 * window.BookTalkHost = { ... } 를 정의해 필요한 값만 덮어쓴다.
 * 북이랑 단독 앱에서는 아래 기본값으로 동작한다.
 */
(function () {
  var defaults = {
    mode: 'standalone',            // 'standalone' | 'embedded'
    appName: '북이랑',
    tutorName: '도란이',
    apiBase: '',                   // 다른 도메인의 서버를 쓸 때만 지정 (예: https://bookirang.vercel.app)
    endpoint: '/api/booktalk',
    child: { id: 'local', name: '서윤', grade: '초5', level: 3 },   // 호스트가 로그인한 아이 정보로 교체
    features: { plan: true, rank: true },   // 호스트에 이미 랭킹이 있으면 rank:false
    storage: null,                 // { get(key), set(key, value) } — 없으면 localStorage
    onSessionComplete: null,       // function(session) — 호스트 DB 저장, 캐시·포인트 지급 등
    getAuthHeaders: null           // function() → { Authorization: 'Bearer …' } 호스트 로그인 토큰 전달
  };
  var h = window.BookTalkHost || {};
  var host = Object.assign({}, defaults, h);
  host.child = Object.assign({}, defaults.child, h.child || {});
  host.features = Object.assign({}, defaults.features, h.features || {});
  // 단독 앱에서는 '내 정보'에서 고친 값을 이 기기에 저장해 두고 쓴다 (하루5분 안에서는 호스트 값이 우선)
  var PKEY = 'booktalk.profile';
  if (host.mode === 'standalone') {
    try { Object.assign(host.child, JSON.parse(localStorage.getItem(PKEY) || '{}')); } catch (e) {}
  }
  window.BookTalk = window.BookTalk || {};
  window.BookTalk.host = host;
  window.BookTalk.profile = {
    editable: host.mode === 'standalone',
    save: function (c) {
      if (host.mode !== 'standalone') return host.child;
      host.child.name = String(c.name || host.child.name).slice(0, 12);
      host.child.grade = c.grade || host.child.grade;
      host.child.level = Math.min(5, Math.max(1, Number(c.level) || host.child.level));
      try { localStorage.setItem(PKEY, JSON.stringify({ name: host.child.name, grade: host.child.grade, level: host.child.level })); } catch (e) {}
      return host.child;
    }
  };
})();
