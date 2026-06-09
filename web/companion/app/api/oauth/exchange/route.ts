import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  melomingCredentials,
  PRODUCTION_REDIRECT_URI,
} from "@/lib/meloming-oauth";

export async function POST(request: NextRequest) {
  const creds = melomingCredentials();
  if ("error" in creds) {
    return NextResponse.json(
      {
        type: "server_not_configured",
        message: "Companion에 MELOMING_CLIENT_ID/SECRET이 설정되지 않았습니다.",
      },
      { status: 503 },
    );
  }

  let body: { code?: string; codeVerifier?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { type: "invalid_request", message: "JSON body가 필요합니다." },
      { status: 400 },
    );
  }

  const code = body.code?.trim();
  const codeVerifier = body.codeVerifier?.trim();
  if (!code || !codeVerifier) {
    return NextResponse.json(
      { type: "invalid_request", message: "code와 codeVerifier가 필요합니다." },
      { status: 400 },
    );
  }

  const result = await exchangeAuthorizationCode({
    code,
    codeVerifier,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: PRODUCTION_REDIRECT_URI,
  });

  if (!result.ok) {
    return new NextResponse(result.body, {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return NextResponse.json(result.token);
}
