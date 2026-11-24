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
const usage = require('./usage');
const mail = require('./mail');

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

// 답 형식(JSON 스키마). output_config.format(구조화된 출력)으로 보내면 API가 항상 스키마에 맞는 JSON을 돌려준다
// (글로 JSON을 쓰게 하면 책 속 따옴표 때문에 형식이 깨질 수 있다. 최신 모델은 tool_choice 강제를 받지 않는다)
const S = { str: { type: 'string' }, bool: { type: 'boolean' } };
const obj = (properties, required) => ({ type: 'object', properties, required: required || Object.keys(properties), additionalProperties: false });
const WORDS = { type: 'array', items: obj({ en: S.str, ko: S.str }) };
const SCHEMA = {
  analyze: obj({ ok: S.bool, reason: S.str, title: S.str, topic: S.str, difficulty: S.str, excerpt: S.str, passage: S.str, words: WORDS, opening: S.str }),
  plan: obj({ title: S.str, topic: S.str, goals: WORDS, words: WORDS,
    questions: { type: 'array', items: obj({ stage: S.str, teach: S.str, teachKo: S.str, q: S.str, hint: S.str }) } }),
  // 대화는 빨리 답해야 해서 도란이 답(chat)만 먼저 만들고, 고친 문장(fix)·한국어 번역(gloss)은 따로 동시에 만든다
  chat: obj({ reply: S.str, starter: S.str, ko: S.str, onTopic: S.bool, advance: S.bool, korean: S.bool,
    usedGoals: { type: 'array', items: { type: 'integer' } } }),
  fix: obj({ fix: S.str, why: S.str }),
  word: obj({ ok: S.bool, word: S.str, ipa: S.str, pos: S.str, ko: S.str, example: S.str, exampleKo: S.str }),
  gloss: obj({ ko: S.str }),
  period: obj({ summary: S.str, strengths: { type: 'array', items: S.str }, improve: { type: 'array', items: S.str }, nextPlan: S.str, parentTip: S.str }),
  chatLegacy: obj({ reply: S.str, fix: S.str, stage: S.str, hint: S.str, done: S.bool }),
  report: obj({ praise: S.str,
    fixes: { type: 'array', items: obj({ from: S.str, to: S.str, why: S.str }) },
    expressions: { type: 'array', items: S.str },
    overused: obj({ word: S.str, alternatives: { type: 'array', items: S.str } }),
    comprehension: S.str, nextTip: S.str })
};

async function callClaude(opts) {
  // 최신 모델은 답하기 전에 생각하는 데 토큰을 쓰므로, 답이 비면 여유를 두 배로 늘려 한 번 더 시도한다
  let r = await callClaudeOnce(opts);
  if (!r.text.trim() && r.stop === 'max_tokens') r = await callClaudeOnce(Object.assign({}, opts, { maxTokens: Math.min(16000, (opts.maxTokens || 1024) * 2) }));
  if (!r.text.trim()) throw new Error('Claude 답이 비어 있어요 (' + (r.stop || '이유 모름') + ')');
  return r.text;
}

