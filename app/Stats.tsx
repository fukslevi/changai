import type { ProjectStats } from "@/lib/project-stats";

/**
 * The funnel, on one line.
 *
 * A reply rate on its own flatters the work: sixteen of seventy-four factories
 * answered, which sounds like a third of a result. But a reply saying "we
 * cannot make this" is not a step towards buying anything, and each stage after
 * it loses most of what the one before produced. Showing the first number alone
 * hides where the loss actually is.
 *
 * The last stage is the only one that means the project is working. Everything
 * left of it is a rate that can look healthy while nothing arrives.
 */

function Stage({
  value,
  label,
  rate,
  dim,
}: {
  value: number;
  label: string;
  rate?: number | null;
  dim?: boolean;
}) {
  return (
    <span style={{ opacity: dim ? 0.45 : 1 }}>
      <strong style={{ fontSize: 13 }}>{value}</strong>{" "}
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
        {rate !== null && rate !== undefined && ` ${rate}%`}
      </span>
    </span>
  );
}

export function Stats({ stats }: { stats: ProjectStats }) {
  if (stats.contacted === 0) {
    return (
      <div className="muted" style={{ fontSize: 12.5 }} dir="rtl">
        עוד לא נשלחו פניות
      </div>
    );
  }

  const gap = stats.bestGapPct;
  const gapColour =
    gap === null ? "var(--muted)" : gap <= 20 ? "var(--ok)" : gap <= 50 ? "var(--warn)" : "var(--bad)";

  return (
    <div className="stack" style={{ gap: 3, marginTop: 4 }} dir="rtl">
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <Stage value={stats.contacted} label="נשלחו" />
        <span className="muted" style={{ fontSize: 11 }}>←</span>
        <Stage value={stats.replied} label="ענו" rate={stats.replyRatePct} dim={stats.replied === 0} />
        <span className="muted" style={{ fontSize: 11 }}>←</span>
        <Stage value={stats.quoted} label="תמחרו" rate={stats.quoteRatePct} dim={stats.quoted === 0} />
        <span className="muted" style={{ fontSize: 11 }}>←</span>
        <Stage value={stats.inRange} label="בטווח" dim={stats.inRange === 0} />
      </div>

      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        {gap !== null ? (
          <span style={{ fontSize: 12.5 }}>
            <span className="muted">הכי קרוב: </span>
            <strong style={{ color: gapColour }} dir="ltr">
              {gap >= 0 ? "+" : ""}
              {gap.toFixed(0)}%
            </strong>
            {stats.bestSupplier && <span className="muted"> · {stats.bestSupplier}</span>}
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12.5 }}>
            אין עדיין מחיר בר-השוואה
          </span>
        )}

        {/*
          Refusals are a finding about the price, not about the suppliers. Three
          factories independently saying a target cannot be met is the most
          useful thing on this line, and it only exists if it is shown.
        */}
        {stats.refused > 0 && (
          <span style={{ fontSize: 12.5, color: "var(--warn)" }}>
            {stats.refused} דחו את מחיר המטרה
          </span>
        )}
      </div>
    </div>
  );
}
