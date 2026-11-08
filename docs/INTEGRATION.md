# 북토킹 모듈 연결 가이드

북토킹(책 올리기 → AI 대화 → 리포트 → 통계)을 **북이랑 단독 앱**과 **하루5분 안의 한 과목**, 두 가지 방식으로 쓸 수 있게 나눠 둔 구조입니다.
처음에는 하루5분에 넣어 운영하고, 잘되면 북이랑으로 따로 떼어 낼 수 있습니다.

## 1. 폴더 구분

| 위치 | 내용 | 하루5분에 옮길 때 |
| --- | --- | --- |
| `booktalk/server/handler.js` | Claude 호출 (사진 분석·대화·리포트 프롬프트) | **그대로 복사** |
| `booktalk/core/host.js` | 호스트 연결 설정 (아이 정보, 기능 켜기·끄기, 콜백) | 그대로 복사, `BookTalkHost`만 하루5분 값으로 |
| `booktalk/core/api.js` | 서버 호출 | 그대로 복사 |
| `booktalk/core/store.js` | 세션 저장 (`booktalk.<아이id>.sessions`) | 그대로 복사, 필요하면 storage 어댑터 교체 |
| `booktalk/core/stats.js` | 단어·문장 계산, 주간·월간·연간 집계 | 그대로 복사 |
| `booktalk/ui/App.dc.html` | 화면 원본 | 하루5분 화면 방식(React 등)에 맞게 옮김 |
| `api/booktalk.js` | Vercel 어댑터 | 하루5분 서버 방식에 맞게 몇 줄만 작성 |
| `index.html`, `scripts/` | 북이랑 단독 앱 껍데기 | 옮기지 않음 |

원칙: **북토킹 고유 로직은 `booktalk/` 안에만** 둡니다. 하루5분의 로그인, 캐시, 랭킹, 아바타 코드는 `booktalk/`에서 직접 부르지 않고, 아래 연결 지점(`BookTalkHost`)으로만 주고받습니다.

## 2. 연결 지점 `window.BookTalkHost`

`booktalk/core/host.js`를 로드하기 전에 정의합니다. 적지 않은 값은 북이랑 기본값을 씁니다.

```js
window.BookTalkHost = {
  mode: 'embedded',
  appName: '하루5분',
  tutorName: '도란이',
  apiBase: '',                 // 하루5분 도메인에 서버를 두면 비워 둠
  endpoint: '/api/booktalk',
  child: { id: '<하루5분 아이 id>', name: '민준', grade: '초3', level: 2 },
  features: { plan: true, rank: false },   // 하루5분 랭킹을 쓰면 북토킹 랭킹 탭은 끔
  getAuthHeaders: () => ({ Authorization: 'Bearer ' + accessToken }),
  onSessionComplete: (session) => {
    // 1) 하루5분 DB에 저장  2) 캐시 지급  3) 오늘 할 일 완료 처리
  },
  storage: null                // 기기 대신 서버에 저장하려면 { get, set } 어댑터
};
```

## 3. 주고받는 데이터

`onSessionComplete(session)`로 넘어가는 한 번의 북토킹 기록:

```json
{
  "id": 1794125000000,
  "date": "2026-11-08",
  "title": "The Singing Whales",
  "stats": {
    "total": 112, "unique": 58, "sentences": 18, "turns": 6, "avg": 6.2,
    "ratio": 38, "minutes": 12, "hints": 1, "self": 83, "ttr": 52,
    "top": [["sing", 7]], "bookWords": [["migrate", true]], "words": ["..."]
  },
  "report": {
    "praise": "...", "fixes": [{ "from": "...", "to": "...", "why": "..." }],
    "expressions": ["..."], "overused": { "word": "good", "alternatives": ["great"] },
    "comprehension": "...", "nextTip": "..."
  }
}
```

하루5분 Supabase에 저장한다면 테이블 하나면 충분합니다 (나중에 분리할 때 이 테이블만 옮기면 됨).

```sql
create table booktalk_sessions (
  id bigint primary key,
  child_id uuid not null,
  date date not null,
  title text,
  stats jsonb not null,
  report jsonb,
  created_at timestamptz default now()
);
create index on booktalk_sessions (child_id, date);
```

## 4. 하루5분과 겹치는 기능 정리

| 기능 | 하루5분에 넣었을 때 | 북이랑으로 분리했을 때 |
| --- | --- | --- |
| 로그인·아이 정보 | 하루5분 계정 사용 (`child`, `getAuthHeaders`) | 북이랑 자체 가입 |
| 랭킹 | 하루5분 랭킹 사용 (`features.rank: false`) | 북토킹 랭킹 탭 켬 |
| 캐시·아바타 | `onSessionComplete`에서 지급 | 북이랑 자체 보상 |
| 오늘 할 일 | `onSessionComplete`에서 완료 처리 | 홈의 2주 플랜 |
| 기록 저장 | `booktalk_sessions` 테이블 | 같은 테이블을 새 DB로 이전 |

## 5. 분리할 때 순서

1. `booktalk/` 폴더와 `booktalk_sessions` 테이블을 북이랑 저장소·DB로 옮깁니다.
2. `BookTalkHost`를 `mode: 'standalone'`, `features.rank: true`로 바꿉니다.
3. 북이랑 가입을 붙이고 `child.id`를 북이랑 계정으로 연결합니다.
4. 하루5분에는 북토킹 메뉴 대신 북이랑으로 가는 링크만 남깁니다.