// 대화(fast) 호출은 '생각'을 끈다. 최신 모델은 기본으로 답하기 전에 생각을 해서, 대답 한 번에 몇 초씩 더 걸린다.
// 모델이 이 설정을 받지 않으면(400) 한 번만 설정 없이 다시 보내고, 이 서버가 켜져 있는 동안은 다시 시도하지 않는다.
let fastUnsupported = false;
async function callClaudeOnce({ system, messages, maxTokens = 1024, model, json, fast }) {
  const useFast = fast && !fastUnsupported;
  const output = {};
  if (json) output.format = { type: 'json_schema', schema: json };
  if (useFast) output.effort = 'low';
  // temperature는 보내지 않는다: 최신 Claude 모델은 이 설정을 받지 않는다 (보내면 요청이 거절됨)
  const req = Object.assign({ model, max_tokens: maxTokens, system, messages },
    Object.keys(output).length ? { output_config: output } : {},
    useFast ? { thinking: { type: 'disabled' } } : {});
  const started = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': OPTS.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(req)
  });
  const data = await res.json();
  const ms = Date.now() - started;
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('Claude API 오류 ' + res.status);
    if (useFast && res.status === 400 && /thinking|effort/i.test(msg)) {
      fastUnsupported = true;
      return callClaudeOnce({ system, messages, maxTokens, model, json, fast: false });
    }
    usage.record({ provider: 'anthropic', model, ok: false, error: msg, ms });
    throw new Error(msg);
  }
  const u = data.usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  usage.record({ provider: 'anthropic', model: data.model || model, input_tokens: inTok, output_tokens: u.output_tokens || 0, cost_usd: usage.claudeCost(model, inTok, u.output_tokens || 0), ms });
  const call = (data.content || []).find((b) => b.type === 'tool_use');
  if (call && call.input && typeof call.input === 'object') {
    let input = call.input;
    // 드물게 JSON 전체를 문자열 하나에 담아 오면 풀어서 쓴다
    const keys = Object.keys(input);
    if (keys.length === 1 && typeof input[keys[0]] === 'string' && /^\s*\{/.test(input[keys[0]])) {
      try { input = JSON.parse(input[keys[0]]); } catch (e) {}
    }
    return { text: JSON.stringify(input), stop: data.stop_reason };
  }
  return { text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), stop: data.stop_reason };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { /* 아래에서 바깥 {} 만 잘라 다시 시도 */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('응답을 읽지 못했어요: ' + String(text).slice(0, 80));
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
    maxTokens: 6000,
    model: OPTS.ocrModel,
    json: SCHEMA.analyze,
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
//    source: 'book'(책 올리기) | 'topic'(오늘의 주제) | 'free'(프리토킹: 아이가 고른 주제) | 'textbook'(교과서 단원) | 'novel'(원서 제목·챕터)
async function plan(body) {
  const { source, level } = body;
  const title = String(body.title || '').slice(0, 120);
  const passage = String(body.passage || '').slice(0, 3000);
  const extra = String(body.extra || '').slice(0, 300);
  let material;
  if (source === 'topic') material = `오늘의 주제: "${title}" (${extra}). 아이 자신의 경험과 생각을 묻는 대화.`;
  else if (source === 'free') material = `프리토킹: 아이가 직접 고른 주제 "${title}" ${extra}. 아이의 경험·좋아하는 것·생각을 묻고, 아이가 말한 내용을 이어 받아 넓혀 가는 대화. ` +
    '주제가 한국어면 title은 쉬운 영어 제목으로 바꿔. 주제가 초등학생에게 맞지 않으면(폭력·공포·성인 내용 등) 비슷하고 안전한 주제로 바꿔.';
  else if (source === 'textbook') material = `초등 영어 교과서 단원 주제: "${title}". 핵심 표현: ${extra}. 이 표현을 실제로 써 보게 하는 대화.`;
  else if (source === 'novel') material = `영어 원서: "${title}" ${extra}. 본문이 없으니 줄거리를 지어내지 말고, 아이가 읽은 내용을 스스로 말하게 묻는 대화.`;
  else material = `책 제목: ${title}\n책 본문:\n${passage}`;
  const system = '너는 초등 영어 독서 수업 설계자야. 선생님(도란이)이 책 내용을 짚어 주며 아이를 이끌어 가르치는 수업을 만든다. 반드시 JSON 하나만 출력해.';
  const bookLed = source === 'book' || (source === 'textbook' && passage);
  const flow = bookLed
    ? '(정확히 6개, 이 순서로 책 내용을 중심으로 이끌어 가르쳐: ' +
      '1) 내용 확인 - 누가 나오고 무슨 일이 있었는지, 2) 내용 확인 - 본문 속 한 장면, ' +
      '3) 단어·표현 - 본문의 핵심 단어나 문장 뜻을 알려 주고 따라 말해 보게, 4) 내용 이해 - 왜/어떻게, ' +
      '5) 생각 말하기 - 등장인물의 마음이나 나라면?, 6) 생각 말하기 - 오늘 이야기를 한 문장으로 말해 보기. ' +
      '각 질문의 teach에는 질문 전에 선생님이 본문을 짚어 주는 쉬운 영어 1문장(본문 문장을 그대로 인용해도 좋아, 15단어 이내), ' +
      'teachKo에는 그 teach의 쉬운 한국어 풀이를 넣어. 본문에 없는 내용을 지어내지 마.)'
    : source === 'free'
    ? '(정확히 6개, 이 순서로: 1) 마음 열기 - 이 주제에 대해 아이가 쉽게 답할 질문, 2) 경험 말하기, 3) 자세히 말하기 - 어떻게/어디서/누구와, ' +
      '4) 좋아하는 이유 말하기, 5) 상상하기 - 만약 ~라면?, 6) 생각 말하기 - 친구에게 추천하거나 한 문장으로 정리. ' +
      '질문은 열린 질문으로, 아이 대답에 따라 이어 갈 수 있게. 질문 위주로: teach와 teachKo는 빈 문자열로 둬. q는 짧고 쉬운 질문 하나(12단어 이내).)'
    : '(정확히 6개: 마음 열기 1, 내용 확인 2, 생각 말하기 3. 목표 표현을 쓰게 되는 질문으로. ' +
      '질문 위주로: teach와 teachKo는 기본 빈 문자열, 꼭 필요할 때만 8단어 이내. q는 짧고 쉬운 질문 하나(12단어 이내).)';
  const prompt =
    `아이 레벨: ${levelText(level)}\n${material}\n\n` +
    '다음 형식으로 12분짜리 수업 계획을 만들어:\n' +
    '{"title":"영어 제목","topic":"한국어 한 문장 주제",' +
    '"goals":[{"en":"이번에 써 볼 영어 표현(문장 틀, 예: I think ... because ...)","ko":"뜻"}] (정확히 3개),' +
    '"words":[{"en":"핵심 단어","ko":"뜻"}] (5개),' +
    '"questions":[{"stage":"내용 확인|단어·표현|내용 이해|생각 말하기|마음 열기","teach":"선생님 설명(영어)","teachKo":"한국어 풀이",' +
    '"q":"영어 질문 1문장","hint":"아이가 막힐 때 쓸 영어 시작 문장"}] ' + flow +
    ' 질문은 아이가 문장으로 길게 답하게 되는 열린 질문으로 만들어(What/Why/How/Tell me about). 예·아니오로 끝나는 질문은 쓰지 마.}';
  const out = parseJson(await callClaude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 6000, model: OPTS.chatModel, json: SCHEMA.plan }));
  out.questions = (out.questions || []).filter((q) => q && q.q).slice(0, 6);
  if (!out.questions.length) throw new Error('대화 계획을 만들지 못했어요');
  out.goals = (out.goals || []).slice(0, 3);
  out.words = (out.words || []).slice(0, 5);
  out.source = source || 'book';
  return out;
}

