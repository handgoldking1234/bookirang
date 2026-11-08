// 북토킹 모듈 · 서버 로직 (프레임워크 무관)
// 어떤 서버(Vercel, Next.js API Route, Supabase Edge 등)에서도 handleBookTalk(body, options)만 부르면 된다.
// options: {
//   apiKey     (필수) Anthropic 키
//   ocrModel   (선택) 사진 글 읽기 모델, 기본 claude-sonnet-5-5
//   chatModel  (선택) 대화·리포트 모델, 기본 claude-haiku-5-5
//   model      (선택) 지정하면 위 두 모델을 모두 이 값으로
//   openaiKey  (선택) 있으면 도란이 목소리를 OpenAI 음성으로 (없으면 브라우저 목소리)
//   ttsModel, ttsVoice (선택) 기본 gpt-4o-mini-tts, coral
//   sttModel   (선택) 아이 말 알아듣기 모델, 기본 gpt-4o-mini-transcribe (openaiKey 필요)
// }
// 주제를 벗어나지 않게: plan(수업 계획표) → chat은 계획표의 '현재 질문'만 보고 답하고,
// 몇 번째 질문인지·몇 번 벗어났는지는 서버가 정한다.

const API_URL = 'https://api.anthropic.com/v1/messages';
const TTS_URL = 'https://api.openai.com/v1/audio/speech';
const STT_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_OCR_MODEL = 'claude-sonnet-5-5';
const DEFAULT_CHAT_MODEL = 'claude-haiku-5-5';
let OPTS = {};

const LEVELS = {
  1: '초급: 아주 짧고 쉬운 문장(5단어 안팎), 예/아니오나 고르기 질문 위주',
  2: '초중급: 짧은 문장, 기본 어휘, 이유를 한 번만 묻기',
  3: '중급: 초등 고학년 수준 문장, 이유와 생각을 묻기',
  4: '중상급: 조금 더 긴 문장, 비교·예측·의견 질문',
  5: '상급: 자연스러운 원어민 속도의 어휘, 비판적 사고 질문'
};

function levelText(level) {
  return LEVELS[level] || LEVELS[3];
}

async function callClaude({ system, messages, maxTokens = 1024, model, temperature }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': OPTS.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(Object.assign({ model, max_tokens: maxTokens, system, messages }, temperature == null ? {} : { temperature }))
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('Claude API 오류 ' + res.status);
    throw new Error(msg);
  }
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('응답을 읽지 못했어요');
  return JSON.parse(text.slice(start, end + 1));
}

// 1) 사진 분석: 본문 추출 + 주제 + 핵심 단어 + 질문
async function analyze(body) {
  const { image, mediaType, level } = body;
  if (!image) throw new Error('이미지가 없어요');
  const system =
    '너는 초등학생 영어 독서 튜터를 돕는 분석기야. 사진 속 영어 책·신문 페이지를 읽고 반드시 JSON 하나만 출력해. ' +
    '설명 문장이나 코드블록 없이 JSON만.';
  const prompt =
    `아이 레벨: ${levelText(level)}\n` +
    '다음 형식의 JSON으로 답해:\n' +
    '{"ok":true,"title":"글 제목(없으면 내용으로 짧게 지은 영어 제목)",' +
    '"topic":"한국어 한 문장 주제","difficulty":"쉬움|딱 맞아요|어려움",' +
    '"excerpt":"본문 앞부분 2~3문장(영어 원문 그대로)",' +
    '"passage":"읽을 수 있는 본문 전체(영어, 최대 1500자)",' +
    '"words":[{"en":"핵심 단어나 표현","ko":"뜻"}] (5개),' +
    '"opening":"아이에게 처음 건넬 영어 질문 1개(마음 열기, 레벨에 맞게)"}\n' +
    '영어 글이 아니거나 글자를 읽을 수 없으면 {"ok":false,"reason":"한국어 이유"} 만 출력해.';
  const text = await callClaude({
    system,
    maxTokens: 2000,
    model: OPTS.ocrModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } },
        { type: 'text', text: prompt }
      ]
    }]
  });
  return parseJson(text);
}

