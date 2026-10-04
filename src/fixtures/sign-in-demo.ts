import type { SignInResult } from "../types/sign-in";

/** No account, password, token or session is included in these display fixtures. */
export const signInSuccessDemo: SignInResult = { ok: true, data: { authenticated: true } };
export const signInRejectedDemo: SignInResult = {
  ok: false, error: { code: "UNAUTHENTICATED", message: "请登录，或检查邮箱和密码。" },
};
export const signInRateLimitedDemo: SignInResult = {
  ok: false, error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后重试。" },
};
export const signInUnavailableDemo: SignInResult = {
  ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "服务暂不可用，请稍后重试。" },
};
