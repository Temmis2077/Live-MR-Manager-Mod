import { NextResponse } from "next/server";
import { fetchUserInfo, introspectToken } from "@/lib/meloming-oauth";
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

  const userinfo = await fetchUserInfo(session.accessToken);
  const nickname =
    (typeof userinfo?.nickname === "string" && userinfo.nickname.trim()) ||
    (typeof userinfo?.name === "string" && userinfo.name.trim()) ||
    (typeof introspect?.username === "string" && introspect.username.trim()) ||
    "멜로밍";
  const profileImageUrl =
    (typeof userinfo?.picture === "string" && userinfo.picture.trim()) || null;

  return NextResponse.json({
    loggedIn: true,
    nickname,
    profileImageUrl,
    expiresAt: session.expiresAt ?? introspect?.exp ?? null,
    scope: introspect?.scope ?? null,
    subject: introspect?.sub ?? null,
  });
}
