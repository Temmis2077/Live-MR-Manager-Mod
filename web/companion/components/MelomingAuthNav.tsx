"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Session = {
  loggedIn: boolean;
  nickname: string | null;
  profileImageUrl: string | null;
};

const EMPTY_SESSION: Session = {
  loggedIn: false,
  nickname: null,
  profileImageUrl: null,
};

export function MelomingAuthNav() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) {
        setSession(EMPTY_SESSION);
        return;
      }
      const data = (await res.json()) as Session;
      setSession(data);
    } catch {
      setSession(EMPTY_SESSION);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (session === null) {
    return <span className="auth-nav auth-nav-loading">…</span>;
  }

  if (!session.loggedIn) {
    return (
      <Link href="/login" className="auth-nav auth-nav-login">
        멜로밍 로그인
      </Link>
    );
  }

  const displayName = session.nickname || "멜로밍";

  return (
    <div className="auth-nav auth-nav-user">
      <Link href="/account" className="auth-nav-profile">
        {session.profileImageUrl ? (
          <img
            src={session.profileImageUrl}
            alt=""
            className="auth-nav-avatar"
            width={28}
            height={28}
          />
        ) : (
          <span className="auth-nav-avatar auth-nav-avatar-fallback" aria-hidden>
            {displayName.charAt(0)}
          </span>
        )}
        <span className="auth-nav-name">{displayName}</span>
      </Link>
      <button
        type="button"
        className="auth-nav-logout"
        onClick={logout}
        disabled={busy}
      >
        로그아웃
      </button>
    </div>
  );
}
