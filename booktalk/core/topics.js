/* 북토킹 모듈 · 프리토킹 소재
 * - 오늘의 주제: 날짜로 하루 하나씩 돌아간다 (모든 아이가 같은 날 같은 주제 → 리더보드·이야깃거리 공유)
 * - 교과서 단원: 학년별 대표 의사소통 주제와 핵심 표현 (교과서 본문은 넣지 않는다. 본문은 사진으로 올리기)
 * 하루5분 등 호스트 앱이 BookTalkHost.topics / BookTalkHost.textbook 으로 바꿔 넣을 수 있다.
 */
(function () {
  var BT = window.BookTalk;
  var host = BT.host || {};

  var TOPICS = host.topics || [
    { en: 'My Favorite Weekend', ko: '내가 좋아하는 주말', extra: '주말에 하는 일, 함께하는 사람' },
    { en: 'If I Had a Pet', ko: '반려동물이 생긴다면', extra: '키우고 싶은 동물과 이유' },
    { en: 'The Best Food in the World', ko: '세상에서 제일 맛있는 음식', extra: '좋아하는 음식, 맛 표현' },
    { en: 'My Dream Job', ko: '나의 꿈', extra: '되고 싶은 것과 이유' },
    { en: 'A Day at School', ko: '학교에서의 하루', extra: '좋아하는 과목, 쉬는 시간' },
    { en: 'Superpowers', ko: '초능력이 생긴다면', extra: '갖고 싶은 능력과 쓰고 싶은 곳' },
    { en: 'My Best Friend', ko: '나의 단짝 친구', extra: '친구의 모습, 함께 하는 놀이' },
    { en: 'Seasons and Weather', ko: '계절과 날씨', extra: '좋아하는 계절, 날씨에 따라 하는 일' },
    { en: 'A Trip I Want to Take', ko: '가 보고 싶은 곳', extra: '여행지, 하고 싶은 일' },
    { en: 'My Family', ko: '우리 가족', extra: '가족 소개, 가족과 하는 일' },
    { en: 'Games I Love', ko: '내가 좋아하는 놀이와 게임', extra: '규칙 설명, 좋아하는 이유' },
    { en: 'Helping at Home', ko: '집안일 돕기', extra: '할 수 있는 일, 해 본 일' },
    { en: 'Animals in the Wild', ko: '야생 동물', extra: '좋아하는 동물, 사는 곳' },
    { en: 'My Room', ko: '내 방 소개', extra: '물건의 위치, 좋아하는 물건' },
    { en: 'Birthday Party', ko: '생일 파티', extra: '하고 싶은 파티, 받고 싶은 선물' },
    { en: 'Saving the Earth', ko: '지구 지키기', extra: '환경을 위해 할 수 있는 일' },
    { en: 'A Funny Thing That Happened', ko: '웃겼던 일', extra: '과거형으로 이야기하기' },
    { en: 'Sports and Exercise', ko: '운동', extra: '할 줄 아는 운동, 해 보고 싶은 운동' },
    { en: 'Robots and the Future', ko: '로봇과 미래', extra: '미래에 생길 것들' },
    { en: 'My Favorite Book Character', ko: '좋아하는 책 속 인물', extra: '인물 소개, 닮고 싶은 점' },
    { en: 'Holidays in Korea', ko: '우리나라 명절', extra: '명절에 하는 일, 외국 친구에게 소개' },
    { en: 'What Makes Me Happy', ko: '나를 행복하게 하는 것', extra: '기분 표현과 이유' },
    { en: 'Rules We Need', ko: '꼭 필요한 규칙', extra: '규칙과 이유, should' },
    { en: 'Inventions', ko: '발명품', extra: '고마운 발명품, 만들고 싶은 발명품' },
    { en: 'Morning Routine', ko: '나의 아침', extra: '아침에 하는 일 순서' },
    { en: 'Space Adventure', ko: '우주 여행', extra: '가 보고 싶은 행성, 준비물' },
    { en: 'Kindness', ko: '친절', extra: '친절했던 경험, 받은 도움' },
    { en: 'Shopping Day', ko: '물건 사기', extra: '사고 싶은 것, 가격 묻기' }
  ];

  var TEXTBOOK = host.textbook || {
    '초3': [
      { en: 'Hello, I\'m ...', ko: '인사와 소개', extra: 'Hello. / I\'m ... / Nice to meet you.' },
      { en: 'What\'s This?', ko: '물건 이름 묻기', extra: 'What\'s this? / It\'s a ...' },
      { en: 'I Like Apples', ko: '좋아하는 것', extra: 'Do you like ...? / Yes, I do. / No, I don\'t.' },
      { en: 'How Many?', ko: '수 세기', extra: 'How many ...? / ... (number)' },
      { en: 'I Can Swim', ko: '할 수 있는 것', extra: 'Can you ...? / I can ... / I can\'t ...' }
    ],
    '초4': [
      { en: 'What Time Is It?', ko: '시각 묻기', extra: 'What time is it? / It\'s ... o\'clock.' },
      { en: 'Where Is My Cap?', ko: '물건 위치', extra: 'Where is ...? / It\'s on/in/under ...' },
      { en: 'What Are You Doing?', ko: '지금 하는 일', extra: 'What are you doing? / I\'m ...ing.' },
      { en: 'How\'s the Weather?', ko: '날씨', extra: 'How\'s the weather? / It\'s sunny.' },
      { en: 'Let\'s Play Soccer', ko: '제안하기', extra: 'Let\'s ... / Sounds good. / Sorry, I can\'t.' }
    ],
    '초5': [
      { en: 'Where Are You From?', ko: '출신 묻기', extra: 'Where are you from? / I\'m from ...' },
      { en: 'What Did You Do Last Weekend?', ko: '지난 일 말하기', extra: 'What did you do ...? / I ...ed.' },
      { en: 'I Want to Be a Pilot', ko: '장래 희망', extra: 'What do you want to be? / I want to be ...' },
      { en: 'May I Take a Picture?', ko: '허락 구하기', extra: 'May I ...? / Sure. / Sorry, you can\'t.' },
      { en: 'How Can I Get There?', ko: '길 묻기', extra: 'How can I get to ...? / Go straight and turn left.' }
    ],
    '초6': [
      { en: 'What Will You Do This Summer?', ko: '계획 말하기', extra: 'What will you do ...? / I will ...' },
      { en: 'You Should Wear a Helmet', ko: '충고하기', extra: 'You should ... / You shouldn\'t ...' },
      { en: 'He Is Taller Than Me', ko: '비교하기', extra: '... is taller/bigger than ...' },
      { en: 'Why Are You Happy?', ko: '이유 말하기', extra: 'Why ...? / Because ...' },
      { en: 'Have You Ever Been to Jeju?', ko: '경험 말하기', extra: 'Have you ever ...? / Yes, I have.' }
    ]
  };

  function dayIndex(d) {
    var t = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor(t / 86400000);
  }

  BT.topics = {
    list: TOPICS,
    today: function (d) { d = d || new Date(); return TOPICS[dayIndex(d) % TOPICS.length]; },
    textbook: TEXTBOOK,
    grades: Object.keys(TEXTBOOK)
  };
})();
