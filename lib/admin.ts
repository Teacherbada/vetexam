import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id || session.user.id !== process.env.ADMIN_USER_ID?.trim()) return null;
  const databaseUrl = process.env.DATABASE_URL;
  return databaseUrl ? { session, sql: neon(databaseUrl) } : null;
}
