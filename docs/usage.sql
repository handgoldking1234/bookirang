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