// 답이 길어지거나 형식이 깨지면 다듬는다 (아이용: 최대 3문장, 질문은 끝에 하나)
function tidyReply(text, fallbackQ, max) {
  max = max || 3;
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = (t.match(/[^.!?]+[.!?]+["')]*|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
  if (parts.length > max) t = parts.slice(0, max - 1).join(' ').trim() + ' ' + (parts.filter((x) => /\?/.test(x)).pop() || parts[max - 1]).trim();
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
  // 말 끌어내기: 한 질문 안에서 '더 물어보기'를 몇 번 했는지(deep). 짧게 답하면 2번, 길게 답하면 1번까지 더 묻는다.
  const deep = Math.max(0, Number(body.deep) || 0);
  const kidLast = String(((body.history || []).filter((m) => m.role === 'kid').pop() || {}).text || '');
  const kidWords = (kidLast.match(/[A-Za-z][A-Za-z']*/g) || []).length;
  const shortAnswer = kidWords <= 3;
  const kidTurnsAll = (body.history || []).filter((m) => m.role === 'kid').length;
  const digLeft = kidTurnsAll >= 16 ? 0 : Math.max(0, (shortAnswer ? 2 : 1) - deep);

  const system =
    '너는 초등학생과 영어로 이야기하는 다정한 AI 튜터 "Doran(도란이)"이야. 정해진 수업 계획을 절대 벗어나지 마. ' +
    `아이 레벨: ${levelText(p.level || body.level)}. 오늘 주제: ${p.title} (${p.topic || ''}).\n` +
    ((p.passage || body.passage) ? `책 본문(이 내용으로 가르쳐, 지어내지 마): ${String(p.passage || body.passage).slice(0, 1500)}\n` : '') +
    `지금 질문(${step + 1}/${qs.length}, ${cur.stage}): "${cur.q}"\n` +
    (isLast ? '이게 마지막 질문이야.\n' : `다음 단계: 선생님 설명 "${next.teach || ''}" → 질문 "${next.q}"\n`) +
    `목표 표현: ${goals}\n아이가 지금까지 한 말: ${kidSoFar || '(없음)'}\n` +
    '규칙:\n' +
    '1) 목표는 아이가 영어로 많이 말하게 하는 것. 너는 아이보다 적게 말해. 대답은 항상 [듣기→공감→(설명)→질문] 순서, 전체 2~3문장, 한 문장 10단어 이내, 쉬운 말.\n' +
    '   ① 듣기: 아이가 한 말의 핵심을 바른 영어로 되받아 말해. 아이가 쓴 낱말을 꼭 넣어 (아이 "I like pizza" → "You like pizza!"). 틀린 곳은 지적하지 말고 이때 바르게 고쳐 말해(리캐스트).\n' +
    '   ② 공감: 그 내용에 맞는 느낌 한마디 ("That sounds yummy!", "Oh no, that\'s sad.", "Me too!"). ①과 한 문장으로 합쳐도 돼. 매번 다른 말로.\n' +
    '   ③ 설명(필요할 때만 한 문장): 아이가 틀렸거나 한국어로 말했거나 딱 맞는 낱말이 있을 때 그 표현 하나만 알려 줘 ("We say \'stretchy cheese\'."). 필요 없으면 빼. 네 이야기를 길게 하지 마.\n' +
    '   ④ 질문: 아이가 문장으로 길게 답하게 되는 열린 질문 하나 (Why / How / What happened / Tell me about ...). 예·아니오로 끝나는 질문과 한꺼번에 두 가지를 묻는 질문은 금지. 주제와 상관없는 새 이야기를 꺼내지 마.\n' +
    `2) 아이의 마지막 말은 영어 낱말 ${kidWords}개. ` + (digLeft > 0
      ? (shortAnswer
        ? '짧게 답했어. 넘어가지 말고 같은 이야기에서 더 말하게 해: 아이 말에 나온 것을 콕 집어 "Tell me more!", "Why?", "What is it like?"처럼 묻고, starter에 대답 첫마디를 넣어. advance=false.\n'
        : '잘 답했어. 아이 말 속에서 가장 궁금한 한 가지(누구와/어디서/어땠는지/왜)를 한 번 더 물어 이야기를 넓혀. advance=false. 단, 더 물을 게 없으면 3)으로.\n')
      : '이 이야기는 충분히 나눴어. 이번에는 3)대로 다음으로 넘어가.\n') +
    '3) 다음으로 넘어갈 때: ①②로 받아 준 뒤 ' + (isLast ? '오늘 이야기를 짧게 한 문장으로 정리하며 마무리 인사를 해 (질문 없이). ' : (next.teach ? '"다음 단계"의 선생님 설명을 짧게 말하고 그 질문을 물어. ' : '바로 "다음 단계" 질문을 물어. ')) + 'advance=true.\n' +
    '4) 답이 틀리거나 너무 짧거나 애매하면, 본문의 해당 문장을 짚어 주며("Let\'s look at the book: ...") 같은 질문을 더 쉽게 다시 물어. advance=false.\n' +
    '5) 아이가 주제와 상관없는 말을 하면 한 문장으로 받아 주고 지금 주제로 이어 붙여. onTopic=false. ' +
    (mustMove ? '이미 한 번 벗어났으니 이번엔 받아 주고 바로 ' + (isLast ? '마무리해' : '"다음 질문"으로 넘어가') + '. advance=true.\n' : '\n') +
    '6) 아이가 한국어로(또는 한국어·영어를 섞어) 말해도 괜찮아. 주제에 맞는 말이면 onTopic=true로 받아 주고, ' +
    '"Oh, you mean ...!"처럼 그 뜻을 쉬운 영어 문장으로 말해 준 뒤 따라 말해 보게 해. 이때 korean=true, advance=false. ' +
    '아이가 그 문장을 영어로 따라 하면 칭찬하고 다음으로 넘어가(advance=true).\n' +
    '6-1) 아이가 "한국어로 설명해줘", "무슨 뜻이야", "모르겠어", "I don\'t know", "what?"처럼 도움을 청하면, ' +
    'ko에 한국어 설명을 넣어(질문 뜻이나 본문 문장을 쉬운 한국어 1~3문장으로 풀고, 대답 첫마디 힌트도 줘). ' +
    'reply에는 더 쉬운 영어로 같은 질문을 다시 물어. onTopic=true, advance=false. 도움을 청하지 않았으면 ko는 빈 문자열.\n' +
    (p.source === 'free'
      ? '6-2) 프리토킹이야. 아이가 꺼낸 이야기가 주제 안이면 그 내용을 따라가며 한 번 더 궁금해해도 좋아(그때 advance=false). ' +
        '아이가 완전히 다른 주제로 바꾸고 싶어 하면 반갑게 받아 주고, "화면의 「주제 바꾸기」를 누르면 새 주제로 이야기할 수 있어"를 ko에 한국어로 알려 준 뒤 지금 주제로 한 번 이어 가.\n'
      : '') +
    '7) 위험하거나 아이에게 맞지 않는 이야기는 하지 말고 주제로 돌아와.\n' +
    '8) starter: 아이가 대답을 시작하기 쉬운 영어 첫마디(예: "I like it because ..."). 아이의 마지막 말이 3단어 이하였거나 한국어였으면 꼭 넣고, 아니면 빈 문자열.\n' +
    '반드시 JSON 하나만 출력: {"reply":"도란이의 영어 답","starter":"",' +
    '"ko":"","onTopic":true,"advance":false,"korean":false,"usedGoals":[아이 마지막 말에서 쓴 목표 표현 번호들]}';
  const messages = history.map((m) => ({ role: m.role === 'kid' ? 'user' : 'assistant', content: m.text }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) messages.push({ role: 'user', content: '(대화 시작)' });

  // 고친 문장은 아이 말만 보면 되므로 도란이 답과 동시에 만든다 (기다리는 시간에 더해지지 않게)
  const t0 = Date.now();
  const fixP = fixSentence(kidLast, cur.q, p.level || body.level).catch(() => ({ fix: '', why: '' }));

  let r;
  try {
    r = parseJson(await callClaude({ system, messages, maxTokens: 4000, model: OPTS.chatModel, json: SCHEMA.chat, fast: true }));
  } catch (e) {
    // 형식이 깨지면 한 번만 다시 (더 보수적으로)
    r = parseJson(await callClaude({ system, messages, maxTokens: 4000, model: OPTS.chatModel, json: SCHEMA.chat, fast: true }));
  }
  const onTopic = r.onTopic !== false;
  let advance = !!r.advance;
  let newOff = onTopic ? 0 : off + 1;
  if (newOff >= 2) { advance = true; newOff = 0; }      // 두 번 연속 벗어나면 서버가 강제로 넘긴다
  const forced = !advance && (deep >= 3 || newOff === 0 && !onTopic);
  if (!advance && deep >= 3) advance = true;             // 한 질문에 너무 오래 머물지 않게 (더 묻기는 최대 3번)
  const newDeep = advance ? 0 : deep + 1;
  let reply = tidyReply(r.reply, cur.q, advance && next && next.teach ? 4 : 3);
  if (forced && advance && !isLast) {                    // 서버가 넘긴 경우: 도란이의 되묻는 질문을 다음 질문으로 바꾼다
    const keep = (reply.match(/[^.!?]+[.!?]+/g) || []).filter((x) => !/\?/.test(x)).slice(0, 2).join(' ').trim();
    reply = (keep ? keep + ' ' : '') + (next.teach ? next.teach + ' ' : '') + next.q;
  }
  const done = advance && isLast;
  const newStep = advance && !isLast ? step + 1 : step;
  if (advance && !isLast && !/\?/.test(reply)) reply += ' ' + next.q;   // 넘어가는데 질문이 빠졌으면 붙인다
  const used = (Array.isArray(r.usedGoals) ? r.usedGoals : []).map(Number).filter((n) => n >= 0 && n < (p.goals || []).length);
  const ko = String(r.ko || '').slice(0, 400);

  // 답이 정해지면, 도란이가 처음 말할 부분의 목소리와 한국어 번역을 동시에 만든다.
  // 목소리를 같은 응답에 담아 보내면 앱이 서버를 한 번 더 부르지 않고 바로 말할 수 있다.
  const spoken = ko || reply;                       // 한국어 도움말이 있으면 그걸 먼저 말한다
  const first = firstPart(spoken);
  const audioP = body.voice && OPTS.openaiKey
    ? tts({ text: first, voice: body.voice }).then((a) => ({ text: first, audio: a.audio, mime: a.mime })).catch(() => null)
    : Promise.resolve(null);
  const glossP = ko ? Promise.resolve('') : glossKo(reply).catch(() => '');
  const t1 = Date.now();
  const [fx, gloss, audio] = await Promise.all([fixP, glossP, audioP]);

  const out = {
    reply, ko, koGloss: ko ? '' : String(gloss || (advance && !isLast ? next.teachKo : '') || '').slice(0, 300),
    starter: done ? '' : String(r.starter || '').slice(0, 80), deep: newDeep,
    fix: fx.fix || '', why: fx.fix ? String(fx.why || '').slice(0, 200) : '', korean: !!r.korean, onTopic, step: newStep, off: newOff, done, usedGoals: used,
    stage: done ? '마무리' : qs[newStep].stage, hint: qs[newStep].hint || ''
  };
  if (audio) out.audio = audio;
  out.timing = { answer: t1 - t0, voice: Date.now() - t1 };   // 걸린 시간(ms): 도란이 답 / 첫마디 목소리·번역
  return out;
}

// 말할 글의 앞부분: 첫 문장(너무 짧으면 다음 문장까지). 이 부분 목소리만 먼저 만들어 바로 들려주고, 나머지는 그동안 만든다.
function firstPart(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = t.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [t];
  let out = '';
  for (const s of parts) {
    out = out ? out + ' ' + s.trim() : s.trim();
    if (out.length >= 20) break;
  }
  return out || t;
}

// 아이 마지막 말 → 더 자연스러운 영어 문장과 이유 (도란이 답과 동시에 만든다)
async function fixSentence(kidText, question, level) {
  const said = String(kidText || '').trim().slice(0, 300);
  if (!said) return { fix: '', why: '' };
  const prompt =
    `아이 레벨: ${levelText(level)}\n선생님 질문: "${question}"\n아이가 한 말: "${said}"\n` +
    'fix: 아이 말을 더 자연스럽고 바른 영어 문장 하나로 (이미 자연스러우면 빈 문자열). 아이가 한국어로 말했거나 섞어 말했으면 그 뜻의 쉬운 영어 문장.\n' +
    'why: fix가 있으면 왜 그렇게 말하면 좋은지 초등학생이 이해할 한국어 1~2문장, 없으면 빈 문자열.\n' +
    'JSON 하나만 출력: {"fix":"","why":""}';
  return parseJson(await callClaude({ system: '너는 초등학생의 영어 문장을 다정하게 다듬어 주는 선생님이야. 반드시 JSON 하나만 출력해.',
    messages: [{ role: 'user', content: prompt }], maxTokens: 1500, model: OPTS.chatModel, json: SCHEMA.fix, fast: true }));
}

// 도란이 영어 답 → 초등학생 말투 한국어 번역
async function glossKo(reply) {
  const r = parseJson(await callClaude({ system: '너는 영어를 초등학생 말투의 자연스러운 한국어로 옮기는 번역가야. 반드시 JSON 하나만 출력해.',
    messages: [{ role: 'user', content: '다음 영어를 한국어로 번역해. {"ko":"번역"} 형식으로:\n' + String(reply).slice(0, 600) }],
    maxTokens: 1500, model: OPTS.chatModel, json: SCHEMA.gloss, fast: true }));
  return String(r.ko || '');
}

// 3-1) 단어 카드: 아이가 누른 낱말 → 기본형, 발음 기호, 뜻, 쉬운 예문 (대화 중에 바로 떠야 해서 생각 없이 빠르게)
async function word(body) {
  const w = String(body.word || '').trim().replace(/[’]/g, "'");
  if (!/^[A-Za-z][A-Za-z'-]{0,30}$/.test(w)) throw new Error('영어 낱말이 아니에요');
  const sentence = String(body.sentence || '').replace(/\s+/g, ' ').slice(0, 300);
  const prompt =
    `아이 레벨: ${levelText(body.level)}\n누른 낱말: "${w}"\n` + (sentence ? `이 낱말이 나온 문장: "${sentence}"\n` : '') +
    '초등학생 영어 단어 카드를 만들어.\n' +
    'word: 사전에 실리는 기본형 소문자 (built→build, kids→kid, you\'ll→you\'ll 그대로, 고유명사는 원래 대문자).\n' +
    'ipa: word의 미국식 발음 기호 (슬래시 포함, 예: /bɪld/).\npos: 품사 한국어 한 낱말 (명사, 동사, 형용사 등).\n' +
    'ko: 문장 속 뜻에 맞는 쉬운 한국어 뜻 (짧게, 쉼표로 2개까지).\n' +
    'example: word를 그대로 넣은 쉬운 영어 예문 1개 (12단어 이내, 레벨에 맞게, 아이 생활과 가까운 내용).\nexampleKo: 예문의 자연스러운 한국어 번역.\n' +
    '영어 낱말이 아니면 ok=false로 하고 나머지는 빈 문자열.\nJSON 하나만 출력.';
  const r = parseJson(await callClaude({ system: '너는 초등학생용 영어 단어장을 만드는 선생님이야. 반드시 JSON 하나만 출력해.',
    messages: [{ role: 'user', content: prompt }], maxTokens: 1000, model: OPTS.chatModel, json: SCHEMA.word, fast: true }));
  if (r.ok === false || !r.word) throw new Error('뜻을 찾지 못했어요');
  return { word: String(r.word).slice(0, 40), ipa: String(r.ipa || '').slice(0, 60), pos: String(r.pos || '').slice(0, 10),
    ko: String(r.ko || '').slice(0, 60), example: String(r.example || '').slice(0, 160), exampleKo: String(r.exampleKo || '').slice(0, 160) };
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
  const text = await callClaude({ system, messages, maxTokens: 4000, model: OPTS.chatModel, json: SCHEMA.chatLegacy, fast: true });
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
  const text = await callClaude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 6000, model: OPTS.chatModel, json: SCHEMA.report });
  return parseJson(text);
}

// 4-1) 기간 리포트 분석 (주간·월간·분기·6개월·1년): 숫자는 클라이언트가 계산해 보내고, 해석만 Claude가 한다
const KIND_KO = { week: '주간', month: '월간', quarter: '분기', half: '6개월', year: '1년' };
async function period(body) {
  const kind = KIND_KO[body.kind] ? body.kind : 'week';
  const pick = (o) => { o = o || {}; const r = {}; ['sessions', 'days', 'minutes', 'sentences', 'avgLen', 'newWords', 'goalRate', 'self', 'ratio', 'koreanTurns'].forEach((k) => { if (o[k] != null) r[k] = Number(o[k]) || 0; }); return r; };
  const sample = (arr, n, len) => (Array.isArray(arr) ? arr : []).slice(0, n).map((x) => String(x).slice(0, len));
  const fixes = (Array.isArray(body.fixes) ? body.fixes : []).slice(0, 12).map((f) => `${String(f.from || '').slice(0, 100)} → ${String(f.to || '').slice(0, 100)}`).join('\n');
  const prompt =
    `${KIND_KO[kind]} 리포트 (${String(body.range || '').slice(0, 40)}), 아이 레벨: ${levelText(body.level)}\n` +
    `이번 기간 숫자: ${JSON.stringify(pick(body.cur))}\n바로 앞 같은 기간: ${JSON.stringify(pick(body.prev))}\n` +
    `이야기한 것: ${sample(body.titles, 20, 40).join(', ')}\n` +
    `기간 초반 아이 문장: ${sample(body.early, 6, 120).join(' / ')}\n기간 후반 아이 문장: ${sample(body.late, 6, 120).join(' / ')}\n` +
    `자주 고친 표현:\n${fixes || '(없음)'}\n\n` +
    '학부모에게 보낼 한국어 분석을 써. 숫자를 지어내지 말고 위 숫자와 문장만 근거로. 앞 기간과 비교해 달라진 점을 구체적으로. 칭찬을 먼저, 부족한 점은 다음에 할 일로 바꿔서.\n' +
    '형식: {"summary":"한눈에 보기 2문장","strengths":["좋아진 점, 근거 포함 한 문장"] (2~3개),"improve":["더 연습하면 좋은 점 한 문장"] (1~2개),' +
    '"nextPlan":"다음 기간 학습 제안 1~2문장(횟수·주제 등 구체적으로)","parentTip":"집에서 부모가 도와줄 수 있는 쉬운 방법 1~2문장"}';
  const text = await callClaude({ system: '너는 초등 영어 말하기 학습 기록을 분석해 학부모에게 알려 주는 리포트 작성기야. 반드시 JSON 하나만 출력해.',
    messages: [{ role: 'user', content: prompt }], maxTokens: 6000, model: OPTS.chatModel, json: SCHEMA.period });
  const r = parseJson(text);
  r.strengths = (r.strengths || []).slice(0, 3); r.improve = (r.improve || []).slice(0, 2);
  return r;
}

// 5) 도란이 목소리: 영어 문장 → mp3 (OpenAI)
// 도란이 목소리 (OpenAI 기본 보이스 + 말투 지시). 클라이언트는 키만 보낸다.
const VOICES = {
  friend_f: { voice: 'nova', en: 'Sound like a cheerful, bubbly young girl about 13 years old talking with a younger friend. Casual, upbeat, playful, natural speed, clear American pronunciation.', ko: '중학생 또래 여자아이처럼 밝고 발랄하게, 친구한테 말하듯 편하게 말해.' },
  friend_m: { voice: 'verse', en: 'Sound like an energetic, friendly young boy about 13 years old talking with a younger friend. Casual, fun, confident, natural speed, clear American pronunciation.', ko: '중학생 또래 남자아이처럼 씩씩하고 신나게, 친구한테 말하듯 편하게 말해.' },
  sister:   { voice: 'coral', en: 'Sound like a kind, bright college-age older sister. Warm, soft, encouraging, slightly slow and very clear American pronunciation.', ko: '다정한 대학생 언니·누나처럼 따뜻하고 부드럽게, 또박또박 말해.' },
  brother:  { voice: 'onyx',   en: 'Sound like a relaxed, friendly college-age older brother. Warm, easygoing, encouraging, clear American pronunciation.', ko: '편안한 대학생 형·오빠처럼 다정하고 느긋하게 말해.' },
  teacher:  { voice: 'sage',  en: 'You are Doran, a warm and friendly English reading tutor for Korean elementary school children. Speak clearly, a little slowly, cheerfully, with natural American pronunciation.', ko: '너는 초등학생을 가르치는 다정한 선생님 도란이야. 자연스러운 한국어로 또박또박, 조금 천천히, 밝게 말해.' }
};

async function tts(body) {
  const text = String(body.text || '').slice(0, 600);
  if (!text) throw new Error('읽을 문장이 없어요');
  const vp = VOICES[body.voice] || (OPTS.ttsVoice ? Object.assign({}, VOICES.teacher, { voice: OPTS.ttsVoice }) : VOICES.friend_f);
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + OPTS.openaiKey },
    body: JSON.stringify({
      model: OPTS.ttsModel || 'gpt-4o-mini-tts',
      voice: vp.voice,
      input: text,
      instructions: /[가-힣]/.test(text) ? vp.ko + ' 영어 단어가 나오면 미국식 발음으로 읽어.' : vp.en,
      response_format: 'mp3'
    })
  });
  if (!res.ok) {
    let msg = 'OpenAI 음성 오류 ' + res.status;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    usage.record({ provider: 'openai', model: OPTS.ttsModel || 'gpt-4o-mini-tts', chars: text.length, ok: false, error: msg });
    throw new Error(msg);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  usage.record({ provider: 'openai', model: OPTS.ttsModel || 'gpt-4o-mini-tts', chars: text.length, cost_usd: usage.ttsCost(text.length) });
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
  const sttModel = OPTS.sttModel || 'gpt-4o-mini-transcribe';
  const seconds = Math.max(0, Math.min(120, (Number(body.durationMs) || 0) / 1000)) || buf.length / 4000; // 녹음 길이(앱이 보내 줌), 없으면 크기로 추정
  if (!res.ok) {
    const msg = (data.error && data.error.message) || ('OpenAI 음성 인식 오류 ' + res.status);
    usage.record({ provider: 'openai', model: sttModel, seconds, ok: false, error: msg });
    throw new Error(msg);
  }
  usage.record({ provider: 'openai', model: sttModel, seconds: Number(seconds.toFixed(1)), cost_usd: usage.sttCost(sttModel, seconds) });
  return { text: String(data.text || '').trim() };
}

async function handleTask(body, options) {
  const o = options || {};
  OPTS = Object.assign({}, o, {
    ocrModel: o.model || o.ocrModel || DEFAULT_OCR_MODEL,
    chatModel: o.model || o.chatModel || DEFAULT_CHAT_MODEL
  });
  if (body.task === 'config') return { claude: !!OPTS.apiKey, tts: !!OPTS.openaiKey, stt: !!OPTS.openaiKey, mail: mail.enabled() };
  if (body.task === 'mail') return mail.send(body, { childId: body.cid, ip: o.ip });
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
  if (body.task === 'word') return word(body);
  if (body.task === 'report') return report(body);
  if (body.task === 'period') return period(body);
  throw new Error('알 수 없는 요청이에요');
}

// 요청 하나를 처리하면서 그 안의 AI 호출 사용량을 모아 저장한다
async function handleBookTalk(body, options) {
  const o = options || {};
  const tracked = await usage.track(() => handleTask(body, o));
  const { out, err } = tracked;
  // 한 요청 안에서 같은 모델을 여러 번 불렀으면 한 줄로 합친다 (하루 한도는 기록 줄 수로 세기 때문)
  const rows = usage.merge(tracked.rows);
  if (rows.length) {
    const ctx = { task: body && body.task, childId: body && body.cid, app: o.app, ip: o.ip };
    // 기록은 답을 보낸 뒤에 해도 된다: 응답을 붙잡지 않도록 뒤로 미룬다 (미룰 수 없는 서버면 기다린다)
    const job = typeof o.onUsage === 'function'
      ? Promise.resolve().then(() => o.onUsage(rows, ctx)).catch(() => {})
      : usage.save(rows, ctx);
    if (!usage.later(job)) await job;
  }
  if (err) throw err;
  return out;
}

module.exports = { handleBookTalk };
