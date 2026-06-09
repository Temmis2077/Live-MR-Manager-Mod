"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { appOAuthCallbackUrl } from "@/lib/site";

type Status =
  | "completing"
  | "success"
  | "app_redirect"
  | "error"
  | "missing";

export function OAuthCallbackClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("completing");
  const [detail, setDetail] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    async function run() {
      const code = searchParams.get("code")?.trim();
      const state = searchParams.get("state")?.trim();
      const error = searchParams.get("error") ?? undefined;
      const errorDescription =
        searchParams.get("error_description") ?? undefined;

      if (error) {
        if (!cancelled) {
          setStatus("error");
          setDetail(
            errorDescription ||
              "로그인이 완료되지 않았습니다. 다시 시도해 주세요.",
          );
        }
        return;
      }

      if (!code || !state) {
        if (!cancelled) {
          setStatus("missing");
          setDetail("로그인 정보를 받지 못했습니다.");
        }
        return;
      }

      let webReady = false;
      try {
        const checkRes = await fetch(
          `/api/oauth/pkce-check?state=${encodeURIComponent(state)}`,
          { cache: "no-store" },
        );
        if (checkRes.ok) {
          const check = (await checkRes.json()) as { webReady?: boolean };
          webReady = !!check.webReady;
        }
      } catch {
        webReady = false;
      }

      if (!webReady) {
        if (!cancelled) setStatus("app_redirect");
        window.location.href = appOAuthCallbackUrl({ code, state });
        return;
      }

      try {
        const res = await fetch("/api/oauth/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (!res.ok || !data.ok) {
          if (!cancelled) {
            setStatus("error");
            setDetail(data.message || "웹 로그인 완료에 실패했습니다.");
          }
          return;
        }
        if (!cancelled) {
          setStatus("success");
          router.replace("/account");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setDetail(
            err instanceof Error ? err.message : "웹 로그인 처리 중 오류",
          );
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  const titles: Record<Status, string> = {
    completing: "로그인 처리 중",
    success: "로그인 완료",
    app_redirect: "앱으로 돌아가는 중",
    error: "로그인에 실패했습니다",
    missing: "연결할 수 없습니다",
  };

  return (
    <div className="oauth-box">
      <span className="badge">멜로밍 로그인</span>
      <h1>{titles[status]}</h1>
      {status === "completing" ||
      status === "success" ||
      status === "app_redirect" ? (
        <p>잠시만 기다려 주세요…</p>
      ) : null}
      {status === "error" || status === "missing" ? (
        <>
          <p>{detail}</p>
          <Link href="/login" className="btn btn-primary">
            웹에서 다시 로그인
          </Link>
          <Link href="/" className="btn btn-secondary" style={{ marginLeft: "0.5rem" }}>
            홈으로
          </Link>
        </>
      ) : null}
    </div>
  );
}
