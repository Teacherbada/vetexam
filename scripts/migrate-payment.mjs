import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 15000 });
try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  await client.connect();
  await client.query("BEGIN");
  await client.query(readFileSync(new URL("../migrations/20260906_payment_foundation.sql", import.meta.url), "utf8"));
  await client.query(process.argv.includes("--apply") ? "COMMIT" : "ROLLBACK");
  console.log(process.argv.includes("--apply") ? "Payment foundation migration applied." : "Payment foundation dry run passed; rolled back.");
} catch {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Payment foundation migration failed; no partial changes committed.");
  process.exitCode = 1;
} finally { await client.end(); }
