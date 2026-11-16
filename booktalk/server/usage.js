// 북토킹 모듈 · 사용량 기록 (Claude·OpenAI 호출마다 토큰/글자/시간과 비용을 남긴다)
// 저장: Supabase REST (환경변수 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). 없으면 기록하지 않고 그냥 넘어간다.
// 요청마다 따로 모으기 위해 AsyncLocalStorage를 쓴다 (한 서버가 여러 요청을 동시에 처리해도 섞이지 않게).
const { AsyncLocalStorage } = require('node:async_hooks');

const store = new AsyncLocalStorage();

// 가격 (USD). 바뀌면 여기만 고치면 된다.
const PRICES = {
  claude: {
    'claude-sonnet-5-5': { in: 2.0, out: 10.0 },   // 100만 토큰당
    'claude-haiku-5-5': { in: 0.10, out: 0.50 },
    default: { in: 2.0, out: 10.0 }
  },
  tts: { perMinute: 0.015, charsPerMinute: 900 },   // gpt-4o-mini-tts 분당 약 $0.015 (글자 수로 추정)
  stt: {
    'gpt-4o-mini-transcribe': 0.003,                // 분당
    'gpt-transcribe': 0.0045,
    default: 0.006
  }
};

function claudeCost(model, inTok, outTok) {
  const p = PRICES.claude[model] || PRICES.claude.default;
  return (inTok * p.in + outTok * p.out) / 1e6;
}
function ttsCost(chars) {
  return (chars / PRICES.tts.charsPerMinute) * PRICES.tts.perMinute;
}
function sttCost(model, seconds) {
  const per = PRICES.stt[model] != null ? PRICES.stt[model] : PRICES.stt.default;
  return (seconds / 60) * per;
}

// 지금 요청의 기록 목록에 한 줄 추가
function record(row) {
  const list = store.getStore();
  if (list) list.push(Object.assign({ ok: true }, row));
}

// fn을 실행하면서 그 안에서 생긴 기록을 모아 돌려준다
async function track(fn) {
  const list = [];
  let out, err;
  await store.run(list, async () => {
    try { out = await fn(); } catch (e) { err = e; }
  });
  return { out, err, rows: list };
}

async function save(rows, ctx) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !rows.length) return;
  const body = rows.map((r) => ({
    app: ctx.app || 'bookirang',
    task: ctx.task || null,
    child_id: ctx.childId ? String(ctx.childId).slice(0, 64) : null,
    provider: r.provider,
    model: r.model || null,
    input_tokens: r.input_tokens || 0,
    output_tokens: r.output_tokens || 0,
    chars: r.chars || 0,
    seconds: r.seconds || 0,
    cost_usd: Number((r.cost_usd || 0).toFixed(6)),
    ok: r.ok !== false,
    error: r.error ? String(r.error).slice(0, 300) : null,
    ms: r.ms || null
  }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(url.replace(/\/$/, '') + '/rest/v1/booktalk_usage', {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    // 기록 실패는 앱 동작에 영향을 주지 않는다
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { record, track, save, claudeCost, ttsCost, sttCost, PRICES };
