# 북이랑 (Bookirang)

책 한 쪽을 올리면 Claude가 글을 읽어 텍스트로 바꾸고, AI 튜터 도란이와 그 내용으로 영어 북토킹을 하는 초등 교육 앱입니다.

## 구성

북토킹 기능은 `booktalk/` 모듈로 분리돼 있어서 하루5분 같은 다른 앱에 넣었다가 나중에 다시 떼어 낼 수 있습니다. 자세한 방법은 [docs/INTEGRATION.md](docs/INTEGRATION.md)를 보세요.

| 파일 | 역할 |
| --- | --- |
| `booktalk/server/handler.js` | Claude 호출 로직 (사진 분석·대화·리포트) — 어떤 서버에서도 재사용 |
| `booktalk/core/*.js` | 호스트 설정, 서버 호출, 세션 저장, 통계 계산, 목소리·음성 인식, 프리토킹 소재 — 화면과 무관 |
| `booktalk/ui/App.dc.html` | 화면·화면 로직 원본 |
| `api/booktalk.js` | Vercel 어댑터 (`/api/booktalk`) |
| `index.html` | 북이랑 단독 앱 (빌드 결과물, 직접 수정하지 않기) |
| `scripts/build.py`, `scripts/runtime.js` | 화면 원본을 `index.html`로 만드는 빌드 스크립트와 미니 런타임 |

## 동작 흐름

1. **책 올리기**: 카메라나 앨범 사진 → 브라우저에서 1600px로 줄여 `/api/booktalk`(analyze)로 보냄 → 본문 텍스트, 주제, 핵심 단어, 첫 질문을 받음. 여러 쪽을 이어 올릴 수 있고, 읽어 온 글은 화면에서 고칠 수 있음.
2. **북토킹**: 마이크(브라우저 음성 인식, en-US) 또는 글자 입력 → `/api/booktalk`(chat) → 튜터 답, 고쳐 말하기, 힌트. 튜터 답은 OpenAI 음성(키가 있을 때) 또는 브라우저 음성으로 읽어 줌. 같은 문장은 한 번만 만들어 다시 씀.
3. **리포트**: 단어 수, 서로 다른 단어, 많이 쓴 단어, 말한 비율 등은 대화 기록으로 브라우저에서 계산하고, 칭찬·교정·새 표현·팁은 `/api/booktalk`(report)로 받음.
4. **성장 통계**: 북토킹 기록을 브라우저(localStorage)에 저장해 주간·월간·연간으로 묶어 보여 줌. 기록이 없으면 샘플 데이터.

추천(2주 14권)과 랭킹은 아직 샘플 데이터입니다.

## 배포 설정 (Vercel)

1. 프로젝트 Settings › Environment Variables에 추가

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 필수 | Anthropic Console에서 발급한 키 |
| `OPENAI_API_KEY` | 선택 | 넣으면 도란이 목소리(OpenAI 음성)와 아이 말 알아듣기(OpenAI 음성 인식, 한국어 섞어 말해도 됨)가 켜짐. 없으면 브라우저 기능(영어만) |
| `CLAUDE_MODEL_OCR` | 선택 | 사진 글 읽기 모델, 기본 `claude-sonnet-5-5` |
| `CLAUDE_MODEL_CHAT` | 선택 | 대화·리포트 모델, 기본 `claude-haiku-5-5` |
| `CLAUDE_MODEL` | 선택 | 넣으면 위 두 작업 모두 이 모델 사용 |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | 선택 | 기본 `gpt-4o-mini-tts`, `coral` |
| `OPENAI_STT_MODEL` | 선택 | 기본 `gpt-4o-mini-transcribe` |

2. 다시 배포(Redeploy)

API 키는 서버 함수에서만 쓰이고 브라우저에는 노출되지 않습니다.

## 수정 후 빌드

```bash
python3 scripts/build.py booktalk/ui/App.dc.html scripts/runtime.js index.html
```

