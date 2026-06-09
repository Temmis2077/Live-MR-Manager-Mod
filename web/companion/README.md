# Live MR Manager — Vercel Companion

멜로밍 노래책 연동용 **사용자-facing** companion 웹 (Next.js). 앱 안내·도움말·OAuth 콜백.

개발자용(미니앱 등록·Redirect URI 등)은 [`docs/MELOMING_SONGBOOK_INTEGRATION.md`](../../docs/MELOMING_SONGBOOK_INTEGRATION.md)에만 둡니다.

## 페이지

| 경로 | 용도 |
|------|------|
| `/` | 연동 안내, 미니앱 등록용 랜딩 |
| `/oauth/callback` | 멜로밍 OAuth Redirect → `live-mr-manager://oauth/callback` |
| `/faq` | FAQ |
| `/qa` | Q&A (확장 예정) |
| `/download` | GitHub Releases 링크 |

## 로컬 실행

```bash
cd web/companion
npm install
npm run dev
```

http://localhost:3000

## 환경 변수

`.env.local` (선택):

```env
NEXT_PUBLIC_APP_SCHEME=live-mr-manager
```

Tauri 앱 OAuth 연동 시 동일 스킴 사용.

## Vercel 배포

1. Vercel에서 이 폴더(`web/companion`)를 루트로 import (또는 monorepo Root Directory 설정)
2. 프로덕션 URL: `https://lmrm.vercel.app`
3. 멜로밍 개발자 센터 등록:
   - **iframe URL**: `https://lmrm.vercel.app/`
   - **Redirect URI**: `https://lmrm.vercel.app/oauth/callback`

## 멜로밍 미니앱 심사

- 연동 안내·FAQ로 「유용한 가치」 설명
- 음원은 로컬만 처리 — companion은 메타·OAuth·문서만 제공

상세: [docs/MELOMING_SONGBOOK_INTEGRATION.md](../../docs/MELOMING_SONGBOOK_INTEGRATION.md)
