/* 북토킹 모듈 · 아이 말 알아듣기
 * 서버에 OPENAI_API_KEY가 있으면: 녹음 → OpenAI 음성 인식 (영어·한국어·섞어 말하기 모두, 아이 발음에 강함)
 * 없거나 녹음이 안 되는 브라우저면: 브라우저 음성 인식(영어만)
 *
 * BookTalk.listen.start({ words, onText, onError, onState })  — 말하기 시작
 * BookTalk.listen.stop()                                         — 다 말했어요 (녹음 끝 → 글자로)
 * 녹음은 글자로 바꾼 뒤 바로 버린다 (아이 목소리를 저장하지 않음).
 */
(function () {
  var BT = window.BookTalk;
  var serverStt = null;
  var rec = null, chunks = [], stream = null, timer = null, sr = null, opts = null, startedAt = 0;
  var MAX_MS = 30000;
  var info = {};   // 마지막 녹음 정보 (마이크 테스트 화면에서 보여 준다)

  // 서버 설정 확인: 성공한 결과만 기억한다 (네트워크 실패는 다음에 다시 확인)
  function check() {
    if (serverStt !== null) return Promise.resolve(serverStt);
    return BT.api.call({ task: 'config' })
      .then(function (c) { serverStt = !!c.stt; return serverStt; })
      .catch(function () { return false; });
  }
  setTimeout(check, 0); // 첫 버튼을 누르기 전에 미리 확인해 둔다

  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return '';
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { reject(new Error('녹음을 읽지 못했어요')); };
      fr.readAsDataURL(blob);
    });
  }

  // 말이 끝나면 자동으로 녹음을 마친다: 소리 크기를 보고, 말한 뒤 1.3초 조용하면 끝 (8초 동안 아무 말 없으면 끝)
  var vad = null, actx = null;
  // 휴대폰은 누른 순간에 만든 AudioContext만 소리를 읽을 수 있어서, 버튼을 누를 때 미리 만들어 깨워 둔다
  function wakeAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!actx || actx.state === 'closed') actx = new AC();
      if (actx.state === 'suspended' && actx.resume) actx.resume().catch(function () {});
      return actx;
    } catch (e) { return null; }
  }
  function watchSilence(stream) {
    try {
      var ctx = wakeAudio();
      if (!ctx) return;
      var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      var buf = new Uint8Array(an.fftSize), spoke = false, quietSince = Date.now(), start = Date.now(), floor = 0;
      vad = { src: src, iv: setInterval(function () {
        an.getByteTimeDomainData(buf);
        var sum = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / buf.length), now = Date.now();
        if (opts && opts.onLevel) opts.onLevel(Math.min(1, rms * 8));
        info.level = Math.max(info.level || 0, Math.min(1, rms * 8));
        if (now - start < 400) { floor = Math.min(0.04, Math.max(floor, rms)); return; }   // 처음 0.4초로 주변 소음 크기를 잰다 (바로 말해도 너무 높게 잡지 않게)
        var loud = rms > Math.max(0.02, floor * 2.2);
        if (loud) { spoke = true; quietSince = now; }
        if (spoke && now - quietSince > 1300) BT.listen.stop();
        else if (!spoke && now - start > 8000) BT.listen.stop();
      }, 100) };
    } catch (e) { vad = null; }
  }
  function stopVad() {
    if (!vad) return;
    clearInterval(vad.iv);
    try { vad.src.disconnect(); } catch (e) {}
    vad = null;
  }

  function cleanup() {
    clearTimeout(timer); timer = null;
    stopVad();
    if (sr) { try { sr.onend = sr.onresult = sr.onerror = null; sr.abort(); } catch (e) {} sr = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    rec = null; chunks = [];
  }

  function state(s) { opts && opts.onState && opts.onState(s); }
  function fail(msg) { cleanup(); state('idle'); opts && opts.onError && opts.onError(msg); }

  function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (s) {
        stream = s;
        var mime = pickMime();
        rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          var type = (rec && rec.mimeType) || mime || 'audio/webm';
          var blob = new Blob(chunks, { type: type });
          var dur = startedAt ? Date.now() - startedAt : 0;
          info = { path: 'server', mime: type, bytes: blob.size, ms: dur, level: info.level || 0 };
          cleanup();
          if (blob.size < 1200) { state('idle'); opts.onError && opts.onError('잘 듣지 못했어요. 조금 더 크게 말해 볼까?'); return; }
          state('thinking');
          toBase64(blob)
            .then(function (b64) { return BT.api.call({ task: 'transcribe', audio: b64, mime: type, words: opts.words || [], durationMs: dur }); })
            .then(function (r) {
              state('idle');
              if (!r.text) { opts.onError && opts.onError('잘 듣지 못했어요. 다시 말해 볼까?'); return; }
              opts.onText && opts.onText(r.text);
            })
            .catch(function (er) { fail('말을 글자로 바꾸지 못했어요: ' + er.message); });
        };
        rec.start();
        startedAt = Date.now();
        state('listening');
        timer = setTimeout(function () { BT.listen.stop(); }, MAX_MS);
        watchSilence(s);
      })
      .catch(function (e) {
        var n = e && e.name;
        fail(n === 'NotAllowedError' || n === 'SecurityError' ? '마이크 사용이 막혀 있어요. 주소창 왼쪽 자물쇠 → 권한 → 마이크를 「허용」으로 바꿔 주세요.'
          : n === 'NotFoundError' ? '마이크를 찾지 못했어요.'
          : n === 'NotReadableError' ? '다른 앱이 마이크를 쓰고 있어요. 통화나 녹음 앱을 끄고 다시 눌러 주세요.'
          : '마이크를 켜지 못했어요 (' + (n || '알 수 없음') + ')');
      });
  }

  function startBrowser() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { fail('이 브라우저는 음성 인식을 지원하지 않아요. 아래 칸에 써 주세요.'); return; }
    sr = new SR();
    sr.lang = 'en-US'; sr.interimResults = false; sr.maxAlternatives = 1;
    var got = false;
    info = { path: 'browser' };
    sr.onresult = function (ev) { got = true; var t = ev.results[0][0].transcript; cleanup(); state('idle'); opts.onText && opts.onText(t); };
    sr.onerror = function (ev) { fail(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? '마이크 사용을 허용해 주세요.' : '잘 듣지 못했어요. 다시 말해 볼까?'); };
    sr.onend = function () { if (!got) { cleanup(); state('idle'); } };
    state('listening');
    timer = setTimeout(function () { fail('잘 듣지 못했어요. 다시 눌러서 말해 볼까?'); }, 15000); // 끝 신호가 안 와도 버튼이 멈추지 않게
    try { sr.start(); } catch (e) { fail('음성 인식을 시작하지 못했어요. 아래 칸에 써 주세요.'); }
  }

  BT.listen = {
    start: function (o) {
      opts = o || {};
      if (rec || sr) cleanup(); // 이전 녹음이 끝나지 않고 남아 있으면 정리하고 새로 시작
      if (BT.voice) BT.voice.stop();
      info = {};
      wakeAudio();
      // 이미 확인된 경우에는 기다리지 않고 바로 시작한다 (누른 순간에 마이크를 켜야 휴대폰에서 잘 된다)
      if (serverStt === true && canRecord()) { startRecording(); return; }
      check().then(function (ok) { if (ok && canRecord()) startRecording(); else startBrowser(); });
    },
    stop: function () {
      stopVad();
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) { fail('녹음을 멈추지 못했어요'); } return; }
      if (sr) { try { sr.stop(); } catch (e) {} }
    },
    isActive: function () { return !!(rec || sr); },
    info: function () { return info; },
    mode: function () { return serverStt === true && canRecord() ? 'server' : 'browser'; },
    isNatural: function () { return serverStt === true; },
    canRecord: canRecord,
    hasBrowserStt: function () { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  };
})();
