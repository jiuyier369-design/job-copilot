import type { JdDraft } from "../types/jd-review.ts";
import { transitionDraft } from "../lib/jd/transition.ts";

export const jdDemoText = "岗位职责\n1、收集客户需求；整理反馈并协助跟进问题。\n2、维护产品使用说明。\n任职要求\n• 本科在读或应届毕业。\n• 能清晰表达并整理文档。\n加分项\n有个人 AI 应用实践优先。\n公司介绍\n以下是虚构演示岗位，不代表真实招聘信息。";
export const jdUnclassifiedText = "协助整理需求，同时跟进客户问题。\n其他说明：\n根据实际安排参与团队工作。";
const settings = { id: "22222222-2222-4222-8222-222222222222", now: "2026-09-29T00:00:00Z", digest: () => "0".repeat(64) };
export const jdSuggestedDemo = transitionDraft(null, { action: "create", rawText: jdDemoText }, settings)!;
export const jdUnclassifiedDemo = transitionDraft(null, { action: "create", rawText: jdUnclassifiedText }, settings)!;
export const jdConfirmedDemo: JdDraft = transitionDraft(jdSuggestedDemo, {
  action: "confirm", id: jdSuggestedDemo.id, expectedRevision: 1, acknowledged: true,
}, settings)!;
