"use client";

import { useEffect, useState } from "react";

/**
 * The rail down the side of a project.
 *
 * A sourcing project is one long page by nature - the RFQ, the model, the
 * shortlist and the conversations are all the same object, and splitting them
 * across routes would mean losing your place every time you answered something.
 * The rail keeps the whole shape visible and marks where the work is: a count
 * next to a section is the only thing that ever asks for attention.
 */
export interface NavSection {
  id: string;
  label: string;
  /** Rendered next to the label. Red when it is a to-do. */
  count?: number;
  urgent?: boolean;
  /** Sections that cannot act yet are dimmed rather than hidden. */
  dimmed?: boolean;
}

export function SideNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => Boolean(el));

    // rootMargin pulls the trigger line up near the top of the viewport, so the
    // highlighted item is the section you are reading, not the one below it.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="rail" dir="rtl" aria-label="ניווט בפרויקט">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={`rail-item${active === section.id ? " is-active" : ""}${
            section.dimmed ? " is-dimmed" : ""
          }`}
          onClick={() => setActive(section.id)}
        >
          <span>{section.label}</span>
          {section.count !== undefined && section.count > 0 && (
            <span className={`rail-count${section.urgent ? " is-urgent" : ""}`}>
              {section.count}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
