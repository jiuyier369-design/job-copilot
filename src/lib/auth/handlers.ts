import { ApiError, invalid, readJson, respond, success, unavailable } from "../api/http.ts";
import { object, text } from "../report/schema.ts";

interface AuthFailure { status?: number; code?: string }
export interface AuthPort {
  getUser(): Promise<{ data: { user: { id: string } | null }; error: AuthFailure | null }>;
  signInWithPassword(input: { email: string; password: string }): Promise<{ error: AuthFailure | null }>;
  signOut(options: { scope: "local" }): Promise<{ error: AuthFailure | null }>;
}
const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "请登录，或检查邮箱和密码。");
function authFailure(error: AuthFailure): never {
  if (error.status === 429) throw new ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。");
  if (error.code === "session_not_found" || error.code === "refresh_token_not_found" || error.code === "bad_jwt"
    || (error.status !== undefined && [400, 401, 403].includes(error.status))) throw unauthenticated();
  throw unavailable();
}
export async function verifiedUser(auth: AuthPort): Promise<string> {
  const { data, error } = await auth.getUser();
  // Supabase AuthSessionMissingError may omit code, but has status 400.
  if (error) authFailure(error);
  if (!data.user) throw unauthenticated();
  return data.user.id;
}
export function authHandlers(getAuth: () => Promise<AuthPort>) {
  return {
    session: () => respond(async () => { await verifiedUser(await getAuth()); return success({ authenticated: true }); }),
    signIn: (request: Request) => respond(async () => {
      const body = await readJson(request);
      const errors: string[] = [];
      object({ email: text, password: text })(body, "input", errors);
      if (errors.length) throw invalid(errors);
      const { email, password } = body as { email: string; password: string };
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 1024) throw invalid();
      const { error } = await (await getAuth()).signInWithPassword({ email, password });
      if (error) authFailure(error);
      return success({ authenticated: true });
    }),
    signOut: (request: Request) => respond(async () => {
      const body = await readJson(request);
      const errors: string[] = []; object({})(body, "input", errors);
      if (errors.length) throw invalid(errors);
      const { error } = await (await getAuth()).signOut({ scope: "local" });
      if (error) authFailure(error);
      return success({ authenticated: false });
    }),
  };
}