// 2) 수업 계획표: 대화 전에 질문 6개·목표 표현 3개를 먼저 정한다 (주제 고정의 핵심)
//    source: 'book'(책 올리기) | 'topic'(오늘의 주제) | 'textbook'(교과서 단원) | 'novel'(원서 제목·챕터)
async function plan(body) {
  const { source, level } = body;
  const title = String(body.title || '').slice(0, 120);
  const passage = String(body.passage || '').slice(0, 3000);
  const extra = String(body.extra || '').slice(0, 300);
  let material;
  if (source === 'topic') material = `오늘의 주제: "${title}" (${extra}). 아이 자신의 경험과 생각을 묻는 대화.`;
  else if (source === 'textbook') material = `초등 영어 교과서 단원 주제: "${title}". 핵심 표현: ${extra}. 이 표현을 실제로 써 보게 하는 대화.`;
  else if (source === 'novel') material = `영어 원서: "${title}" ${extra}. 본문이 없으니 줄거리를 지어내지 말고, 아이가 읽은 내용을 스스로 말하게 묻는 대화.`;
  else material = `책 제목: ${title}\n책 본문:\n${passage}`;
  const system = '너는 초등 영어 말하기 수업 설계자야. 반드시 JSON 하나만 출력해.';
  const prompt =
    `아이 레벨: ${levelText(level)}\n${material}\n\n` +
    '다음 형식으로 12분짜리 대화 계획을 만들어:\n' +
    '{"title":"영어 제목","topic":"한국어 한 문장 주제",' +
    '"goals":[{"en":"이번에 써 볼 영어 표현(문장 틀, 예: I think ... because ...)","ko":"뜻"}] (정확히 3개),' +
    '"words":[{"en":"핵심 단어","ko":"뜻"}] (5개),' +
    '"questions":[{"stage":"마음 열기|내용 확인|생각 말하기","q":"영어 질문 1문장","hint":"아이가 막힐 때 쓸 영어 시작 문장"}] ' +
    '(정확히 6개: 마음 열기 1, 내용 확인 2, 생각 말하기 3. 목표 표현을 쓰게 되는 질문으로)}';
  const out = parseJson(await callClaude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 1400, model: OPTS.chatModel, temperature: 0.5 }));
  out.questions = (out.questions || []).filter((q) => q && q.q).slice(0, 6);
  if (!out.questions.length) throw new Error('대화 계획을 만들지 못했어요');
  out.goals = (out.goals || []).slice(0, 3);
  out.words = (out.words || []).slice(0, 5);
  out.source = source || 'book';
  return out;
}

