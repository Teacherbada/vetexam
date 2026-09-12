import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import pg from "pg";
nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  await client.connect(); await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  const sql = readFileSync(new URL("../migrations/20260912_pdf_batch_imports.sql", import.meta.url), "utf8");
  await client.query(sql); await client.query(sql);
  await client.query(process.argv.includes("--apply") ? "COMMIT" : "ROLLBACK");
  console.log(process.argv.includes("--apply") ? "PDF batch migration applied." : "PDF batch migration dry run passed; rolled back.");
} catch {
  await client.query("ROLLBACK").catch(() => {});
  console.error("PDF batch migration failed; no partial changes committed."); process.exitCode = 1;
} finally { await client.end(); }
