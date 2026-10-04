import type { ApiResult, ProfileResource, SaveProfileRequest } from "../../types/api.ts";
import { profileSchema } from "../report/schema.ts";

const messages = {
  UNAUTHENTICATED: "会话已失效，请在新页面登录后重试，当前草稿仍保留。",
  PROFILE_VERSION_CONFLICT: "画像已有新版本。当前草稿已保留，请重新读取后核对。",
  INVALID_INPUT: "请检查画像内容、事实编号和字段长度。",
  FORBIDDEN_ORIGIN: "请求来源不被允许，请检查站点配置。",
  SERVICE_UNAVAILABLE: "请求未能确认完成，请稍后重新读取并核对保存结果。",
} as const;
const failure = (code: keyof typeof messages = "SERVICE_UNAVAILABLE"): ApiResult<never> => ({ ok: false, error: { code, message: messages[code] } });
function validResource(value: unknown): value is ProfileResource {
  if (!value || typeof value !== "object") return false;
  const v = value as ProfileResource;
  const issues: string[] = [];
  profileSchema(v.profile, "profile", issues);
  return issues.length === 0 && Number.isSafeInteger(v.version) && v.version > 0
    && typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt))
    && new Set(v.profile.facts.map((f) => f.factId)).size === v.profile.facts.length;
}
export function createProfileClient(send: typeof fetch = fetch) {
  async function request(input?: SaveProfileRequest): Promise<ApiResult<ProfileResource | null>> {
    try {
      const response = await send("/api/profile", {
        method: input ? "PUT" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(15000),
        ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}),
      });
      const value = await response.json();
      if (response.status === 200 && value?.ok === true) {
        if (!input && value.data === null) return { ok: true, data: null };
        if (validResource(value.data) && (!input || value.data.version === (input.expectedVersion ?? 0) + 1)) {
          return { ok: true, data: value.data };
        }
      }
      if (!response.ok && value?.ok === false && typeof value.error?.code === "string" && Object.hasOwn(messages, value.error.code)) {
        return failure(value.error.code as keyof typeof messages);
      }
      return failure();
    } catch { return failure(); }
  }
  return {
    load: () => request(),
    async save(input: SaveProfileRequest): Promise<ApiResult<ProfileResource>> {
      const result = await request(input);
      if (!result.ok) return result;
      return result.data ? { ok: true, data: result.data } : failure();
    },
  };
}
