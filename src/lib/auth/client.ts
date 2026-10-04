import type { ApiResult } from "../../types/api.ts";
import type { SignInInput, SignInResult } from "../../types/sign-in.ts";

const messages = {
  UNAUTHENTICATED: "请登录，或检查邮箱和密码。",
  RATE_LIMITED: "请求过于频繁，请稍后重试。",
  INVALID_INPUT: "请检查邮箱和密码格式。",
  FORBIDDEN_ORIGIN: "请求来源不被允许，请检查站点配置。",
  SERVICE_UNAVAILABLE: "服务暂不可用，请稍后重试。",
} as const;
function failed(code: keyof typeof messages = "SERVICE_UNAVAILABLE"): ApiResult<never> {
  return { ok: false, error: { code, message: messages[code] } };
}

/** Browser transport only. Cookies are managed by the browser; no token is exposed. */
export function createAuthClient(send: typeof fetch = fetch) {
  async function request<T extends boolean>(path: string, expected: T, body?: unknown): Promise<ApiResult<{ authenticated: T }>> {
    try {
      const response = await send(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(15000),
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json();
      if (!value || typeof value !== "object") return failed();
      const result = value as { ok?: unknown; data?: { authenticated?: unknown }; error?: { code?: unknown } };
      if (response.status === 200 && result.ok === true && result.data?.authenticated === expected) {
        return { ok: true, data: { authenticated: expected } };
      }
      if (!response.ok && result.ok === false && typeof result.error?.code === "string"
        && Object.hasOwn(messages, result.error.code)) {
        return failed(result.error.code as keyof typeof messages);
      }
      return failed();
    } catch { return failed(); }
  }
  const session = () => request("/api/session", true);
  return {
    session,
    async signIn(input: SignInInput): Promise<SignInResult> {
      const result = await request("/api/auth/sign-in", true, input);
      // A successful POST is insufficient if the browser did not accept the session cookie.
      return result.ok ? session() : result;
    },
    signOut: () => request("/api/auth/sign-out", false, {}),
  };
}
