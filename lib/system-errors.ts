import "server-only";
import { neon } from "@neondatabase/serverless";
import { systemErrorEvents, type SystemErrorEvent, type SystemErrorKind } from "@/lib/system-error-events";

function errorKind(error: unknown): SystemErrorKind {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
    if (error.name === "NeonDbError") return "database";
  }
  return "unexpected";
}

// Only fixed event codes and a coarse classification leave this function.
// Do not persist error messages, stacks, request data, or user identifiers.
export async function recordSystemError(event: SystemErrorEvent, error: unknown): Promise<void> {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !Object.hasOwn(systemErrorEvents, event)) return;
    const sql = neon(databaseUrl, { fetchOptions: { signal: AbortSignal.timeout(1500) } });
    await sql`INSERT INTO system_errors (event_code, error_kind) VALUES (${event}, ${errorKind(error)})`;
  } catch {
    // No recursive logging. A database outage can also prevent error recording.
    console.error("System error recording unavailable.");
  }
}
