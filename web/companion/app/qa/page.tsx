import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = {
  title: "Q&A",
  description: "Live MR Manager와 멜로밍 노래책 연동 질문과 답변",
};

export default function QaPage() {
  return (
    <>
      <SiteHeader currentPath="/qa" />
      <main>
        <section className="hero">
          <span className="badge">Q&A</span>
          <h1>궁금한 점이 있으신가요?</h1>
          <p>
            설치, 멜로밍 연동(치지직·SOOP·씨미), 곡 정보·동기화에 대한 답변을 FAQ에 모아 두었습니다.
            더 많은 주제는 순차적으로 추가할 예정입니다.
          </p>
        </section>
        <article className="card">
          <h2>자주 묻는 질문</h2>
          <p>
            채널 주소 입력, 노래책 가져오기, (보내기·로그인 — 개발 중), 숙련도·난이도
            설명 등을 FAQ에서 확인할 수 있습니다.
          </p>
          <Link href="/faq" className="btn btn-primary">
            FAQ 보기
          </Link>
        </article>
      </main>
    </>
  );
}
