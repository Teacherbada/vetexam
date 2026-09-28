import { createAuthClient } from "better-auth/react";
import { fetchAuthSession } from "@/lib/auth-session-fetch";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BETTER_AUTH_URL,

  fetchOptions: {
    credentials: "include",
    cache: "no-store",
    customFetchImpl: fetchAuthSession,
  },
});
