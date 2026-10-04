import type { ApiResult, ProfileResource } from "../types/api";

/** Synthetic UI data. No relationship to an authenticated account. */
export const profileEditorDemo: ProfileResource = {
  version: 1, updatedAt: "2026-09-28T00:00:00.000Z",
  profile: { structureVersion: "1.0.0", targetDirections: ["客户成功"], facts: [
    { factId: "DEMO-P1", category: "education", context: "education", statement: "演示：预计 2027 年本科毕业。" },
    { factId: "DEMO-P2", category: "project", context: "personal_project", statement: "演示：使用 AI Agent 制作个人求职工具；不代表独立开发能力。" },
  ] },
};
export const profileConflictDemo: ApiResult<ProfileResource> = {
  ok: false, error: { code: "PROFILE_VERSION_CONFLICT", message: "画像已有新版本，请保留草稿并重新加载后核对。" },
};
export const profileInvalidDemo: ApiResult<ProfileResource> = {
  ok: false, error: { code: "INVALID_INPUT", message: "请检查事实内容。", issues: ["事实内容不能为空。"] },
};
