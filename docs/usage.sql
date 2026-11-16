-- 북이랑 AI 사용량 기록 표 (Supabase → SQL Editor에 붙여 넣고 Run)
create table if not exists public.booktalk_usage (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  app           text not null default 'bookirang',   -- 여러 서비스가 같은 표를 쓰면 구분 (bookirang, webtoon …)
  task          text,                                -- analyze, plan, chat, report, tts, transcribe
  child_id      text,                                -- 아이 id (이름 아님)
  provider      text not null,                       -- anthropic, openai
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  chars         integer not null default 0,          -- 목소리로 읽은 글자 수
  seconds       numeric not null default 0,          -- 음성 인식한 녹음 길이
  cost_usd      numeric(12,6) not null default 0,    -- 공식 단가로 계산한 추정 비용
  ok            boolean not null default true,
  error         text,
  ms            integer
);
create index if not exists booktalk_usage_created_idx on public.booktalk_usage (created_at desc);

-- 보안: 브라우저(anon 키)로는 읽기·쓰기 불가. 서버(service_role 키)만 접근.
alter table public.booktalk_usage enable row level security;

-- ── API 보호(하루 한도)용 ─────────────────────────────────────────────
-- 이미 위 표를 만들었어도 이 아래만 다시 Run 하면 돼요 (여러 번 실행해도 안전)
alter table public.booktalk_usage add column if not exists ip text;
create index if not exists booktalk_usage_ip_idx on public.booktalk_usage (ip, created_at desc);
create index if not exists booktalk_usage_child_idx on public.booktalk_usage (child_id, created_at desc);

-- 오늘(p_since 이후) IP별·아이별 호출 수와 전체 비용을 한 번에 알려 주는 함수 (서버만 호출 가능)
create or replace function public.booktalk_guard(p_ip text, p_child text, p_since timestamptz)
returns table (ip_calls bigint, child_calls bigint, total_cost numeric)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.booktalk_usage where ip = p_ip and created_at >= p_since and provider <> 'guard'),
    (select count(*) from public.booktalk_usage where p_child <> '' and child_id = p_child and created_at >= p_since and provider <> 'guard'),
    (select coalesce(sum(cost_usd), 0) from public.booktalk_usage where created_at >= p_since);
$$;
revoke all on function public.booktalk_guard(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.booktalk_guard(text, text, timestamptz) to service_role;
