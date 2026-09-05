import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const { loadEnvConfig } = nextEnv;
const { Client } = pg;

async function main() {
  loadEnvConfig(join(scriptDirectory, ".."));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  try {
    await client.connect();
    await client.query(readFileSync(join(scriptDirectory, "../migrations/20260905_system_errors.sql"), "utf8"));
    console.log("System errors migration applied (additive and safe to rerun).");
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("System errors migration failed. Check database connectivity and schema permissions.");
  process.exitCode = 1;
});
