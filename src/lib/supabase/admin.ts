import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unavailable } from "../api/http";

/** Only validated JD mutations use this path; profile CRUD remains user-scoped. */
export function createAdminClient(transport?: typeof fetch) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key?.startsWith("sb_secret_")) throw unavailable();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, ...(transport ? { global: { fetch: transport } } : {}) });
}
