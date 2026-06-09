import { SiteHeader } from "@/components/SiteHeader";

export const metadata = {
  title: "멜로밍 로그인",
};

export default function LoginPage() {
  return (
    <>
      <SiteHeader currentPath="/login" />
      <main>
        <section className="oauth-box" style={{ marginTop: "2rem" }}>
          <span className="badge">웹 로그인</span>
          <h1>멜로밍 계정으로 로그인</h1>
          <p>
            브라우저에서 멜로밍 OAuth 로그인을 시도합니다. 로그인 후 이 사이트에
            세션이 저장되며, 토큰은 서버 쿠키(httpOnly)에만 보관됩니다.
          </p>
          <a href="/api/oauth/login" className="btn btn-primary">
            멜로밍 로그인 시작
          </a>
        </section>
      </main>
    </>
  );
}