## 도란도란 프리토킹 (주제 고정 방식)

대화 소재는 4가지예요: 북토킹(책 사진) · 오늘의 주제 · 교과서 단원 · 원서 — 모두 채팅창에서 바로 시작.

1. `plan` — 대화 전에 질문 6개(마음 열기 1 → 내용 확인 2 → 생각 말하기 3)와 목표 표현 3개를 먼저 정해요.
2. `chat` — 도란이는 계획표의 **현재 질문**만 보고 답해요. 몇 번째 질문인지(`step`)와 몇 번 벗어났는지(`off`)는 서버가 정해요.
   - 주제에서 두 번 연속 벗어나면 서버가 다음 질문으로 넘겨요.
   - AI에게는 최근 3번 주고받은 대화와 아이가 한 말 요약만 넘겨서, 대화가 길어져도 헛소리가 늘지 않아요.
   - 답은 3문장 이내로 다듬고, 넘어가는데 질문이 빠지면 다음 질문을 붙여요.
   - 아이가 한국어로 말하면 뜻을 영어로 바꿔 보여 주고(`korean: true`) 따라 말하게 해요.
3. 리포트·통계 — 목표 표현 사용 여부, 소재별 대화 수, 목표 표현 성공률이 남아요.

## 관리자 · AI 사용량 실시간 확인 (`/admin`)

Claude·OpenAI를 부를 때마다 토큰/글자/녹음 시간과 추정 비용을 Supabase `booktalk_usage` 표에 기록하고, `/admin`에서 10초마다 새로고침해 보여줘요.

1. Supabase → SQL Editor에 `docs/usage.sql` 내용을 붙여 넣고 Run (IUX.STUDIO와 같은 프로젝트를 써도 돼요)
2. Vercel 환경변수 추가 (Secret)

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면의 `service_role` 키 (절대 브라우저 코드에 넣지 않기) |
| `ADMIN_PASSWORD` | 관리자 화면 비밀번호 (직접 정하기) |
| `USD_KRW` | 선택, 환율 (기본 1400) |
| `ADMIN_BUDGET_KRW` | 선택, 월 예산(원). 넣으면 예산 대비 % 막대 표시 |

3. Redeploy → `https://<도메인>/admin` 접속 → 비밀번호 입력

비용은 공식 단가로 계산한 추정치예요. 단가는 `booktalk/server/usage.js`의 `PRICES`에서 바꿔요.

## API 보호

`/api/booktalk`은 아래 조건을 통과해야 AI를 불러요. 막힌 요청은 `/admin` 최근 호출에 **차단**으로 보여요.

1. **허용한 사이트에서 온 요청만** — 북이랑 자기 주소는 항상 허용. 하루5분 등 다른 주소에 넣으면 `ALLOWED_ORIGINS`에 추가
2. **요청 크기 제한** — 사진 3.5MB, 녹음 4MB 등
3. **하루 한도** (Supabase에 `docs/usage.sql`의 「API 보호」 부분을 Run 해야 작동)

| 환경변수 (선택) | 기본값 | 뜻 |
|---|---|---|
| `LIMIT_DAILY_KRW` | 20000 | 전체 하루 비용 상한(원). 넘으면 그날은 멈춤. 0이면 끔 |
| `LIMIT_CHILD_PER_DAY` | 400 | 아이 한 명 하루 AI 호출 수 (하루 50분 이상 쓸 수 있는 양) |
| `LIMIT_IP_PER_DAY` | 1500 | 인터넷 주소(IP) 하나의 하루 AI 호출 수 (학교·학원 공용 IP 고려) |
| `ALLOWED_ORIGINS` | — | 추가로 허용할 주소, 쉼표로 구분 (예: `https://haru.iux.kr`) |

정식 출시 때는 하루5분 로그인과 연결해 로그인한 아이만 쓰게 하는 것을 함께 권장해요.
