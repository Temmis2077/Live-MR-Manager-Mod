"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type SessionDetails = {
  loggedIn: boolean;
  nickname: string | null;
  expiresAt: number | null;
  scope: string | null;
  subject: string | null;
};

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return "—";
  const date = new Date(expiresAt * 1000);
  return date.toLocaleString("ko-KR");
}

export function AccountClient() {
  const [session, setSession] = useState<SessionDetails | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) {
      setSession({
        loggedIn: false,
        nickname: null,
        expiresAt: null,
        scope: null,
        subject: null,
      });
      return;
    }
    setSession((await res.json()) as SessionDetails);
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
    return <p>세션 확인 중…</p>;
  }

  if (!session.loggedIn) {
    return (
      <section className="card">
        <h2>로그인되지 않음</h2>
        <p>멜로밍 계정으로 로그인하면 토큰 상태를 이 페이지에서 확인할 수 있습니다.</p>
        <Link href="/login" className="btn btn-primary">
          멜로밍 로그인
        </Link>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>{session.nickname || "멜로밍"}</h2>
      <p>웹 로그인이 완료되었습니다.</p>
      <dl className="account-dl">
        <div>
          <dt>사용자 ID</dt>
          <dd>{session.subject || "—"}</dd>
        </div>
        <div>
          <dt>권한(scope)</dt>
          <dd>{session.scope || "—"}</dd>
        </div>
        <div>
          <dt>토큰 만료</dt>
          <dd>{formatExpiry(session.expiresAt)}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={logout}
        disabled={busy}
      >
        로그아웃
      </button>
    </section>
  );
}
