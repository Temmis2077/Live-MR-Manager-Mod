import Link from "next/link";

const MELOMING_URL = "https://meloming.com";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Live MR Manager — 방송·연습용 MR 관리 앱. 음원은 내 PC에서만 처리됩니다.
      </p>
      <p>
        <Link href="/faq">도움말</Link>
        {" · "}
        <Link href="/download">다운로드</Link>
        {" · "}
        <a href={MELOMING_URL} target="_blank" rel="noopener noreferrer">
          멜로밍
        </a>
      </p>
    </footer>
  );
}
