import type {Report,TaskAssessment} from '../../src/types/job-copilot.ts';
import type {ReportContext} from '../../src/lib/report/validate.ts';

/** Entirely fictional. None of these texts, references or results come from private review packages. */
export function semanticFixture(direction:'product'|'success'|'solutions'='product'){
  const taskText={product:'参与 AI 产品需求调研、方案设计与完整 PRD，推动想法落地。',
    success:'设计客户使用 AI 助手的功能方案并快速验证。',solutions:'提出 AI 助手方案设计并用 AI Coding 快速验证。'}[direction];
  const context:ReportContext={jdText:'',jdItems:[
    {jdId:'S-Q-date',kind:'qualification',exactText:'预计毕业日期为 2026 年 9 月至 2027 年 8 月。'},
    {jdId:'S-Q-work',kind:'qualification',exactText:'最高学历毕业后无全职工作经验。'},
    {jdId:'S-D-design',kind:'core_duty',exactText:taskText},
    {jdId:'S-D-metrics',kind:'core_duty',exactText:'跟踪产品核心指标并进行数据分析与实验验证。'},
    {jdId:'S-D-team',kind:'core_duty',exactText:'协调团队完成任务。'},
    {jdId:'S-P-project',kind:'preferred',exactText:'AI 产品实习或项目经历优先。'},
    {jdId:'S-P-quick',kind:'preferred',exactText:'利用 AI Coding 快速验证 AI 助手功能优先。'},
    {jdId:'S-P-major',kind:'preferred',exactText:'计算机或人工智能相关专业优先。'},
  ],profile:{structureVersion:'1.0.0',targetDirections:[],facts:[
    {factId:'S-F-date',category:'education',context:'education',statement:'本科预计 2027 年 6 月毕业。'},
    {factId:'S-F-project',category:'project',context:'personal_project',statement:'在个人 AI 助手中提出需求、设计功能，用 Agent 辅助改造并迭代。'},
    {factId:'S-F-workflow',category:'project',context:'personal_project',statement:'用 AI 做个人知识管理与资料整理，记录复盘工作流。'},
    {factId:'S-F-preference',category:'preference',context:'self_report',statement:'偏好有客户接触的工作。'},
    {factId:'S-F-team',category:'project',context:'campus',statement:'校园项目中协调队友完成分工。'},
  ]}};
  context.jdText=context.jdItems.map(j=>j.exactText).join('\n');
  const supported=(jdId:string):TaskAssessment=>({jdId,evidenceType:'personal_practice',evidenceLinks:[{
    evidenceType:'personal_practice',factIds:['S-F-project'],connection:'个人场景中提出需求、设计功能和 Agent 辅助迭代提供有限支持。',
    boundary:'个人项目，不等于正式企业交付或完整 PRD。'}],missingAspects:['完整 PRD、真实用户验证及正式企业跨职能交付尚无证据。'],
    needsUserConfirmation:true,explanation:'已有个人迭代的有限支持，企业交付范围尚未证明。'});
  const report:Report={materialFit:{level:'partial',summary:'个人 AI 助手迭代有限支持方案任务，产品指标追踪及企业交付尚无证据。',
    supportingJdIds:['S-D-design'],limitingJdIds:['S-D-metrics']},applicationAction:{category:'verify_first',
    summary:'先核验毕业后全职经历这一未知资格，再由用户决定是否投递。缺实习只影响竞争力。',verificationItemIndexes:[0]},
    qualifications:[{jdId:'S-Q-date',status:'meets',factIds:['S-F-date'],explanation:'预计毕业日期落在窗口内，不证明已经取得学位。'},
      {jdId:'S-Q-work',status:'needs_confirmation',factIds:[],explanation:'没有关于毕业后全职经历的事实。'}],
    coreDuties:[supported('S-D-design'),{jdId:'S-D-metrics',evidenceType:'no_evidence',evidenceLinks:[],
      missingAspects:['产品核心指标、数据分析与实验迭代任务尚无证据。'],needsUserConfirmation:true,explanation:'知识整理不是产品指标证据。'},
      {jdId:'S-D-team',evidenceType:'transferable',evidenceLinks:[{evidenceType:'transferable',factIds:['S-F-team'],
        connection:'校园项目中协调队友的动作可迁移。',boundary:'校园场景，不是企业经验。'}],missingAspects:['企业团队协调尚无证据。'],
        needsUserConfirmation:true,explanation:'校园团队协调有限迁移，偏好不充当任务证据。'}],
    preferredItems:[supported('S-P-project'),supported('S-P-quick'),{jdId:'S-P-major',evidenceType:'no_evidence',evidenceLinks:[],
      missingAspects:['相关专业加分未证明。'],needsUserConfirmation:true,explanation:'仅缺专业加分，不构成硬门槛。'}],
    inferences:[],resumeSuggestions:[{jdIds:['S-D-design'],factIds:['S-F-project'],
      suggestedWording:'在个人 AI 助手场景提出需求、设计功能，并用 Agent 辅助迭代。',factualBoundary:'仅个人实践，企业交付未证明。'}],
    verificationItems:[{jdIds:['S-Q-work'],question:'最高学历毕业后有无全职工作经验？',reason:'影响校招资格。',
      askWhomOrHow:'先询问本人，再向招聘方核对计算口径。',answerImpacts:['如有需核对是否失去资格。','如无可继续评估任务适配。']}]};
  return {context,report};
}
