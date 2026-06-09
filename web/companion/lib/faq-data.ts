export type FaqItem = {
  id: string;
  category: string;
  question: string;
  answer: string;
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "what-is-app",
    category: "시작하기",
    question: "Live MR Manager는 어떤 앱인가요?",
    answer:
      "방송·연습용 MR을 관리하는 Windows 데스크톱 앱입니다. 유튜브·로컬 음원 재생, AI로 MR 분리, 가사 동기화, OBS 오버레이 등을 한곳에서 다룰 수 있습니다. 음원 파일은 내 PC에서만 처리됩니다.",
  },
  {
    id: "what-is-site",
    category: "시작하기",
    question: "이 웹페이지는 무엇인가요?",
    answer:
      "Live MR Manager와 멜로밍 노래책을 함께 쓰는 방법을 안내하는 공식 도움말 페이지입니다. 앱 다운로드 링크, 자주 묻는 질문, 멜로밍 로그인 후 앱으로 돌아오는 연결 화면도 제공합니다.",
  },
  {
    id: "meloming-why",
    category: "멜로밍 노래책",
    question: "멜로밍 노래책과 연동하면 좋은 점은?",
    answer:
      "앱에서 정리한 곡 목록·KEY/BPM·숙련도·난이도 등을 멜로밍 노래책과 맞출 수 있습니다. 연습·방송용 라이브러리와 시청자에게 보이는 노래책을 따로 관리하지 않아도 됩니다.",
  },
  {
    id: "meloming-sync",
    category: "멜로밍 노래책",
    question: "어떤 정보가 동기화되나요?",
    answer:
      "곡 제목, 가수, 썸네일, KEY, BPM, 숙련도·난이도, 카테고리, 가사, 유튜브 링크 같은 곡 정보입니다. MR·녹음 파일 자체는 멜로밍으로 올라가지 않으며, 항상 내 컴퓨터에만 있습니다.",
  },
  {
    id: "channel-id",
    category: "멜로밍 노래책",
    question: "채널 주소는 어떻게 입력하나요?",
    answer:
      "앱 설정의 「멜로밍 노래책」→「방송 채널 주소」에 치지직(chzzk.naver.com/…), SOOP(숲, sooplive.co.kr/station/…), 씨미(ci.me/@…), 멜로밍 webPath, 숫자 채널 ID를 넣을 수 있습니다. 「채널 저장」 후 「연결 테스트」·「가져오기」를 사용하세요. 입력값은 PC에만 저장됩니다.",
  },
  {
    id: "import-songs",
    category: "멜로밍 노래책",
    question: "멜로밍 노래책을 앱으로 가져오려면?",
    answer:
      "앱 설정 → 「멜로밍 노래책」에서 방송 채널 주소를 입력·저장한 뒤 「가져오기」를 실행하세요. 로그인 없이 노래책 메타데이터를 Pull할 수 있습니다.",
  },
  {
    id: "export-songs",
    category: "멜로밍 노래책",
    question: "앱에 있는 곡을 멜로밍 노래책에 올리려면?",
    answer:
      "앱 설정의 「멜로밍에 보내기」 기능을 사용합니다. 현재 OAuth 토큰 교환 이슈로 앱에서 「개발 중입니다.」 안내가 표시되며, 정식 연동은 추후 업데이트 예정입니다.",
  },
  {
    id: "login-flow",
    category: "멜로밍 노래책",
    question: "멜로밍 로그인 후 이 페이지가 뜨는 이유는?",
    answer:
      "데스크톱 앱에서 「멜로밍 로그인」을 시작하면 브라우저가 이 페이지(/oauth/callback)를 거친 뒤 설치된 Live MR Manager 앱으로 돌아갑니다. 웹에서 /login으로 시작한 경우에는 웹 세션으로 처리됩니다. 앱 로그인 기능은 현재 OAuth 서버 이슈로 일시 중단 중입니다.",
  },
  {
    id: "proficiency",
    category: "곡 정보",
    question: "숙련도와 난이도란?",
    answer:
      "멜로밍 노래책과 같은 1~5 단계입니다. 숙련도는 내가 그 곡을 얼마나 잘 부르는지, 난이도는 곡 자체가 얼마나 어려운지를 나타냅니다. 앱 곡 정보 편집에서 설정할 수 있습니다.",
  },
  {
    id: "key-bpm",
    category: "곡 정보",
    question: "KEY와 BPM은 어떻게 넣나요?",
    answer:
      "앱에서 곡 정보를 열고 KEY·BPM을 직접 입력하거나, 「KEY/BPM 분석」으로 자동 추정할 수 있습니다. 멜로밍 노래책과 맞출 때 함께 동기화됩니다.",
  },
  {
    id: "privacy",
    category: "안전·개인정보",
    question: "내 음원이 인터넷으로 올라가나요?",
    answer:
      "아니요. MR 분리·재생에 쓰는 음원 파일은 PC 안에서만 처리됩니다. 멜로밍과 주고받는 것은 곡 이름·링크·가사 같은 텍스트 정보입니다.",
  },
];

export const FAQ_CATEGORIES = [
  "전체",
  ...Array.from(new Set(FAQ_ITEMS.map((item) => item.category))),
];
