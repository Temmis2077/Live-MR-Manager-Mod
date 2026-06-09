import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  melomingCredentials,
  pkceChallenge,
  randomBase64Url,
  resolveRedirectUri,
} from "@/lib/meloming-oauth";
import { clearPkceCookies, setPkceCookies } from "@/lib/oauth-cookies";

export async function GET(request: NextRequest) {
  const creds = melomingCredentials();
  if ("error" in creds) {
    return NextResponse.json(
      { type: "server_not_configured", message: creds.error },
      { status: 503 },
    );
  }

  const verifier = randomBase64Url(32);
  const challenge = pkceChallenge(verifier);
  const state = randomBase64Url(16);
  const redirectUri = resolveRedirectUri(request.nextUrl.origin);

  await clearPkceCookies();
  await setPkceCookies({ state, verifier, redirectUri });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  return NextResponse.redirect(authorizeUrl);
}
