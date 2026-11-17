// 북토킹 모듈 · 부모님 리포트 메일 (Resend)
// - 메일 내용은 서버가 정해진 틀로만 만든다 (클라이언트가 HTML을 보낼 수 없다 → 스팸 중계로 쓰이지 않게)
// - 하루 보낼 수 있는 수를 아이별·IP별로 제한한다
// 환경변수: RESEND_API_KEY(필수), MAIL_FROM(선택, 기본 "북이랑 <report@iux.kr>"), MAIL_PER_DAY(선택, 기본 8)
const usage = require('./usage');

const RESEND_URL = 'https://api.resend.com/emails';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0; };
const KIND = { week: '주간', month: '월간', quarter: '분기', half: '6개월', year: '1년' };

function validEmail(s) { return /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,180}\.[A-Za-z]{2,}$/.test(String(s || '')); }

const box = (inner) => `<div style="background:#F4F8FF;border-radius:14px;padding:14px 16px;margin:0 0 12px">${inner}</div>`;
const h = (t) => `<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#3B6BEB">${esc(t)}</p>`;
const p = (t) => `<p style="margin:0;font-size:15px;line-height:1.7;color:#171C35">${esc(t)}</p>`;
function tiles(list) {
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px"><tr>' + list.map((t) =>
    `<td style="width:${Math.floor(100 / list.length)}%;padding:0 4px"><div style="background:#F2F3F7;border-radius:12px;padding:12px 6px;text-align:center">` +
    `<div style="font-size:20px;font-weight:800;color:#3B6BEB">${esc(t[1])}</div><div style="font-size:12px;color:#6B7080">${esc(t[0])}</div>` +
    (t[2] ? `<div style="font-size:12px;color:${String(t[2]).charAt(0) === '-' ? '#B42318' : '#1E8A5E'}">${esc(t[2])}</div>` : '') + '</div></td>').join('') + '</tr></table>';
}
function wrap(title, sub, inner) {
  return '<div style="background:#F2F3F7;padding:20px 12px;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:24px 20px">' +
    `<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#3B6BEB">북이랑 · 부모님 리포트</p>` +
    `<h1 style="margin:0 0 4px;font-size:21px;line-height:1.35;color:#171C35">${esc(title)}</h1>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#6B7080">${esc(sub)}</p>${inner}` +
    '<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#8A8FA0">아이 목소리와 책 사진은 저장하지 않아요. 이 메일은 북이랑 「내 정보」에서 부모님 이메일을 지우면 더 이상 오지 않아요.</p>' +
    '</div></div>';
}
function fixList(fixes) {
  const rows = (fixes || []).slice(0, 5).map((f) =>
    `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#171C35"><span style="color:#8A8FA0;text-decoration:line-through">${esc(cut(f.from, 140))}</span><br><b>→ ${esc(cut(f.to, 140))}</b>` +
    (f.why ? `<br><span style="color:#6B7080">${esc(cut(f.why, 160))}</span>` : '') + '</p>').join('');
  return rows ? box(h('이렇게 말하면 더 좋아요') + rows) : '';
}
const d = (v, unit) => { const n = num(v); return n ? (n > 0 ? '+' : '') + n + (unit || '') : ''; };

// 한 번의 대화 리포트
function sessionMail(x) {
  const st = x.stats || {}, r = x.report || {};
  const goals = (x.goals || []).slice(0, 3).map((g) => `<p style="margin:0 0 4px;font-size:14px;color:#171C35">${g.used ? '✅' : '▫️'} ${esc(cut(g.en, 80))} <span style="color:#6B7080">${g.used ? '썼어요' : '다음에 써 보기'}</span></p>`).join('');
  const inner =
    tiles([['말한 문장', num(st.sentences)], ['쓴 단어 종류', num(st.unique)], ['대화 시간', num(st.minutes) + '분'], ['말한 비율', num(st.ratio) + '%']]) +
    (r.praise ? box(h('잘했어요') + p(cut(r.praise, 400))) : '') +
    (r.comprehension ? box(h('내용 이해') + p(cut(r.comprehension, 300))) : '') +
    (goals ? box(h('오늘의 목표 표현') + goals) : '') +
    fixList(r.fixes) +
    ((r.expressions || []).length ? box(h('새로 써 본 표현') + p((r.expressions || []).slice(0, 5).map((e) => cut(e, 60)).join(' · '))) : '') +
    (r.nextTip ? box(h('다음에는') + p(cut(r.nextTip, 300))) : '');
  const name = cut(x.child, 12) || '아이';
  return { subject: `[북이랑] ${name}의 오늘 이야기: ${cut(x.title, 60)}`, html: wrap(`${name}가 오늘 「${cut(x.title, 60)}」 이야기를 했어요`, `${cut(x.date, 10)} · ${cut(x.sourceName, 10) || '북토킹'}`, inner) };
}

