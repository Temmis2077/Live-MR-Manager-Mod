import { cookies } from "next/headers";

export const COOKIE_STATE = "lmrm_oauth_state";
export const COOKIE_VERIFIER = "lmrm_oauth_verifier";
export const COOKIE_REDIRECT_URI = "lmrm_oauth_redirect_uri";
export const COOKIE_ACCESS = "lmrm_access_token";
export const COOKIE_REFRESH = "lmrm_refresh_token";
export const COOKIE_EXPIRES = "lmrm_expires_at";

const PKCE_MAX_AGE = 60 * 10;
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function cookieBase() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function setPkceCookies(params: {
  state: string;
  verifier: string;
  redirectUri: string;
}) {
  const jar = await cookies();
  const base = cookieBase();
  jar.set(COOKIE_STATE, params.state, { ...base, maxAge: PKCE_MAX_AGE });
  jar.set(COOKIE_VERIFIER, params.verifier, { ...base, maxAge: PKCE_MAX_AGE });
  jar.set(COOKIE_REDIRECT_URI, params.redirectUri, {
    ...base,
    maxAge: PKCE_MAX_AGE,
  });
}

export async function clearPkceCookies() {
  const jar = await cookies();
  for (const name of [COOKIE_STATE, COOKIE_VERIFIER, COOKIE_REDIRECT_URI]) {
    jar.delete(name);
  }
}

export async function getPkceCookies() {
  const jar = await cookies();
  return {
    state: jar.get(COOKIE_STATE)?.value ?? null,
    verifier: jar.get(COOKIE_VERIFIER)?.value ?? null,
    redirectUri: jar.get(COOKIE_REDIRECT_URI)?.value ?? null,
  };
}

export async function setSessionCookies(params: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}) {
  const jar = await cookies();
  const base = cookieBase();
  const expiresAt =
    Math.floor(Date.now() / 1000) + Math.max(0, params.expiresIn);

  jar.set(COOKIE_ACCESS, params.accessToken, {
    ...base,
    maxAge: SESSION_MAX_AGE,
  });
  if (params.refreshToken) {
    jar.set(COOKIE_REFRESH, params.refreshToken, {
      ...base,
      maxAge: SESSION_MAX_AGE,
    });
  }
  jar.set(COOKIE_EXPIRES, String(expiresAt), {
    ...base,
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookies() {
  const jar = await cookies();
  for (const name of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_EXPIRES]) {
    jar.delete(name);
  }
}

export async function getSessionCookies() {
  const jar = await cookies();
  const accessToken = jar.get(COOKIE_ACCESS)?.value ?? null;
  const refreshToken = jar.get(COOKIE_REFRESH)?.value ?? null;
  const expiresAtRaw = jar.get(COOKIE_EXPIRES)?.value;
  const expiresAt = expiresAtRaw ? Number.parseInt(expiresAtRaw, 10) : null;

  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

export function isSessionValid(expiresAt: number | null): boolean {
  if (!expiresAt) return false;
  return Math.floor(Date.now() / 1000) + 60 < expiresAt;
}
