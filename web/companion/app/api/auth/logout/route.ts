import { NextResponse } from "next/server";
import { clearPkceCookies, clearSessionCookies } from "@/lib/oauth-cookies";

export async function POST() {
  await clearSessionCookies();
  await clearPkceCookies();
  return NextResponse.json({ ok: true });
}
