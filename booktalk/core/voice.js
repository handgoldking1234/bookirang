/* 북토킹 모듈 · 도란이 목소리
 * 서버에 OPENAI_API_KEY가 있으면 OpenAI 음성(자연스러운 목소리), 없거나 실패하면 브라우저 목소리.
 * 같은 문장은 한 번만 만들어 기억해 두고 다시 쓴다 (비용 절약).
 */
(function () {
  var BT = window.BookTalk;
  var cache = {};
  var natural = null;           // null: 아직 모름, true/false
  var player = new Audio();     // 하나를 계속 써야 아이폰·아이패드에서 자동 재생이 막히지 않는다
  var unlocked = false;
  // 말하기 시작·끝을 화면에 알린다 (도란이 입 모양 애니메이션용)
  function emit(name) { try { window.dispatchEvent(new Event('booktalk:' + name)); } catch (e) {} }
  player.addEventListener('playing', function () { if (player.src.indexOf('SUQzBAAAAAAAI1RTU0U') < 0) emit('speak'); });
  ['ended', 'pause', 'error'].forEach(function (ev) { player.addEventListener(ev, function () { emit('quiet'); }); });

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      player.src = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqq';
      var p = player.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });

  var token = 0;          // 새로 말하기 시작하면 이전 말하기(또는 늦게 도착한 음성)를 무시한다
  var onDone = null;      // 지금 말하는 문장이 끝나면 부를 함수
  function finish(t) { if (t !== token) return; var f = onDone; onDone = null; if (f) f(); }
  player.addEventListener('ended', function () { finish(token); });
  player.addEventListener('error', function () { if (player.src.indexOf('SUQzBAAAAAAAI1RTU0U') < 0) finish(token); });

  function browserSay(text, t) {
    try {
      if (!window.speechSynthesis) { finish(t); return; }
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = /[가-힣]/.test(text) ? 'ko-KR' : 'en-US'; u.rate = 0.92;
      u.onstart = function () { emit('speak'); };
      u.onend = u.onerror = function () { emit('quiet'); finish(t); };
      window.speechSynthesis.speak(u);
    } catch (e) { finish(t); }
  }

  function play(src) {
    try {
      player.pause(); player.src = src;
      var p = player.play();
      if (p && p.catch) p.catch(function () { finish(token); }); // 자동 재생이 막혀도 다음 단계는 진행
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
    if (cache[text]) { play(cache[text]); return; }
    check().then(function (ok) {
      if (t !== token) return;
      if (!ok) { browserSay(text, t); return; }
      BT.api.call({ task: 'tts', text: text })
        .then(function (r) { cache[text] = 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio; if (t === token) play(cache[text]); })
        .catch(function () { if (t === token) browserSay(text, t); });
    });
  }

  function prefetch(text) {
    if (cache[text] || natural !== true) return;
    BT.api.call({ task: 'tts', text: text }).then(function (r) { cache[text] = 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio; }).catch(function () {});
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
    stop: function () {
      token++; onDone = null;
      emit('quiet');
      try { player.pause(); } catch (e) {}
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    },
    isNatural: function () { return natural === true; }
  };
})();
