import Link from "next/link";
import { MelomingAuthNav } from "@/components/MelomingAuthNav";
import { SITE_NAME } from "@/lib/site";

const LINKS = [
  { href: "/", label: "홈" },
  { href: "/faq", label: "도움말" },
  { href: "/qa", label: "Q&A" },
  { href: "/download", label: "다운로드" },
];

type Props = {
  currentPath?: string;
};

export function SiteHeader({ currentPath = "/" }: Props) {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        {SITE_NAME}
      </Link>
      <div className="header-right">
        <nav className="nav" aria-label="주요 메뉴">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={currentPath === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <MelomingAuthNav />
      </div>
    </header>
  );
}
