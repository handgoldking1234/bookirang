/* 북토킹 모듈 · 도란이 목소리
 * 서버에 OPENAI_API_KEY가 있으면 OpenAI 음성(자연스러운 목소리), 없거나 실패하면 브라우저 목소리.
 * 같은 문장은 한 번만 만들어 기억해 두고 다시 쓴다 (비용 절약).
 */
(function () {
  var BT = window.BookTalk;
  var cache = {};
  // 목소리마다 높낮이·빠르기를 확실히 다르게 (서버 음성은 재생 속도로, 기계음은 pitch로)
  var TONE = {
    friend_f: { rate: 1.12, keep: false, pitch: 1.45, brate: 1.0 },   // 높고 빠르게 → 어린 여자아이
    friend_m: { rate: 1.1, keep: false, pitch: 1.25, brate: 1.0 },    // 조금 높게 → 어린 남자아이
    sister:   { rate: 1.0, keep: true, pitch: 1.1, brate: 0.92 },
    brother:  { rate: 0.96, keep: false, pitch: 0.8, brate: 0.9 },    // 조금 낮게
    teacher:  { rate: 0.92, keep: true, pitch: 1.0, brate: 0.85 }     // 같은 높이로 천천히
  };
  function tone() { return TONE[style] || TONE.friend_f; }
  var style = (function () { try { return localStorage.getItem('booktalk.voice') || 'friend_f'; } catch (e) { return 'friend_f'; } })();
  var natural = null;           // null: 아직 모름, true/false
  var player = new Audio();     // 하나를 계속 써야 아이폰·아이패드에서 자동 재생이 막히지 않는다
  var priming = false;          // 무음 파일로 '잠금 풀기' 중인지 (실제 음성과 구분)
  var pending = null;           // 브라우저가 자동 재생을 막아 못 들려준 소리 { src | text }
  // 말하기 시작·끝을 화면에 알린다 (도란이 입 모양 애니메이션용)
  function emit(name) { try { window.dispatchEvent(new Event('booktalk:' + name)); } catch (e) {} }
  player.addEventListener('playing', function () { if (!priming) emit('speak'); });
  ['ended', 'pause', 'error'].forEach(function (ev) { player.addEventListener(ev, function () { emit('quiet'); }); });

  var SILENT = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqq';
  // 휴대폰 브라우저는 '누른 순간'에만 소리를 허락하는 경우가 있다.
  // 화면을 누를 때마다(쉬고 있을 때만) 같은 플레이어로 무음을 틀어 허락을 이어 두고,
  // 막혀서 못 들려준 소리가 있으면 그 누름으로 바로 들려준다.
  function onTap() {
    if (pending) { var pd = pending; pending = null; hidePill(); if (pd.src) play(pd.src); else browserSay(pd.text, token, true); return; }
    if (!player.paused && !priming) return;
    try {
      priming = true; player.src = SILENT;
      var p = player.play();
      if (p && p.then) p.then(function () { priming = false; }, function () { priming = false; }); else priming = false;
    } catch (e) { priming = false; }
  }
  document.addEventListener('pointerdown', onTap, { capture: true });

  // 소리가 막혔을 때 보여 주는 「눌러서 듣기」 버튼
  var pill = null;
  function showPill() {
    try {
      if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.textContent = '🔊 눌러서 도란이 말 듣기';
        pill.setAttribute('style', 'position:fixed;left:50%;bottom:calc(120px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;border:0;border-radius:999px;padding:12px 20px;min-height:48px;background:#171C35;color:#FFFFFF;font:700 16px/1 inherit;box-shadow:0 6px 20px rgba(23,28,53,.25)');
        pill.addEventListener('click', function (e) { e.stopPropagation(); });   // 실제 재생은 pointerdown(onTap)에서
      }
      if (!pill.parentNode) document.body.appendChild(pill);
    } catch (e) {}
  }
  function hidePill() { try { if (pill && pill.parentNode) pill.parentNode.removeChild(pill); } catch (e) {} }

  var token = 0;          // 새로 말하기 시작하면 이전 말하기(또는 늦게 도착한 음성)를 무시한다
  var onDone = null;      // 지금 말하는 문장이 끝나면 부를 함수
  function finish(t) { if (t !== token) return; var f = onDone; onDone = null; if (f) f(); }
  player.addEventListener('ended', function () { finish(token); });
  player.addEventListener('error', function () { if (!priming) finish(token); });

  function browserSay(text, t, retried) {
    try {
      if (!window.speechSynthesis) { finish(t); return; }
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = /[가-힣]/.test(text) ? 'ko-KR' : 'en-US'; u.rate = tone().brate; u.pitch = tone().pitch;
      u.onstart = function () { emit('speak'); };
      u.onend = function () { emit('quiet'); finish(t); };
      u.onerror = function (e) {
        emit('quiet');
        if (e && e.error === 'not-allowed' && !retried && t === token) { pending = { text: text }; showPill(); return; }
        finish(t);
      };
      window.speechSynthesis.speak(u);
    } catch (e) { finish(t); }
  }

  function play(src) {
    try {
      priming = false; pending = null; hidePill();
      player.pause(); player.src = src;
      var tn = tone();
      player.preservesPitch = player.mozPreservesPitch = player.webkitPreservesPitch = tn.keep;
      player.defaultPlaybackRate = tn.rate; player.playbackRate = tn.rate;
      var p = player.play();
      if (p && p.catch) p.catch(function (e) {
        if (e && e.name === 'AbortError') return;                       // 다른 소리로 바뀐 것: 무시
        if (e && e.name === 'NotAllowedError') { pending = { src: src }; showPill(); return; }   // 자동 재생 막힘 → 한 번 누르면 재생
        finish(token);
      });
    } catch (e) { finish(token); }
  }

  // 긴 글은 문장 단위로 600자 안쪽 조각으로 나눈다 (서버 음성 한 번에 600자까지)
  function chunks(text) {
    var sents = String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
    var out = [], cur = '';
    sents.forEach(function (x) {
      x = x.trim(); if (!x) return;
      if ((cur + ' ' + x).length > 500 && cur) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x;
    });
    if (cur) out.push(cur);
    return out.map(function (c) { return c.length > 590 ? c.slice(0, 590) : c; });
  }

  function speakOne(text, t, done) {
    onDone = done || null;
    if (cache[style + '|' + text]) { play(cache[style + '|' + text]); return; }
    check().then(function (ok) {
      if (t !== token) return;
      if (!ok) { browserSay(text, t); return; }
      BT.api.call({ task: 'tts', text: text, voice: style })
        .then(function (r) { cache[style + '|' + text] = 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio; if (t === token) play(cache[style + '|' + text]); })
        .catch(function () { if (t === token) browserSay(text, t); });
    });
  }

  function prefetch(text) {
    if (cache[style + '|' + text] || natural !== true) return;
    BT.api.call({ task: 'tts', text: text, voice: style }).then(function (r) { cache[style + '|' + text] = 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio; }).catch(function () {});
  }

  function check() {
    if (natural !== null) return Promise.resolve(natural);
    return BT.api.call({ task: 'config' })
      .then(function (c) { natural = !!c.tts; return natural; })
      .catch(function () { return false; });
  }

  BT.voice = {
    // 한 문장 말하기. done: 다 말하면(또는 멈추면 안 부름) 호출
    say: function (text, done) {
      text = String(text || '').trim();
      if (!text) { if (done) done(); return; }
      BT.voice.stop();
      var t = ++token;
      if (text.length > 590) { BT.voice.read(text, done); return; }
      speakOne(text, t, done);
    },
    // 긴 글 읽어 주기: 조각을 차례로 읽고, 다 읽으면 done
    read: function (text, done) {
      BT.voice.stop();
      var t = ++token, list = chunks(text), i = 0;
      var next = function () {
        if (t !== token) return;
        if (i >= list.length) { if (done) done(); return; }
        var c = list[i++];
        if (list[i]) prefetch(list[i]); // 다음 조각을 미리 만들어 끊김을 줄인다
        speakOne(c, t, next);
      };
      next();
    },
    style: function () { return style; },
    setStyle: function (k) { style = k; try { localStorage.setItem('booktalk.voice', k); } catch (e) {} },
    stop: function () {
      token++; onDone = null;
      emit('quiet');
      pending = null; hidePill();
      try { player.pause(); } catch (e) {}
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    },
    isNatural: function () { return natural === true; }
  };
})();
