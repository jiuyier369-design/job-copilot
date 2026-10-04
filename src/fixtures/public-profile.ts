/**
 * Invented profile content for the `/ui-preview/profile` Mock page.
 *
 * These facts describe a fictional person. They exist so the preview can show how
 * categories and contexts are labelled; they are never submitted anywhere and must
 * not be replaced with a real profile.
 *
 * The category/context wording mirrors `src/components/profile/labels.ts` so the
 * same scenario is never described with two different names across the product.
 */

export type ProfilePreviewFact = {
  readonly factId: string;
  readonly categoryLabel: string;
  readonly contextLabel: string;
  readonly statement: string;
};

/** Prefix marks every id as demo data, matching the existing fixture convention. */
export const profilePreviewDirections = "客户成功、AI 产品";

export const profilePreviewFacts: readonly ProfilePreviewFact[] = [
  {
    factId: "DEMO-W11-1",
    categoryLabel: "教育背景",
    contextLabel: "教育背景",
    statement: "演示：2027 年本科在读，专业方向与当前求职方向不同。",
  },
  {
    factId: "DEMO-W11-2",
    categoryLabel: "项目经历",
    contextLabel: "个人项目",
    statement: "演示：独立完成一个个人求职工具的界面与流程整理；不代表任何企业级交付经验。",
  },
  {
    factId: "DEMO-W11-3",
    categoryLabel: "技能",
    contextLabel: "个人陈述",
    statement: "演示：能整理需求文档并跟进问题闭环；尚无正式客户对接记录作为证据。",
  },
  {
    factId: "DEMO-W11-4",
    categoryLabel: "项目经历",
    contextLabel: "校园项目",
    statement: "演示：在校内工具试用中收集同学的使用反馈，并整理成待跟进的问题记录；不涉及企业客户。",
  },
];
