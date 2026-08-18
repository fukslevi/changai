/**
 * Run the RFQ parser headlessly against whatever is uploaded.
 *
 *   npx tsx --env-file=.env scripts/parse-rfq.ts [projectId]
 *
 * Prints the extraction without writing to the database — use the "Parse RFQ"
 * button in the app for the persisting path.
 */
import { eq } from "drizzle-orm";
import { db, files, projects } from "../lib/db";
import { parseRfq } from "../lib/rfq/parse";

async function main() {
  const wanted = process.argv[2];

  const rows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      fileId: files.id,
      filename: files.filename,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      content: files.content,
    })
    .from(files)
    .innerJoin(projects, eq(files.projectId, projects.id))
    .where(eq(files.kind, "rfq"));

  const target = wanted ? rows.find((r) => r.projectId === wanted) : rows[0];

  if (!target) {
    console.log(
      rows.length === 0
        ? "No RFQ uploaded on any project yet."
        : `No RFQ on project ${wanted}. Available: ${rows.map((r) => r.projectId).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Project : ${target.projectName}  (${target.projectId})`);
  console.log(`File    : ${target.filename}  ${Math.round(target.sizeBytes / 1024)} KB\n`);
  console.time("parse");

  const { extraction, usage } = await parseRfq({
    filename: target.filename,
    mimeType: target.mimeType,
    content: target.content,
  });

  console.timeEnd("parse");
  console.log(
    `tokens  : ${usage.input_tokens} in / ${usage.output_tokens} out\n`,
  );

  console.log(`Product        : ${extraction.product_name}`);
  console.log(`Version/period : ${extraction.version ?? "—"} / ${extraction.period ?? "—"}`);
  console.log(`Currency       : ${extraction.currency}`);
  console.log(
    `Quantity tiers : ${extraction.quantity_tiers.length ? extraction.quantity_tiers.join(" / ") : "NONE FOUND"}`,
  );

  console.log(`\nITEMS (${extraction.items.length})`);
  for (const item of extraction.items) {
    const prices = item.target_prices.length
      ? item.target_prices.map((p) => `${p.qty}: ${p.unit_price ?? "—"}`).join("  ")
      : "no target price";
    console.log(`  • ${item.name}  [${item.kind}]`);
    console.log(`      ${prices}`);
    console.log(`      ${item.requirements.length} requirements`);
    if (item.parent_item_name) console.log(`      inside: ${item.parent_item_name}`);
  }

  console.log(`\nSHARED REQUIREMENTS (${extraction.shared_requirements.length})`);
  for (const r of extraction.shared_requirements) {
    console.log(`  • [${r.category}]${r.is_mandatory ? " *" : "  "} ${r.key}`);
    console.log(`      ${r.text.replace(/\s+/g, " ").slice(0, 110)}`);
  }

  console.log(`\nVALIDATION ISSUES (${extraction.validation_issues.length})`);
  for (const v of extraction.validation_issues) {
    console.log(`  ${v.severity === "error" ? "✗" : "!"} ${v.code}`);
    console.log(`      ${v.detail}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
