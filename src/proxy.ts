import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refresh page cookies. API handlers refresh independently and verify getUser on each request. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Existing pages are explicitly public fixtures, not protected account pages.
  if (!url || !key) return response;
  const client = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });
  try { await client.auth.getUser(); } catch { /* Public demos remain readable during Auth outages. */ }
  return response;
}
export const config = { matcher: ["/profile/:path*", "/analyses/:path*"] };
