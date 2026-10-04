import type { ApplicationRecord, ApplicationStatus } from "../types/job-copilot";
import type { ApiResult } from "../types/api";

/** Synthetic display data. No company or application here represents a real submission. */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  preparing: "准备中",
  applied: "已投递",
  assessment: "测评中",
  interview: "面试中",
  offer: "录用沟通",
  closed: "已结束",
};

const userId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-09-28T00:00:00.000Z";
export const applicationsDemo: ApplicationRecord[] = [
  {
    id: "10000000-0000-4000-8000-000000000001", userId,
    analysisId: null, company: "示例企业甲", jobTitle: "AI 产品助理", city: "上海",
    direction: "AI 产品", appliedOn: null, status: "preparing",
    nextAction: "核对校招资格与岗位职责", notes: "演示记录，尚未真实投递。", createdAt, updatedAt: createdAt,
  },
  {
    id: "10000000-0000-4000-8000-000000000002", userId,
    analysisId: null, company: "示例企业乙", jobTitle: "客户成功顾问", city: "北京",
    direction: "客户成功", appliedOn: "2026-09-20", status: "applied",
    nextAction: "记录招聘方回复", notes: null, createdAt, updatedAt: createdAt,
  },
  {
    id: "10000000-0000-4000-8000-000000000003", userId,
    analysisId: null, company: "示例企业丙", jobTitle: "AI 应用运营", city: null,
    direction: "AI 应用运营", appliedOn: "2026-09-18", status: "assessment",
    nextAction: "完成线上测评", notes: "演示用备注。", createdAt, updatedAt: createdAt,
  },
  {
    id: "10000000-0000-4000-8000-000000000004", userId,
    analysisId: null, company: "示例企业丁", jobTitle: "解决方案助理", city: "杭州",
    direction: "解决方案", appliedOn: "2026-09-16", status: "interview",
    nextAction: "准备需求分析案例", notes: null, createdAt, updatedAt: createdAt,
  },
  {
    id: "10000000-0000-4000-8000-000000000005", userId,
    analysisId: null, company: "示例企业戊", jobTitle: "客户运营", city: "深圳",
    direction: "客户成功", appliedOn: "2026-09-10", status: "closed",
    nextAction: null, notes: "流程已结束。", createdAt, updatedAt: createdAt,
  },
];

export const applicationsEmptyDemo: ApplicationRecord[] = [];
export const applicationsErrorDemo: ApiResult<ApplicationRecord[]> = {
  ok: false,
  error: { code: "SERVICE_UNAVAILABLE", message: "暂时无法读取投递记录，请稍后重试。" },
};
