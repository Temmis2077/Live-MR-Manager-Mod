import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  formatTokenError,
  melomingCredentials,
} from "@/lib/meloming-oauth";
import {
  clearPkceCookies,
  getPkceCookies,
  setSessionCookies,
} from "@/lib/oauth-cookies";

export async function POST(request: NextRequest) {
  const creds = melomingCredentials();
  if ("error" in creds) {
    return NextResponse.json(
      { ok: false, message: creds.error },
      { status: 503 },
    );
  }

  const pkce = await getPkceCookies();

  let body: { code?: string; state?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "JSON body가 필요합니다." },
      { status: 400 },
    );
  }

  const code = body.code?.trim();
  const state = body.state?.trim();
  if (!code || !state) {
    return NextResponse.json(
      { ok: false, message: "code와 state가 필요합니다." },
      { status: 400 },
    );
  }

  if (!pkce.verifier || !pkce.redirectUri || !pkce.state) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "웹 로그인 세션이 만료되었습니다. /login에서 다시 「멜로밍 로그인 시작」을 눌러 주세요.",
      },
      { status: 400 },
    );
  }

  if (pkce.state !== state) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "OAuth state가 일치하지 않습니다. /login에서 로그인을 처음부터 다시 시작해 주세요.",
      },
      { status: 400 },
    );
  }

  const result = await exchangeAuthorizationCode({
    code,
    codeVerifier: pkce.verifier,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: pkce.redirectUri,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: formatTokenError(result.status, result.body),
        status: result.status,
      },
      { status: result.status >= 500 ? 502 : 400 },
    );
  }

  await setSessionCookies({
    accessToken: result.token.access_token,
    refreshToken: result.token.refresh_token,
    expiresIn: result.token.expires_in,
  });
  await clearPkceCookies();

  return NextResponse.json({ ok: true });
}
