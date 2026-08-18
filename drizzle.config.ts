import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/tables.ts",
  out: "./drizzle",
  // DDL through a transaction-mode pooler is unreliable — migrate on the
  // direct host, run the app on the pooled one.
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
});
