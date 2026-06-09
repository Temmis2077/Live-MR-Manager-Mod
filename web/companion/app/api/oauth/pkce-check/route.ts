import { NextRequest, NextResponse } from "next/server";
import { getPkceCookies } from "@/lib/oauth-cookies";

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const pkce = await getPkceCookies();
  const webReady = !!(
    state &&
    pkce.state === state &&
    pkce.verifier &&
    pkce.redirectUri
  );
  return NextResponse.json({ webReady });
}
