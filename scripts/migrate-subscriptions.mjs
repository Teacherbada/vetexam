import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 20000 });
try {
  if (!process.env.DATABASE_URL) throw new Error("Missing database URL");
  await client.connect();
  const columns = await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' ORDER BY ordinal_position");
  if (!columns.rows.length) throw new Error("Existing subscription table required");
  console.log("Existing subscription columns:", columns.rows);
  await client.query("BEGIN");
  await client.query(readFileSync(new URL("../migrations/20260906_subscription_core.sql", import.meta.url), "utf8"));
  const result = await client.query("SELECT plan,status,count(*)::int AS count FROM public.subscriptions GROUP BY plan,status");
  console.log("Validated subscription state counts:", result.rows);
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(apply ? "Subscription Core V1 migration applied." : "Dry run passed; all changes rolled back. Use --apply to persist.");
} catch {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Subscription migration failed; transaction rolled back. Inspect connectivity, schema and constraints before retrying.");
  process.exitCode = 1;
} finally {
  await client.end();
}
