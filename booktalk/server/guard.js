// 북토킹 모듈 · API 보호
// 1) 허용한 사이트(Origin)에서 온 요청만 받는다
// 2) 하루 한도: IP별 / 아이별 호출 수, 전체 하루 비용 상한 (Supabase 함수 booktalk_guard로 확인)
// 3) 요청 크기 제한
// 환경변수(모두 선택):
//   ALLOWED_ORIGINS        쉼표로 구분한 허용 주소 (예: https://haru.iux.kr). 북이랑 자기 주소는 항상 허용
//   LIMIT_IP_PER_DAY       IP 하나의 하루 AI 호출 수 (기본 1500 — 학교·학원처럼 여러 명이 한 IP를 쓰는 경우 고려)
//   LIMIT_CHILD_PER_DAY    아이 한 명의 하루 AI 호출 수 (기본 400 ≈ 하루 50분 이상)
//   LIMIT_DAILY_KRW        전체 하루 비용 상한(원). 넘으면 그날은 멈춤 (기본 20000, 0이면 끔)
//   USD_KRW                환율 (기본 1400)

const KST = 9 * 3600 * 1000;

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false; // 브라우저는 POST에 Origin을 항상 붙인다. 없으면 스크립트·봇 호출
  let host;
  try { host = new URL(origin).host; } catch (e) { return false; }
  if (host === req.headers.host || host === req.headers['x-forwarded-host']) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true; // 개발용
  const list = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.includes(origin.replace(/\/$/, ''));
}

function sizeProblem(body) {
  if (body.image && String(body.image).length > 3.5 * 1024 * 1024) return '사진이 너무 커요';
  if (body.audio && String(body.audio).length > 4 * 1024 * 1024) return '녹음이 너무 길어요';
  if (Array.isArray(body.history) && body.history.length > 80) return '대화가 너무 길어요. 새로 시작해 주세요';
  if (body.passage && String(body.passage).length > 12000) return '글이 너무 길어요';
  if (body.text && String(body.text).length > 2000) return '문장이 너무 길어요';
  return '';
}

function todayStartIso() {
  const d = new Date(Date.now() + KST).toISOString().slice(0, 10);
  return new Date(Date.parse(d + 'T00:00:00+09:00')).toISOString();
}

// 오늘 사용량 확인. Supabase가 없거나 함수가 없으면 null (한도 확인 없이 진행)
async function todayUsage(ip, childId) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/booktalk_guard', {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ p_ip: ip, p_child: childId || '', p_since: todayStartIso() }),
      signal: ctrl.signal
    });
    if (!r.ok) return null;
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : j;
    return row ? { ip: Number(row.ip_calls) || 0, child: Number(row.child_calls) || 0, costUsd: Number(row.total_cost) || 0 } : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 사용량 확인 결과를 잠깐 기억해 두고 다시 쓴다 (대화 한 번마다 Supabase에 묻느라 느려지지 않게).
// 한도의 90% 아래로 넉넉할 때만, 최대 60초 동안 재사용한다. 그동안 통과시킨 요청 수는 더해서 센다.
const CACHE_MS = 60 * 1000;
const cache = new Map();
async function usageCached(ip, childId, roomy) {
  const key = todayStartIso() + '|' + ip + '|' + (childId || '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && roomy(hit.u)) {
    hit.u.ip += 1; hit.u.child += 1;
    return hit.u;
  }
  const u = await todayUsage(ip, childId);
  if (u) {
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), u: Object.assign({}, u) });
  }
  return u;
}

// 통과하면 null, 막으면 { status, message, reason }
async function check(req, body) {
  if (!originAllowed(req)) return { status: 403, message: '허용되지 않은 곳에서 온 요청이에요', reason: 'origin' };
  const big = sizeProblem(body);
  if (big) return { status: 413, message: big, reason: 'size' };
  if (body.task === 'config') return null;

  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const ipMax = num(process.env.LIMIT_IP_PER_DAY, 1500);
  const childMax = num(process.env.LIMIT_CHILD_PER_DAY, 400);
  const krwMax = num(process.env.LIMIT_DAILY_KRW, 20000);
  const rate = Number(process.env.USD_KRW) || 1400;

  const u = await usageCached(clientIp(req), body.cid, (x) =>
    (krwMax <= 0 || x.costUsd * rate < krwMax * 0.9) && (ipMax <= 0 || x.ip < ipMax * 0.9) && (childMax <= 0 || x.child < childMax * 0.9));
  if (!u) return null;
  if (krwMax > 0 && u.costUsd * rate >= krwMax) return { status: 429, message: '오늘 준비한 AI 사용량을 모두 썼어요. 내일 다시 만나요!', reason: 'daily-budget' };
  if (ipMax > 0 && u.ip >= ipMax) return { status: 429, message: '오늘 이 곳에서 너무 많이 사용했어요. 내일 다시 만나요!', reason: 'ip-limit' };
  if (childMax > 0 && body.cid && u.child >= childMax) return { status: 429, message: '오늘은 충분히 이야기했어요. 내일 또 하자!', reason: 'child-limit' };
  return null;
}

module.exports = { check, clientIp };
