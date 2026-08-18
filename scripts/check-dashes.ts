/**
 * Verify no long dashes reached any stored supplier-facing text.
 *
 *   npx tsx --env-file=.env scripts/check-dashes.ts
 *
 * Byte-level grep gives false positives here: box-drawing characters share a
 * lead byte with the dash block, so the check has to run per code point.
 */
import { db, projects } from "../lib/db";

const LONG_DASHES = /[‐-―−﹘﹣－]/u;

async function main() {
  const rows = await db.select().from(projects);
  let total = 0;

  for (const p of rows) {
    const text = `${p.outreachSubject ?? ""}\n${p.outreachBody ?? ""}`;
    const found = [...text].filter((c) => LONG_DASHES.test(c));
    total += found.length;

    const detail = found.length
      ? `${found.length} found -> ${[...new Set(found)]
          .map((c) => `U+${c.codePointAt(0)?.toString(16).toUpperCase()}`)
          .join(" ")}`
      : "clean";
    console.log(`${p.name.padEnd(28)} ${detail}`);
  }

  console.log(total === 0 ? "\nAll clear." : `\n${total} long dashes still stored.`);
  process.exit(total === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
