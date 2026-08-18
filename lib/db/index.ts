import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as tables from "./tables";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — copy .env.example to .env");

/**
 * Next dev reloads modules on every edit; without caching the client on
 * globalThis each reload opens a new pool and Postgres runs out of connections.
 */
const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
const client = globalForDb.__pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__pg = client;

export const db = drizzle(client, { schema: tables });
export * from "./tables";
