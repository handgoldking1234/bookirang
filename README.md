# 북이랑 (Bookirang)

책 한 쪽을 올리면 Claude가 글을 읽어 텍스트로 바꾸고, AI 튜터 도란이와 그 내용으로 영어 북토킹을 하는 초등 교육 앱입니다.

## 구성

북토킹 기능은 `booktalk/` 모듈로 분리돼 있어서 하루5분 같은 다른 앱에 넣었다가 나중에 다시 떼어 낼 수 있습니다. 자세한 방법은 [docs/INTEGRATION.md](docs/INTEGRATION.md)를 보세요.

| 파일 | 역할 |
| --- | --- |
| `booktalk/server/handler.js` | Claude 호출 로직 (사진 분석·대화·리포트) — 어떤 서버에서도 재사용 |
| `booktalk/core/*.js` | 호스트 설정, 서버 호출, 세션 저장, 통계 계산 — 화면과 무관 |
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
| `OPENAI_API_KEY` | 선택 | 넣으면 도란이 목소리가 OpenAI 음성(자연스러운 목소리)으로 바뀜. 없으면 브라우저 목소리 |
| `CLAUDE_MODEL_OCR` | 선택 | 사진 글 읽기 모델, 기본 `claude-sonnet-5-5` |
| `CLAUDE_MODEL_CHAT` | 선택 | 대화·리포트 모델, 기본 `claude-haiku-5-5` |
| `CLAUDE_MODEL` | 선택 | 넣으면 위 두 작업 모두 이 모델 사용 |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | 선택 | 기본 `gpt-4o-mini-tts`, `coral` |

2. 다시 배포(Redeploy)

API 키는 서버 함수에서만 쓰이고 브라우저에는 노출되지 않습니다.

## 수정 후 빌드

```bash
python3 scripts/build.py booktalk/ui/App.dc.html scripts/runtime.js index.html
```
