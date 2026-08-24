import type { NextAction } from "@/lib/next-action";

/**
 * What happens next, and when.
 *
 * The page could already say when the system last acted, which is the half of
 * the picture that causes worry rather than settling it: "last reply 7 hours
 * ago" reads as broken, when in fact replies wait for Chinese business hours
 * and seven hours of silence at two in the morning their time is the system
 * working exactly as intended.
 *
 * Every line carries its own reason, because the reasons are different - one is
 * a clock in another country, one is a queue, one is simply the next cycle -
 * and a single "next run at 20:00" would flatten three answers into one that is
 * wrong for two of them.
 */

const ICON: Record<NextAction["kind"], string> = {
  reply: "↩",
  outreach: "→",
  chase: "↻",
  idle: "·",
};

const COLOUR: Record<NextAction["kind"], string> = {
  reply: "var(--ok)",
  outreach: "var(--accent)",
  chase: "var(--warn)",
  idle: "var(--muted)",
};

function clock(date: Date): string {
  return new Date(date).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(date: Date, now: Date): string {
  const target = new Date(date);
  const days = Math.round(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );

  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days === 2) return "מחרתיים";
  return target.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

/**
 * "In about two hours" beats a timestamp for the common case.
 *
 * GitHub's scheduler is habitually twenty to thirty minutes late, so a precise
 * minute here would be a promise the system does not keep. The rounded distance
 * is both more useful and more honest.
 */
function distance(date: Date, now: Date): string {
  const minutes = Math.round((new Date(date).getTime() - now.getTime()) / 60_000);
  if (minutes <= 1) return "עכשיו";
  if (minutes < 60) return `בעוד ${minutes} דקות`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `בעוד כ-${hours} שעות`;
  return `${dayLabel(date, now)} ${clock(date)}`;
}

export function NextUp({ actions, now }: { actions: NextAction[]; now: Date }) {
  if (actions.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 6 }} dir="rtl">
      {actions.map((action, i) => (
        <div key={`${action.kind}-${i}`} className="stack" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
            <span style={{ color: COLOUR[action.kind], fontWeight: 600 }}>
              {ICON[action.kind]}
            </span>
            <span>{action.labelHe}</span>
            {action.at && (
              <span style={{ color: COLOUR[action.kind], fontSize: 13, fontWeight: 600 }}>
                {distance(action.at, now)}
              </span>
            )}
          </div>
          {action.whyHe && (
            <div className="muted" style={{ fontSize: 12.5, paddingRight: 20 }}>
              {action.whyHe}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
