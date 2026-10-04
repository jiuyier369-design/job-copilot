import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "./handlers";

/** Call in every future server mutation. Never accept a request body userId. */
export async function requireUser(transport?: typeof fetch) {
  const supabase = await createClient(transport);
  const userId = await verifiedUser(supabase.auth);
  return { supabase, userId };
}
