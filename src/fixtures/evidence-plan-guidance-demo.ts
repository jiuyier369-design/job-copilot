import type { SourceGuidance } from '../types/evidence-plan-guidance';

/** Curated for the fictional W10 actions only; no inferred candidate counts or real-profile classifier. */
export const fictionalSourceGuidance: Record<string, SourceGuidance> = {
  degree: { why: '原句说明本科在读，可用于核对学历来源。', boundary: '在读不等于已经取得学位；学历来源不作为任务经验。' },
  graduate: { why: '原句给出预计毕业月份，可用于核对毕业日期条件。', boundary: '日期符合窗口不代表其它资格已满足，预计日期不是已经毕业。' },
  design: { why: '原句明确提出需求和设计按钮，对需求/功能设计有有限支持。', boundary: '只在个人桌面助手中发生；完整PRD、外部用户验证及企业交付尚未证明。' },
  iterate: { why: '原句描述借助Agent调整个人工作流，可支持个人迭代或Agent项目实践。', boundary: '只证明个人场景中的调整；不能推成产品指标实验、外部用户验证或企业上线。' },
  compare: { why: '原句记录工具适用场景和局限，与产品比较有关。', boundary: '仅个人比较，不能声称企业选型成果或商业效果。' },
  coordinate: { why: '原句描述与不同分工同学沟通需求。', boundary: '场景是校园；即使任务相似，也不变成正式企业跨职能经历。' },
  prioritize: { why: '原句描述已做过团队任务优先级安排，不是工作偏好。', boundary: '仅校园任务安排，不据此证明企业项目管理资历。' },
  customer: { why: '原句描述记录客户反馈和需求，与本条客户任务相关。', boundary: '场景是自营工作室，不代表正式企业客户成功任职或续约业绩。' },
  competition: { why: '原句描述演示原型和评委反馈迭代，与快速验证相关。', boundary: '场景是比赛；评委反馈不等于真实用户验证，演示不等于生产上线。' },
};
