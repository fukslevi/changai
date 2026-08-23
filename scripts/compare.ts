/** The comparison table, from the terminal. */
import { db, projects } from "../lib/db";
import { buildComparison } from "../lib/quotes/compare";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const all = await db.select().from(projects);
  const project = needle ? all.find((p) => p.name.toLowerCase().includes(needle)) : all[0];
  if (!project) process.exit(1);

  const c = await buildComparison(project.id);
  console.log(`${project.name}: ${c.suppliers.length} suppliers · ${c.refusals} refused the target`);
  if (c.targetByQty) {
    console.log("target: " + [...c.targetByQty].sort((a, b) => a[0] - b[0]).map(([q, v]) => `${q}=$${v.toFixed(2)}`).join("  "));
  }
  console.log(`acceptable gap: up to ${c.acceptableGapPct}%
`);

  console.log("gap%    price    target   qty    supplier");
  for (const s of c.suppliers) {
    if (s.lines.length === 0) {
      console.log(`  -      -        -        -      ${s.company}  [דוחה]`);
      continue;
    }
    for (const l of s.lines.slice(0, 4)) {
      const gap = l.gapPct === null ? "  -  " : `${l.gapPct >= 0 ? "+" : ""}${l.gapPct.toFixed(0)}%`;
      const mark = l.acceptable === null ? " " : l.acceptable ? "✓" : "✗";
      console.log(
        `${gap.padStart(6)} ${mark} $${(l.quotedFob ?? 0).toFixed(2).padStart(7)}` +
        ` $${(l.target ?? 0).toFixed(2).padStart(7)}  ${String(l.qty ?? "-").padStart(5)}  ${s.company.slice(0, 34)}`,
      );
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
