import { GUIDES, type GuideKey } from "@/lib/guidance";

/**
 * Hebrew operator guidance, folded away behind a marker.
 *
 * It used to sit open above every section, which meant the page was mostly
 * explanation and the controls were pushed below the fold. The reasoning still
 * matters - it is why the field exists at all - but it is reference material:
 * read once, then in the way. Collapsed, it stays one click from what it
 * describes. Rendered RTL; the rest of the app is LTR because everything a
 * supplier sees is English.
 */
export function Guide({ k }: { k: GuideKey }) {
  const guide = GUIDES[k];

  return (
    <details className="guide" dir="rtl">
      <summary>
        <span className="guide-mark">?</span> {guide.title}
      </summary>
      {"paragraphs" in guide &&
        guide.paragraphs?.map((p) => (
          <p key={p} style={{ margin: "5px 0 0" }}>
            {p}
          </p>
        ))}
      {"bullets" in guide && guide.bullets && (
        <ul>
          {guide.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {"good" in guide && guide.good && (
        <p style={{ margin: "6px 0 0" }}>
          <span className="good">✓</span>{" "}
          <span dir="ltr">
            {guide.good.map((g, i) => (
              <span key={g}>
                {i > 0 && " · "}
                <code>{g}</code>
              </span>
            ))}
          </span>
        </p>
      )}
      {"bad" in guide && guide.bad && (
        <p style={{ margin: "3px 0 0" }}>
          <span className="bad">✗</span>{" "}
          <span dir="ltr">
            {guide.bad.map((b, i) => (
              <span key={b}>
                {i > 0 && " · "}
                <code>{b}</code>
              </span>
            ))}
          </span>
        </p>
      )}
    </details>
  );
}
