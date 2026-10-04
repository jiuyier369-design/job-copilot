import type { FactCategory, FactContext } from "@/types/job-copilot";

/**
 * Chinese display labels for the frozen enums. Display-only: the value written
 * back into the form state is always the contract's original literal
 * ("education" / "personal_project" / ...), never the label.
 *
 * Context wording matches the report page so the same scenario is never described
 * with two different names across the product.
 */
export const categoryLabels: Record<FactCategory, string> = {
  education: "教育背景",
  work: "工作经历",
  project: "项目经历",
  skill: "技能",
  award: "奖项荣誉",
  preference: "求职偏好",
  constraint: "限制条件",
};

export const contextLabels: Record<FactContext, string> = {
  education: "教育背景",
  formal_work: "正式工作",
  entrepreneurship: "创业/工作室",
  campus: "校园组织",
  competition: "竞赛",
  personal_project: "个人项目",
  self_report: "个人陈述",
};

export const categoryOptions = Object.keys(categoryLabels) as FactCategory[];
export const contextOptions = Object.keys(contextLabels) as FactContext[];

export function categoryLabel(value: FactCategory): string {
  return categoryLabels[value] ?? value;
}

export function contextLabel(value: FactContext): string {
  return contextLabels[value] ?? value;
}
