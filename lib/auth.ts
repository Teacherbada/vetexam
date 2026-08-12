import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const pool = new Pool({
  connectionString,
  max: 5,
});

const sql = neon(connectionString);

export const auth = betterAuth({
  database: pool,

  baseURL:
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL,

  secret: process.env.BETTER_AUTH_SECRET,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await sql`
              INSERT INTO subscriptions (
                user_id,
                plan,
                status
              )
              VALUES (
                ${user.id},
                'free',
                'active'
              )
              ON CONFLICT (user_id) DO NOTHING
            `;

            console.log(
              "Subscription: 已建立免費方案",
              user.id
            );
          } catch (error) {
            console.error(
              "Subscription: 建立失敗",
              error
            );
          }
        },
      },
    },
  },
});