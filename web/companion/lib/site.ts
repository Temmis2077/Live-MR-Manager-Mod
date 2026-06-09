export const GITHUB_RELEASES_URL =
  "https://github.com/AutumnColor77/Live-MR-Manager/releases";

export const MELOMING_DOCS_URL =
  "https://developers.meloming.com/docs/openapi/reference/songbook";

export const SITE_NAME = "Live MR Manager";

/** 앱 OAuth 콜백 (웹 PKCE 쿠키가 없을 때만 사용) */
export const APP_SCHEME =
  process.env.NEXT_PUBLIC_APP_SCHEME ?? "live-mr-manager";

export function appOAuthCallbackUrl(params: {
  code?: string;
  state?: string;
}): string {
  const url = new URL(`${APP_SCHEME}://oauth/callback`);
  if (params.code) url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  return url.toString();
}
