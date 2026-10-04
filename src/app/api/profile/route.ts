import { requireUser } from "@/lib/auth/require-user";
import { profileHandlers } from "@/lib/profile/handlers";
import { profileRepository } from "@/lib/profile/repository";

const handlers = profileHandlers(async () => {
  const { supabase, userId } = await requireUser();
  return { userId, repository: profileRepository(supabase) };
});
export const GET = handlers.GET;
export const PUT = handlers.PUT;
