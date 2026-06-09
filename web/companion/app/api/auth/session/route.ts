import { NextResponse } from "next/server";
import { introspectToken } from "@/lib/meloming-oauth";
import {
  getSessionCookies,
  isSessionValid,
} from "@/lib/oauth-cookies";

export async function GET() {
  const session = await getSessionCookies();
  if (!session.accessToken || !isSessionValid(session.expiresAt)) {
    return NextResponse.json({
      loggedIn: false,
      nickname: null,
      profileImageUrl: null,
      expiresAt: session.expiresAt,
      scope: null,
      subject: null,
    });
  }

  const introspect = await introspectToken(session.accessToken);
  const active = introspect?.active !== false;

  if (!active) {
    return NextResponse.json({
      loggedIn: false,
      nickname: null,
      profileImageUrl: null,
      expiresAt: session.expiresAt,
      scope: introspect?.scope ?? null,
      subject: introspect?.sub ?? null,
    });
  }

  const nickname =
    (typeof introspect?.username === "string" && introspect.username) ||
    (typeof introspect?.sub === "string" && introspect.sub) ||
    "멜로밍";

  return NextResponse.json({
    loggedIn: true,
    nickname,
    profileImageUrl: null,
    expiresAt: session.expiresAt ?? introspect?.exp ?? null,
    scope: introspect?.scope ?? null,
    subject: introspect?.sub ?? null,
  });
}
