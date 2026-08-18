/** Sanity check: list the tables Drizzle created and their row counts. */
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });

  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;

  for (const { table_name } of rows) {
    const [count] = await sql.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM "${table_name}"`,
    );
    console.log(`${table_name.padEnd(26)} ${count?.n ?? "?"} rows`);
  }

  console.log(`\n${rows.length} tables`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
