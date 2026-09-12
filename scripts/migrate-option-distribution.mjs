import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  const migration = readFileSync(new URL("../migrations/20260912_option_distribution.sql", import.meta.url), "utf8");
  await client.query(migration);
  await client.query(migration);
  await client.query(process.argv.includes("--apply") ? "COMMIT" : "ROLLBACK");
  console.log(process.argv.includes("--apply") ? "Option distribution migration applied." : "Option distribution migration dry run passed; rolled back.");
} catch {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Option distribution migration failed; no partial changes committed.");
  process.exitCode = 1;
} finally { await client.end(); }
