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
  var rec = null, chunks = [], stream = null, timer = null, sr = null, opts = null;
  var MAX_MS = 30000;

  function check() {
    if (serverStt !== null) return Promise.resolve(serverStt);
    return BT.api.call({ task: 'config' })
      .then(function (c) { serverStt = !!c.stt; return serverStt; })
      .catch(function () { serverStt = false; return false; });
  }

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

  function cleanup() {
    clearTimeout(timer); timer = null;
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
          cleanup();
          if (blob.size < 1200) { state('idle'); opts.onError && opts.onError('잘 듣지 못했어요. 조금 더 크게 말해 볼까?'); return; }
          state('thinking');
          toBase64(blob)
            .then(function (b64) { return BT.api.call({ task: 'transcribe', audio: b64, mime: type, words: opts.words || [] }); })
            .then(function (r) {
              state('idle');
              if (!r.text) { opts.onError && opts.onError('잘 듣지 못했어요. 다시 말해 볼까?'); return; }
              opts.onText && opts.onText(r.text);
            })
            .catch(function (er) { fail('말을 글자로 바꾸지 못했어요: ' + er.message); });
        };
        rec.start();
        state('listening');
        timer = setTimeout(function () { BT.listen.stop(); }, MAX_MS);
      })
      .catch(function () { fail('마이크 사용을 허용해 주세요.'); });
  }

  function startBrowser() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { fail('이 브라우저는 음성 인식을 지원하지 않아요. 아래 칸에 써 주세요.'); return; }
    sr = new SR();
    sr.lang = 'en-US'; sr.interimResults = false; sr.maxAlternatives = 1;
    sr.onresult = function (ev) { var t = ev.results[0][0].transcript; opts.onText && opts.onText(t); };
    sr.onerror = function (ev) { fail(ev.error === 'not-allowed' ? '마이크 사용을 허용해 주세요.' : '잘 듣지 못했어요. 다시 말해 볼까?'); };
    sr.onend = function () { sr = null; state('idle'); };
    state('listening');
    sr.start();
  }

  BT.listen = {
    start: function (o) {
      opts = o || {};
      if (rec || sr) return;
      if (BT.voice) BT.voice.stop();
      check().then(function (ok) { if (ok && canRecord()) startRecording(); else startBrowser(); });
    },
    stop: function () {
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) { fail('녹음을 멈추지 못했어요'); } return; }
      if (sr) { try { sr.stop(); } catch (e) {} }
    },
    isActive: function () { return !!(rec || sr); },
    isNatural: function () { return serverStt === true; }
  };
})();
