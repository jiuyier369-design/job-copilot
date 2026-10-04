import { authHandlers } from "@/lib/auth/handlers";
import { createClient } from "@/lib/supabase/server";
export const POST = authHandlers(async () => (await createClient()).auth).signOut;
