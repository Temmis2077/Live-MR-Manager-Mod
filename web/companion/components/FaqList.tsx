"use client";

import { useMemo, useState } from "react";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "@/lib/faq-data";

export function FaqList() {
  const [category, setCategory] = useState("전체");

  const items = useMemo(() => {
    if (category === "전체") return FAQ_ITEMS;
    return FAQ_ITEMS.filter((item) => item.category === category);
  }, [category]);

  return (
    <>
      <div className="filter-row" role="tablist" aria-label="FAQ 카테고리">
        {FAQ_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`chip ${category === cat ? "chip-active" : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="faq-list">
        {items.map((item) => (
          <article key={item.id} className="faq-item" id={item.id}>
            <div className="faq-meta">{item.category}</div>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </>
  );
}
