import { NextRequest, NextResponse } from "next/server";
import { melomingCredentials, refreshAccessToken } from "@/lib/meloming-oauth";

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

  let body: { refreshToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { type: "invalid_request", message: "JSON body가 필요합니다." },
      { status: 400 },
    );
  }

  const refreshToken = body.refreshToken?.trim();
  if (!refreshToken) {
    return NextResponse.json(
      { type: "invalid_request", message: "refreshToken이 필요합니다." },
      { status: 400 },
    );
  }

  const result = await refreshAccessToken({
    refreshToken,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
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