// 답이 길어지거나 형식이 깨지면 다듬는다 (아이용: 최대 3문장, 질문은 끝에 하나)
function tidyReply(text, fallbackQ) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = (t.match(/[^.!?]+[.!?]+["')]*|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 3) t = parts.slice(0, 2).join(' ').trim() + ' ' + (parts.filter((x) => /\?/.test(x)).pop() || parts[2]).trim();
  if (!t) t = fallbackQ || 'Can you tell me more?';
  return t;
}

// 3) 대화: 계획표의 '현재 질문'에만 집중해서 답한다
//    서버가 step(몇 번째 질문)과 off(연속으로 벗어난 횟수)를 관리하고 결과를 돌려준다.
async function chat(body) {
  const p = body.plan;
  if (!p || !Array.isArray(p.questions) || !p.questions.length) return chatLegacy(body);
  const qs = p.questions;
  const step = Math.min(Math.max(0, Number(body.step) || 0), qs.length - 1);
  const off = Number(body.off) || 0;
  const cur = qs[step];
  const next = qs[step + 1];
  const isLast = !next;
  const history = (body.history || []).slice(-6); // 최근 3번 주고받은 것만 (길어질수록 헛소리가 늘어난다)
  const kidSoFar = (body.history || []).filter((m) => m.role === 'kid').map((m) => m.text).join(' / ').slice(-600);
  const goals = (p.goals || []).map((g, i) => `${i}: ${g.en}`).join(' | ');
  const mustMove = off >= 1; // 이번에도 벗어나면 다음 질문으로 넘어간다

  const system =
    '너는 초등학생과 영어로 이야기하는 다정한 AI 튜터 "Doran(도란이)"이야. 정해진 수업 계획을 절대 벗어나지 마. ' +
    `아이 레벨: ${levelText(p.level || body.level)}. 오늘 주제: ${p.title} (${p.topic || ''}).\n` +
    `지금 질문(${step + 1}/${qs.length}, ${cur.stage}): "${cur.q}"\n` +
    (isLast ? '이게 마지막 질문이야.\n' : `다음 질문: "${next.q}"\n`) +
    `목표 표현: ${goals}\n아이가 지금까지 한 말: ${kidSoFar || '(없음)'}\n` +
    '규칙:\n' +
    '1) 답은 영어로 1~2문장 + 질문 하나. 쉬운 말로. 주제와 상관없는 새 이야기를 꺼내지 마.\n' +
    '2) 아이가 틀려도 지적하지 말고 바른 표현으로 자연스럽게 되받아 말해(리캐스트).\n' +
    '3) 아이가 지금 질문에 답했으면 짧게 반응하고 ' + (isLast ? '칭찬하며 마무리 인사를 해 (질문 없이). ' : '"다음 질문"을 물어. ') + 'advance=true.\n' +
    '4) 답이 너무 짧거나 애매하면 같은 질문을 더 쉽게 바꿔 다시 물어. advance=false.\n' +
    '5) 아이가 주제와 상관없는 말을 하면 한 문장으로 받아 주고 지금 주제로 이어 붙여. onTopic=false. ' +
    (mustMove ? '이미 한 번 벗어났으니 이번엔 받아 주고 바로 ' + (isLast ? '마무리해' : '"다음 질문"으로 넘어가') + '. advance=true.\n' : '\n') +
    '6) 아이가 한국어로(또는 한국어·영어를 섞어) 말해도 괜찮아. 주제에 맞는 말이면 onTopic=true로 받아 주고, ' +
    '"Oh, you mean ...!"처럼 그 뜻을 쉬운 영어 문장으로 말해 준 뒤 따라 말해 보게 해. 이때 fix에 그 영어 문장을 넣고 korean=true, advance=false. ' +
    '아이가 그 문장을 영어로 따라 하면 칭찬하고 다음으로 넘어가(advance=true).\n' +
    '7) 위험하거나 아이에게 맞지 않는 이야기는 하지 말고 주제로 돌아와.\n' +
    '반드시 JSON 하나만 출력: {"reply":"도란이의 영어 답","fix":"아이 마지막 문장의 바른 형태(고칠 게 없으면 빈 문자열)",' +
    '"onTopic":true,"advance":false,"korean":false,"usedGoals":[아이 마지막 말에서 쓴 목표 표현 번호들]}';
  const messages = history.map((m) => ({ role: m.role === 'kid' ? 'user' : 'assistant', content: m.text }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) messages.push({ role: 'user', content: '(대화 시작)' });

  let r;
  try {
    r = parseJson(await callClaude({ system, messages, maxTokens: 500, model: OPTS.chatModel, temperature: 0.4 }));
  } catch (e) {
    // 형식이 깨지면 한 번만 다시 (더 보수적으로)
    r = parseJson(await callClaude({ system, messages, maxTokens: 500, model: OPTS.chatModel, temperature: 0 }));
  }
  const onTopic = r.onTopic !== false;
  let advance = !!r.advance;
  let newOff = onTopic ? 0 : off + 1;
  if (newOff >= 2) { advance = true; newOff = 0; }      // 두 번 연속 벗어나면 서버가 강제로 넘긴다
  let reply = tidyReply(r.reply, cur.q);
  const done = advance && isLast;
  const newStep = advance && !isLast ? step + 1 : step;
  if (advance && !isLast && !/\?/.test(reply)) reply += ' ' + next.q;   // 넘어가는데 질문이 빠졌으면 붙인다
  const used = (Array.isArray(r.usedGoals) ? r.usedGoals : []).map(Number).filter((n) => n >= 0 && n < (p.goals || []).length);
  return {
    reply, fix: r.fix || '', korean: !!r.korean, onTopic, step: newStep, off: newOff, done, usedGoals: used,
    stage: done ? '마무리' : qs[newStep].stage, hint: qs[newStep].hint || ''
  };
}

// 계획표 없이 부르는 예전 방식 (하위 호환)
async function chatLegacy(body) {
  const { passage, title, level, history, kidTurns } = body;
  const turns = Number(kidTurns) || 0;
  const system =
    '너는 초등학생과 영어로 책 이야기를 나누는 다정한 AI 튜터 "Doran(도란이)"이야. ' +
    `아이 레벨: ${levelText(level)}. ` +
    '규칙: 1) 답은 영어로 1~2문장, 마지막은 질문 하나. 2) 아이가 틀려도 지적하지 말고 바른 표현으로 자연스럽게 되받아 말해(리캐스트). ' +
    '3) 질문 순서: 마음 열기 → 내용 확인 1~2개 → 생각·의견 묻기 2~3개. 4) 책과 관계없는 이야기로 새면 부드럽게 책으로 돌아와. ' +
    '5) 아이가 한국어로 답하면 그 뜻을 영어로 바꿔 보여 주고 따라 말해 보게 해. 6) 안전하지 않거나 아이에게 맞지 않는 주제는 다루지 마. ' +
    `7) 아이가 지금까지 ${turns}번 말했어. 6번 이상이면 칭찬하며 마무리하고 done을 true로 해. ` +
    '반드시 JSON 하나만 출력: {"reply":"튜터의 영어 답","fix":"아이 마지막 문장의 바른 형태(고칠 게 없으면 빈 문자열)",' +
    '"stage":"마음 열기|내용 확인|생각 말하기|마무리","hint":"아이가 막힐 때 쓸 영어 시작 문장","done":false}\n\n' +
    `책 제목: ${title || ''}\n책 본문:\n${(passage || '').slice(0, 3000)}`;
  const messages = (history || []).map((m) => ({
    role: m.role === 'kid' ? 'user' : 'assistant',
    content: m.text
  }));
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(대화 시작)' });
  const text = await callClaude({ system, messages, maxTokens: 600, model: OPTS.chatModel });
  return parseJson(text);
}

// 4) 리포트: 대화 전체를 보고 학부모 리포트
async function report(body) {
  const { title, level, history } = body;
  const transcript = (history || []).map((m) => (m.role === 'kid' ? 'Child: ' : 'Tutor: ') + m.text).join('\n');
  const system = '너는 초등 영어 북토킹 결과를 학부모에게 알려 주는 리포트 작성기야. 반드시 JSON 하나만 출력해.';
  const prompt =
    `책: ${title}\n아이 레벨: ${levelText(level)}\n대화:\n${transcript}\n\n` +
    '형식: {"praise":"잘한 점 한국어 1~2문장(아이가 실제로 한 말을 근거로)",' +
    '"fixes":[{"from":"아이가 말한 문장","to":"자연스러운 문장","why":"한국어 짧은 이유"}] (최대 3개, 없으면 빈 배열),' +
    '"expressions":["새로 배운 영어 표현"] (최대 5개),' +
    '"overused":{"word":"아이가 자주 쓴 쉬운 단어(없으면 빈 문자열)","alternatives":["대신 쓸 말 3개"]},' +
    '"comprehension":"내용 이해 정도 한국어 한 문장",' +
    '"nextTip":"다음 북토킹을 위한 한국어 팁 한 문장"}';
  const text = await callClaude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 1200, model: OPTS.chatModel });
  return parseJson(text);
}

// 5) 도란이 목소리: 영어 문장 → mp3 (OpenAI)
async function tts(body) {
  const text = String(body.text || '').slice(0, 600);
  if (!text) throw new Error('읽을 문장이 없어요');
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + OPTS.openaiKey },
    body: JSON.stringify({
      model: OPTS.ttsModel || 'gpt-4o-mini-tts',
      voice: OPTS.ttsVoice || 'coral',
      input: text,
      instructions: 'You are Doran, a warm and friendly English reading tutor for Korean elementary school children. Speak clearly, a little slowly, cheerfully, with natural American pronunciation.',
      response_format: 'mp3'
    })
  });
  if (!res.ok) {
    let msg = 'OpenAI 음성 오류 ' + res.status;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    throw new Error(msg);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' };
}

