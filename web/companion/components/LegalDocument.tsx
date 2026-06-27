import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalSection } from "@/lib/legal/privacy-policy";

type Props = {
  sections: LegalSection[];
};

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

function renderLegalText(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  LINK_PATTERN.lastIndex = 0;
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const label = match[1];
    const href = match[2];
    const key = `${keyPrefix}-link-${index}`;

    if (href.startsWith("/")) {
      parts.push(
        <Link key={key} href={href}>
          {label}
        </Link>,
      );
    } else if (href.startsWith("http")) {
      parts.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    } else {
      parts.push(label);
    }

    lastIndex = match.index + match[0].length;
    index += 1;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function LegalDocument({ sections }: Props) {
  return (
    <article className="legal-doc">
      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="legal-section card"
        >
          <h2>{section.title}</h2>
          {section.paragraphs?.map((text) => (
            <p key={text.slice(0, 48)}>{renderLegalText(text, section.id)}</p>
          ))}
          {section.list && (
            <ul>
              {section.list.map((item) => (
                <li key={item.slice(0, 48)}>
                  {renderLegalText(item, `${section.id}-li`)}
                </li>
              ))}
            </ul>
          )}
          {section.table && (
            <div className="legal-table-wrap">
              <table className="legal-table">
                <thead>
                  <tr>
                    {section.table.headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row) => (
                    <tr key={row.join("|")}>
                      {row.map((cell) => (
                        <td key={cell}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {section.note && (
            <p className="legal-note">
              {renderLegalText(section.note, `${section.id}-note`)}
            </p>
          )}
        </section>
      ))}
    </article>
  );
}
