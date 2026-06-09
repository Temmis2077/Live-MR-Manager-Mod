import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { OAuthCallbackClient } from "@/components/OAuthCallbackClient";

export const metadata = {
  title: "OAuth 콜백",
};

export default function OAuthCallbackPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Suspense
          fallback={
            <div className="oauth-box">
              <h1>처리 중…</h1>
            </div>
          }
        >
          <OAuthCallbackClient />
        </Suspense>
      </main>
    </>
  );
}
