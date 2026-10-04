import type { EvidencePlanModelOutput, EvidencePlanSource, EvidenceReviewInput, CompiledEvidencePlan } from '../types/evidence-plan';

// Entirely fictional. None of the historic JD/profile/report fixtures are imported.
const requirements = [
  ['qualification','本科及以上学历。','degree'],
  ['qualification','毕业时间为2026年9月至2027年8月。','graduation'],
  ['qualification','最高学历毕业后无全职工作经验。','fulltime_after_graduation'],
  ['core_duty','提出用户需求并设计功能方案。','design'],
  ['core_duty','比较AI产品并说明适用场景。','comparison'],
  ['core_duty','完成原型或项目的快速验证与迭代。','iteration'],
  ['core_duty','追踪产品指标，开展数据分析与实验迭代。','metrics'],
  ['core_duty','与不同分工的伙伴沟通需求和推进任务。','coordination'],
  ['core_duty','理解客户反馈并记录需求。','customer_need'],
  ['core_duty','组织用户验证并依据结果调整方案。','user_validation'],
  ['core_duty','参与正式上线交付并处理稳定性问题。','delivery'],
  ['preferred','有AI工具或Agent项目实践者优先。','iteration'],
  ['preferred','有实习或项目中的快速验证经验者优先。','iteration'],
  ['preferred','有团队任务优先级安排经验者优先。','prioritization'],
] as const;
const jdItems=requirements.map(([kind,exactText],i)=>({jdId:`D${String(i+1).padStart(2,'0')}`,kind,exactText}));
export const evidencePlanDemoSource:EvidencePlanSource={
  binding:{draftId:'fictional-draft',draftRevision:1,confirmationDigest:'fictional-confirmation',profileVersion:1},
  jdText:jdItems.map(i=>`${i.jdId} ${i.exactText}`).join('\n'),jdItems,
  profile:{structureVersion:'1.0.0',targetDirections:['虚构产品助理'],facts:[
    {factId:'F01',category:'education',context:'education',statement:'虚构同学正在攻读本科，预计2027年6月毕业。'},
    {factId:'F02',category:'project',context:'personal_project',statement:'个人桌面助手项目中提出文件归档需求，设计确认按钮，并借助Agent调整工作流。仅自己试用，没有用户验证或企业上线。'},
    {factId:'F03',category:'project',context:'personal_project',statement:'个人比较两种虚构AI工具，记录适用场景和局限。'},
    {factId:'F04',category:'project',context:'campus',statement:'校园活动项目中与宣传和技术同学沟通需求，安排团队任务优先级。'},
    {factId:'F05',category:'work',context:'entrepreneurship',statement:'自营工作室中记录客户反馈与需求；不是企业正式任职。'},
    {factId:'F06',category:'project',context:'personal_project',statement:'搭建个人知识整理工作流，没有产品指标追踪、数据实验或用户验证。'},
    {factId:'F07',category:'preference',context:'self_report',statement:'偏好有条理的任务安排与跨团队沟通。'},
    {factId:'F08',category:'project',context:'competition',statement:'比赛中制作演示原型并依据评委反馈迭代；不是生产上线。'},
  ]},
  actions:[
    {key:'degree',factId:'F01',quote:'正在攻读本科',capability:'degree'},
    {key:'graduate',factId:'F01',quote:'预计2027年6月毕业',capability:'graduation'},
    {key:'design',factId:'F02',quote:'提出文件归档需求，设计确认按钮',capability:'design'},
    {key:'iterate',factId:'F02',quote:'借助Agent调整工作流',capability:'iteration'},
    {key:'compare',factId:'F03',quote:'记录适用场景和局限',capability:'comparison'},
    {key:'coordinate',factId:'F04',quote:'与宣传和技术同学沟通需求',capability:'coordination'},
    {key:'prioritize',factId:'F04',quote:'安排团队任务优先级',capability:'prioritization'},
    {key:'customer',factId:'F05',quote:'记录客户反馈与需求',capability:'customer_need'},
    {key:'knowledge',factId:'F06',quote:'搭建个人知识整理工作流',capability:'knowledge'},
    {key:'preference',factId:'F07',quote:'偏好有条理的任务安排与跨团队沟通',capability:'prioritization'},
    {key:'competition',factId:'F08',quote:'制作演示原型并依据评委反馈迭代',capability:'iteration'},
  ],
  scopes:requirements.map(([kind,,capability],i)=>({jdId:jdItems[i].jdId,capabilities:[capability],
    ...(kind==='qualification'?{qualificationStatus:i===1?'meets' as const:'needs_confirmation' as const}:{})})),
};
const choices:Record<string,{actionKey:string;evidenceType:'qualification'|'personal_practice'|'same_task'|'transferable'}[]>={
  D01:[{actionKey:'degree',evidenceType:'qualification'}],D02:[{actionKey:'graduate',evidenceType:'qualification'}],
  D04:[{actionKey:'design',evidenceType:'personal_practice'}],D05:[{actionKey:'compare',evidenceType:'personal_practice'}],
  D06:[{actionKey:'iterate',evidenceType:'personal_practice'},{actionKey:'competition',evidenceType:'transferable'}],
  D08:[{actionKey:'coordinate',evidenceType:'transferable'}],D09:[{actionKey:'customer',evidenceType:'same_task'}],
  D12:[{actionKey:'iterate',evidenceType:'personal_practice'}],D13:[{actionKey:'iterate',evidenceType:'personal_practice'}],
  D14:[{actionKey:'prioritize',evidenceType:'transferable'}],
};
const missing=[
  '需确认本科最终完成情况；在读不能冒充已取得学位。','日期窗口满足；不代表已取得学位或所有校招条件满足。',
  '画像未声明毕业后全职经历，应询问本人。','已有个人需求与功能设计；完整PRD、外部用户验证与企业交付仍缺证据。',
  '仅个人产品比较，未证明企业选型效果。','个人迭代和比赛原型分开记录；缺真实用户验证和生产交付。',
  '知识整理不能替代产品指标、数据分析和实验；暂无线索不等于不存在经历。',
  '校园协调可迁移，企业跨职能协作尚无证据。','工作室客户反馈属于同类任务，但不等于正式企业客户成功任职。',
  '自己试用不等于组织用户验证。','比赛演示不等于正式上线或稳定性处理。','支持个人Agent实践，未证明企业运行效果。',
  'JD允许项目路径，个人快速迭代可有限支持；未声明必须企业项目。','校园任务安排可迁移；偏好不是已完成任务。',
];
export const evidencePlanDemoReviewed:EvidenceReviewInput={
  contractVersion:'evidence-plan-prototype/1',binding:{...evidencePlanDemoSource.binding},planRevision:15,acknowledged:true,
  rows:jdItems.map((i,index)=>{
    const selections=choices[i.jdId]??[];
    return {jdId:i.jdId,choice:selections.length?'limited_support':'no_clue',selections,
      existingAction:selections.map(s=>evidencePlanDemoSource.actions.find(a=>a.key===s.actionKey)!.quote).join('；'),
      missingScope:missing[index],checked:true};
  }),
};
/** Deterministic local mock. No HTTP or model imports. */
export function evidencePlanMockOutput(plan:CompiledEvidencePlan):EvidencePlanModelOutput{
  return {planDigest:plan.planDigest,answers:plan.slots.map(s=>({slotKey:s.slotKey,
    explanation:s.choice==='no_clue'?'当前核对材料暂无线索，不能断言用户没有相关经历。':`当前材料提供有限支持。${s.existingAction}。${s.missingScope}`,
    links:s.links.map(l=>({linkKey:l.linkKey,connection:`来源动作仅在${l.context}场景发生。`,boundary:s.missingScope})),
    missingAspects:[s.missingScope]}))};
}
