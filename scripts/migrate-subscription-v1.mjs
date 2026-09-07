import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 20000 });
try {
  if (!process.env.DATABASE_URL) throw new Error("Database required");
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path TO public");
  const before = (await client.query("SELECT id,plan,status,expires_at,current_period_end,access_source FROM subscriptions ORDER BY id")).rows;
  const sql = readFileSync(new URL("../migrations/20260907_subscription_backend_v1.sql", import.meta.url), "utf8");
  await client.query(sql);
  await client.query(sql);
  const after = (await client.query("SELECT id,plan,status,expires_at,current_period_end,access_source FROM subscriptions ORDER BY id")).rows;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Existing subscriptions changed");
  await client.query(process.argv.includes("--apply") ? "COMMIT" : "ROLLBACK");
  console.log(process.argv.includes("--apply") ? "Subscription V1 additive migration applied; existing subscriptions unchanged." : "Migration rerun validated and rolled back; existing subscriptions unchanged.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Subscription V1 migration failed; rolled back.", { code: error.code ?? "validation" });
  process.exitCode = 1;
} finally { await client.end(); }
