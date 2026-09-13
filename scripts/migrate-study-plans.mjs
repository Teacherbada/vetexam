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
  const schema = await client.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('user', 'questions', 'question_answer_stats', 'study_plans') AND column_name IN ('id', 'user_id', 'subject', 'chapter', 'mode', 'is_correct', 'created_at', 'updated_at') ORDER BY table_name, ordinal_position");
  console.log(JSON.stringify(schema.rows));
  const migration = readFileSync(new URL("../migrations/20260913_study_plans.sql", import.meta.url), "utf8");
  await client.query(migration);
  await client.query(migration);
  await client.query(process.argv.includes("--apply") ? "COMMIT" : "ROLLBACK");
  console.log(process.argv.includes("--apply") ? "Study plans migration applied." : "Study plans migration dry run passed; rolled back.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Study plans migration failed; no partial changes committed.", error.code ?? "connection/configuration error");
  process.exitCode = 1;
} finally { await client.end(); }
