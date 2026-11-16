// 관리자 사용량 API: /api/admin (GET, 헤더 x-admin-key = ADMIN_PASSWORD)
// 환경변수: ADMIN_PASSWORD(필수), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USD_KRW(선택, 기본 1400), ADMIN_BUDGET_KRW(선택, 월 예산)
const crypto = require('node:crypto');

const KST = 9 * 3600 * 1000;
const dayKey = (t) => new Date(t + KST).toISOString().slice(0, 10);
const hourOf = (t) => new Date(t + KST).getUTCHours();

function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const TASK_NAME = {
  analyze: '책 사진 읽기', plan: '수업 계획', chat: '대화', report: '리포트',
  tts: '도란이 목소리', transcribe: '음성 인식'
};

module.exports = async function (req, res) {
  res.setHeader('cache-control', 'no-store');
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) { res.status(503).json({ error: 'Vercel 환경변수 ADMIN_PASSWORD를 먼저 넣어 주세요' }); return; }
  if (!same(req.headers['x-admin-key'], pass)) { res.status(401).json({ error: '비밀번호가 맞지 않아요' }); return; }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.status(503).json({ error: 'Vercel 환경변수 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 넣어 주세요' }); return; }

  const rate = Number(process.env.USD_KRW) || 1400;
  const budget = Number(process.env.ADMIN_BUDGET_KRW) || 0;
  const now = Date.now();
  const today = dayKey(now);
  const monthStart = Date.parse(today.slice(0, 7) + '-01T00:00:00+09:00');
  const days14 = Date.parse(today + 'T00:00:00+09:00') - 13 * 86400000;
  const since = new Date(Math.min(monthStart, days14)).toISOString();

  const q = url.replace(/\/$/, '') + '/rest/v1/booktalk_usage?select=created_at,task,provider,model,input_tokens,output_tokens,chars,seconds,cost_usd,child_id,ip,ok,error'
    + '&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc&limit=20000';
  let rows;
  try {
    const r = await fetch(q, { headers: { apikey: key, authorization: 'Bearer ' + key } });
    rows = await r.json();
    if (!r.ok) throw new Error((rows && rows.message) || ('Supabase 오류 ' + r.status));
  } catch (e) {
    res.status(502).json({ error: '사용 기록을 불러오지 못했어요: ' + e.message });
    return;
  }

  const won = (usd) => Math.round(usd * rate * 10) / 10;
  const empty = () => ({ cost: 0, calls: 0, errors: 0, blocked: 0, kids: new Set() });
  const GUARD = { 'daily-budget': '하루 예산 초과', 'ip-limit': 'IP 하루 한도 초과', 'child-limit': '아이 하루 한도 초과', size: '요청 크기 초과' };
  const T = empty(), M = empty();
  const byProvider = {}, byTask = {}, daily = {}, hourly = Array.from({ length: 24 }, () => ({ cost: 0, calls: 0 }));
  for (let i = 0; i < 14; i++) daily[dayKey(days14 + i * 86400000)] = { cost: 0, calls: 0 };

  rows.forEach((r) => {
    const t = Date.parse(r.created_at), d = dayKey(t), c = Number(r.cost_usd) || 0;
    if (r.provider === 'guard') { if (t >= monthStart) M.blocked++; if (d === today) T.blocked++; return; }
    if (daily[d]) { daily[d].cost += c; daily[d].calls++; }
    const add = (agg) => { agg.cost += c; agg.calls++; if (!r.ok) agg.errors++; if (r.child_id) agg.kids.add(r.child_id); };
    if (t >= monthStart) {
      add(M);
      const pn = r.provider === 'anthropic' ? 'Claude' : r.provider === 'openai' ? 'OpenAI' : r.provider;
      const pk = pn + ' · ' + (r.model || '');
      byProvider[pk] = byProvider[pk] || { name: pn, model: r.model || '', cost: 0, calls: 0, tokensIn: 0, tokensOut: 0, chars: 0, seconds: 0 };
      const bp = byProvider[pk];
      bp.cost += c; bp.calls++; bp.tokensIn += r.input_tokens || 0; bp.tokensOut += r.output_tokens || 0; bp.chars += r.chars || 0; bp.seconds += Number(r.seconds) || 0;
      const tk = r.task || '기타';
      byTask[tk] = byTask[tk] || { name: TASK_NAME[tk] || tk, cost: 0, calls: 0 };
      byTask[tk].cost += c; byTask[tk].calls++;
    }
    if (d === today) { add(T); hourly[hourOf(t)].cost += c; hourly[hourOf(t)].calls++; }
  });

  const pack = (a) => ({ costKrw: won(a.cost), costUsd: Number(a.cost.toFixed(4)), calls: a.calls, errors: a.errors, blocked: a.blocked, kids: a.kids.size });
  res.status(200).json({
    now: new Date(now).toISOString(), rate, budgetKrw: budget,
    today: pack(T), month: pack(M),
    byProvider: Object.values(byProvider).sort((a, b) => b.cost - a.cost).map((p) => Object.assign({}, p, { costKrw: won(p.cost), seconds: Math.round(p.seconds) })),
    byTask: Object.values(byTask).sort((a, b) => b.cost - a.cost).map((p) => ({ name: p.name, calls: p.calls, costKrw: won(p.cost) })),
    daily: Object.keys(daily).map((d) => ({ date: d, costKrw: won(daily[d].cost), calls: daily[d].calls })),
    hourly: hourly.map((h, i) => ({ hour: i, costKrw: won(h.cost), calls: h.calls })),
    recent: rows.slice(0, 40).map((r) => ({
      at: r.created_at, task: TASK_NAME[r.task] || r.task, provider: r.provider, model: r.model,
      blocked: r.provider === 'guard',
      detail: r.provider === 'guard' ? (GUARD[r.model] || '차단') : r.provider === 'anthropic' ? (r.input_tokens + '→' + r.output_tokens + ' 토큰') : r.chars ? (r.chars + '자') : r.seconds ? (Number(r.seconds).toFixed(1) + '초') : '',
      costKrw: won(Number(r.cost_usd) || 0), ok: r.ok, error: r.error, child: r.child_id, ip: r.ip ? String(r.ip).replace(/(\d+)$/, '*') : ''
    }))
  });
};
