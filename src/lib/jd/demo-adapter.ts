import type { JdDraft, JdReviewAdapter, JdReviewErrorCode } from "../../types/jd-review.ts";
import { JdError } from "./content.ts";
import { parseJdCommand, transitionDraft } from "./transition.ts";

const messages: Record<JdReviewErrorCode, string> = {
  INVALID_INPUT: "请检查原文或拆分位置，不能生成空白条目。",
  JD_REVIEW_REQUIRED: "请核对并分类全部条目，至少保留一条非背景要求，然后明确确认。",
  JD_DRAFT_CONFLICT: "演示版本冲突：请保留输入，使用上方场景按钮重新载入后核对。",
  NOT_FOUND: "草稿已删除或不存在，请重新粘贴 JD。",
  UNAUTHENTICATED: "演示登录失效：输入已保留；这里不进行真实登录。",
  FORBIDDEN_ORIGIN: "请求来源不被允许。",
  SERVICE_UNAVAILABLE: "演示请求失败，结果未确认。请保留输入，不要自动重试。",
};
/** Browser-safe simulator only: no fetch, localStorage, database, Auth or paid model call. */
export function createJdDemoAdapter(options: {
  initial?: JdDraft | null; failOnce?: JdReviewErrorCode; delayMs?: number;
} = {}): JdReviewAdapter {
  let current = structuredClone(options.initial ?? null);
  let failure = options.failOnce;
  return {
    async execute(input) {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (failure) {
        const code = failure; failure = undefined;
        return { ok: false, error: { code, message: messages[code] } };
      }
      try {
        const command = parseJdCommand(input);
        current = transitionDraft(current, command, {
          id: "22222222-2222-4222-8222-222222222222", now: new Date().toISOString(), digest: () => "0".repeat(64),
        });
        return { ok: true, data: structuredClone(current) };
      } catch (error) {
        const code = error instanceof JdError ? error.code : "SERVICE_UNAVAILABLE";
        return { ok: false, error: { code, message: messages[code] } };
      }
    },
  };
}