// 6) 아이 말 알아듣기: 녹음 → 영어 문장 (OpenAI). 계획표의 단어를 알려 주면 더 잘 알아듣는다.
async function transcribe(body) {
  if (!body.audio) throw new Error('녹음이 없어요');
  const buf = Buffer.from(String(body.audio), 'base64');
  if (buf.length > 4 * 1024 * 1024) throw new Error('녹음이 너무 길어요');
  const mime = String(body.mime || 'audio/webm').split(';')[0];
  const ext = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' }[mime] || 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'speech.' + ext);
  form.append('model', OPTS.sttModel || 'gpt-4o-mini-transcribe');
  const words = (body.words || []).slice(0, 20).join(', ');
  form.append('prompt', 'A Korean elementary school child is practicing English. The child may speak English, Korean, or mix both' + (words ? '. English words that may appear: ' + words : '') + '. Write Korean in Hangul and keep the child\'s English grammar mistakes as spoken.');
  const res = await fetch(STT_URL, { method: 'POST', headers: { authorization: 'Bearer ' + OPTS.openaiKey }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || ('OpenAI 음성 인식 오류 ' + res.status));
  return { text: String(data.text || '').trim() };
}

async function handleBookTalk(body, options) {
  const o = options || {};
  OPTS = Object.assign({}, o, {
    ocrModel: o.model || o.ocrModel || DEFAULT_OCR_MODEL,
    chatModel: o.model || o.chatModel || DEFAULT_CHAT_MODEL
  });
  if (body.task === 'config') return { tts: !!OPTS.openaiKey, stt: !!OPTS.openaiKey };
  if (body.task === 'transcribe') {
    if (!OPTS.openaiKey) throw new Error('서버에 OPENAI_API_KEY가 설정되지 않았어요');
    return transcribe(body);
  }
  if (body.task === 'tts') {
    if (!OPTS.openaiKey) throw new Error('서버에 OPENAI_API_KEY가 설정되지 않았어요');
    return tts(body);
  }
  if (!OPTS.apiKey) throw new Error('서버에 ANTHROPIC_API_KEY가 설정되지 않았어요');
  if (body.task === 'analyze') return analyze(body);
  if (body.task === 'plan') return plan(body);
  if (body.task === 'chat') return chat(body);
  if (body.task === 'report') return report(body);
  throw new Error('알 수 없는 요청이에요');
}

module.exports = { handleBookTalk };