// 기간 리포트 (주간·월간·분기·6개월·1년). 주간이 아닌 리포트에는 '지난주' 요약도 함께 넣는다.
function periodBlock(c, pv) {
  pv = pv || {};
  return tiles([['이야기한 횟수', num(c.sessions) + '회', d(c.sessions - (pv.sessions || 0), '회')], ['말한 시간', num(c.minutes) + '분', d(c.minutes - (pv.minutes || 0), '분')],
    ['말한 문장', num(c.sentences), d(c.sentences - (pv.sentences || 0))], ['문장 길이', num(c.avgLen) + '단어', d(c.avgLen - (pv.avgLen || 0))]]) +
    tiles([['공부한 날', num(c.days) + '일'], ['새로 쓴 단어', num(c.newWords) + '개'], ['목표 표현 성공', c.goalRate == null ? '-' : num(c.goalRate) + '%'], ['스스로 말하기', num(c.self) + '%']]);
}
function periodMail(x) {
  const kind = KIND[x.kind] ? x.kind : 'week';
  const a = x.analysis || {}, c = x.cur || {};
  const li = (arr) => (arr || []).slice(0, 4).map((t) => `<p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#171C35">· ${esc(cut(t, 200))}</p>`).join('');
  const titles = (x.titles || []).slice(0, 12).map((t) => cut(t, 40)).join(' · ');
  const inner =
    (a.summary ? box(h('한눈에 보기') + p(cut(a.summary, 500))) : '') +
    periodBlock(c, x.prev) +
    '<p style="margin:-6px 0 12px;font-size:12px;color:#8A8FA0;text-align:right">초록·빨강 숫자는 바로 앞 같은 기간과 비교한 변화예요</p>' +
    ((a.strengths || []).length ? box(h('좋아진 점') + li(a.strengths)) : '') +
    ((a.improve || []).length ? box(h('더 연습하면 좋은 점') + li(a.improve)) : '') +
    fixList(x.fixes) +
    (titles ? box(h('이야기한 것들') + p(titles)) : '') +
    (kind !== 'week' && x.week && num(x.week.sessions) ? '<p style="margin:16px 0 8px;font-size:15px;font-weight:800;color:#171C35">지난주 요약</p>' + periodBlock(x.week, x.weekPrev) : '') +
    (a.nextPlan ? box(h('다음 ' + (kind === 'week' ? '주' : '기간') + ' 이렇게 해 보세요') + p(cut(a.nextPlan, 400))) : '') +
    (a.parentTip ? box(h('집에서 도와주는 방법') + p(cut(a.parentTip, 400))) : '');
  const name = cut(x.child, 12) || '아이';
  return { subject: `[북이랑] ${name}의 ${KIND[kind]} 리포트 (${cut(x.range, 30)})`, html: wrap(`${name}의 ${KIND[kind]} 영어 말하기 리포트`, cut(x.range, 30), inner) };
}

// 오늘 이 아이·IP로 보낸 메일 수 (Supabase 사용 기록으로 확인). 확인할 수 없으면 서버 메모리로 센다.
const mem = {};
async function sentToday(childId, ip) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const mk = day + '|' + (childId || ip || '');
  if (url && key) {
    try {
      const since = new Date(Date.parse(day + 'T00:00:00+09:00')).toISOString();
      const who = childId ? 'child_id=eq.' + encodeURIComponent(childId) : 'ip=eq.' + encodeURIComponent(ip || '');
      const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/booktalk_usage?select=id&task=eq.mail&ok=eq.true&' + who + '&created_at=gte.' + encodeURIComponent(since) + '&limit=50',
        { headers: { apikey: key, authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(2500) });
      if (r.ok) return (await r.json()).length;
    } catch (e) {}
  }
  return mem[mk] || 0;
}

async function send(body, ctx) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('서버에 RESEND_API_KEY가 설정되지 않아 메일을 보낼 수 없어요');
  const to = String(body.to || '').trim();
  if (!validEmail(to)) throw new Error('이메일 주소를 다시 확인해 주세요');
  const limit = Number(process.env.MAIL_PER_DAY) || 8;
  if (await sentToday(ctx.childId, ctx.ip) >= limit) throw new Error('오늘은 메일을 더 보낼 수 없어요 (하루 ' + limit + '통)');
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const m = body.kind === 'period' ? periodMail(data) : sessionMail(data);
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || '북이랑 <report@iux.kr>', to: [to], subject: m.subject, html: m.html })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (j && (j.message || (j.error && j.error.message))) || 'Resend 오류 ' + res.status;
    usage.record({ provider: 'resend', model: 'email', ok: false, error: msg });
    throw new Error('메일을 보내지 못했어요: ' + msg);
  }
  usage.record({ provider: 'resend', model: 'email', cost_usd: 0 });
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10), mk = day + '|' + (ctx.childId || ctx.ip || '');
  mem[mk] = (mem[mk] || 0) + 1;
  return { sent: true, id: j.id || '' };
}

module.exports = { send, sessionMail, periodMail, validEmail, enabled: () => !!process.env.RESEND_API_KEY };
