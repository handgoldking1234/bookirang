// 북토킹 모듈 · 서버 로직 (프레임워크 무관)
// 어떤 서버(Vercel, Next.js API Route, Supabase Edge 등)에서도 handleBookTalk(body, options)만 부르면 된다.
// options: { apiKey (필수), model (선택, 기본 claude-sonnet-5-5) }

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
let OPTS = { apiKey: '', model: DEFAULT_MODEL };

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

async function callClaude({ system, messages, maxTokens = 1024 }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': OPTS.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: OPTS.model || DEFAULT_MODEL, max_tokens: maxTokens, system, messages })
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

// 2) 대화: 아이 발화에 튜터가 답하기
async function chat(body) {
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
  const text = await callClaude({ system, messages, maxTokens: 600 });
  return parseJson(text);
}

// 3) 리포트: 대화 전체를 보고 학부모 리포트
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
  const text = await callClaude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 1200 });
  return parseJson(text);
}

async function handleBookTalk(body, options) {
  OPTS = Object.assign({ model: DEFAULT_MODEL }, options || {});
  if (!OPTS.apiKey) throw new Error('서버에 ANTHROPIC_API_KEY가 설정되지 않았어요');
  if (body.task === 'analyze') return analyze(body);
  if (body.task === 'chat') return chat(body);
  if (body.task === 'report') return report(body);
  throw new Error('알 수 없는 요청이에요');
}

module.exports = { handleBookTalk };
