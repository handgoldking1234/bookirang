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

  function browserSay(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.92;
      u.onstart = function () { emit('speak'); };
      u.onend = u.onerror = function () { emit('quiet'); };
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function play(src) {
    try { player.pause(); player.src = src; var p = player.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  function check() {
    if (natural !== null) return Promise.resolve(natural);
    return BT.api.call({ task: 'config' })
      .then(function (c) { natural = !!c.tts; return natural; })
      .catch(function () { natural = false; return false; });
  }

  BT.voice = {
    say: function (text) {
      text = String(text || '').trim();
      if (!text) return;
      BT.voice.stop();
      if (cache[text]) { play(cache[text]); return; }
      check().then(function (ok) {
        if (!ok) { browserSay(text); return; }
        BT.api.call({ task: 'tts', text: text })
          .then(function (r) { cache[text] = 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio; play(cache[text]); })
          .catch(function () { browserSay(text); });
      });
    },
    stop: function () {
      emit('quiet');
      try { player.pause(); } catch (e) {}
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    },
    isNatural: function () { return natural === true; }
  };
})();
