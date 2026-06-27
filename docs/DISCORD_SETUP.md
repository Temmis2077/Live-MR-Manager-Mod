# Discord 서버 운영 가이드

Live MR Manager 사용자(스트리머·퍼포머) 문의용 Discord 서버 설정 안내입니다.

## 서버 정보

- 초대 링크: https://discord.gg/qfJnk3VJyf
- 서버 이름: [LMRM] Live MR Manager

코드 반영 위치: [`web/companion/lib/site.ts`](../web/companion/lib/site.ts), [`src/js/companion-links.js`](../src/js/companion-links.js)

Vercel 프로덕션에도 `NEXT_PUBLIC_DISCORD_INVITE_URL=https://discord.gg/qfJnk3VJyf` 환경 변수를 설정하세요.

## 권장 채널

| 채널 | 용도 |
|------|------|
| `#공지` | 릴리즈, 알려진 이슈, FAQ·앱 설정 경로 |
| `#질문-답변` | 설치·사용법·멜로밍 연동 (주 활동) |
| `#버그-제보` | 증상 공유 → GitHub Issues template 유도 |
| `#건의` | 기능 제안 (선택) |

## `#공지` 핀 메시지 예시

- Discord: https://discord.gg/qfJnk3VJyf
- FAQ: https://lmrm.vercel.app/faq
- 문의 허브: https://lmrm.vercel.app/qa
- 버그 신고: https://github.com/AutumnColor77/Live-MR-Manager/issues/new?template=bug_report.yml
- 앱에서: 설정 → 도움말 · 문의

**주의:** OAuth token·Client Secret·전체 로그는 올리지 마세요.
