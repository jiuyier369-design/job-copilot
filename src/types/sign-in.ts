import type { ApiResult } from "./api";

export interface SignInInput { email: string; password: string }
export type SignInResult = ApiResult<{ authenticated: true }>;
/** UI-only callback boundary. Codex supplies real HTTP/authentication integration. */
export interface SignInFormProps {
  onSubmit: (input: SignInInput) => Promise<SignInResult>;
  onSuccess: () => void;
}
