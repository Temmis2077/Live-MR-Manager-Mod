import { SiteHeader } from "@/components/SiteHeader";
import { AccountClient } from "@/components/AccountClient";

export const metadata = {
  title: "내 계정",
};

export default function AccountPage() {
  return (
    <>
      <SiteHeader currentPath="/account" />
      <main>
        <section className="hero">
          <span className="badge">멜로밍</span>
          <h1>내 계정</h1>
          <p>웹 로그인 세션과 OAuth 토큰 상태를 확인합니다.</p>
        </section>
        <AccountClient />
      </main>
    </>
  );
}
