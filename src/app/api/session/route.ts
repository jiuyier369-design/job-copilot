import { authHandlers } from "@/lib/auth/handlers";
import { createClient } from "@/lib/supabase/server";
export const GET = authHandlers(async () => (await createClient()).auth).session;
