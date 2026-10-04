import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { jdRepository } from "@/lib/jd/repository";
import { jdHandlers } from "@/lib/jd/handlers";
const handlers = jdHandlers(async () => {
  const { userId } = await requireUser();
  return { userId, repository: jdRepository(createAdminClient()) };
});
export const GET = handlers.GET;
export const POST = handlers.POST;
