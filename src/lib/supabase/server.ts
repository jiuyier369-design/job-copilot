import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { unavailable } from "../api/http";

/** Per-request user-scoped client. Never use a service-role key for user CRUD. */
export async function createClient(transport?: typeof fetch) {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw unavailable();
  }

  return createServerClient(url, publishableKey, {
    ...(transport ? { global: { fetch: transport } } : {}),
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Route-handler client: fail if cookies cannot be written, never report false success.
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
