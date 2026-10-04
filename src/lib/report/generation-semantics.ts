import type {ProfileFact,Report} from '../../types/job-copilot.ts';
import type {ReportContext} from './validate.ts';
import {ReportValidationError} from './diagnostics.ts';

/** Bounded positive phrase rules, not a general semantic classifier. Unknown prose stays for manual review. */
const clauses=(text:string)=>text.split(/[。；;，,\n]|但是|但|不过/).map(s=>s.trim()).filter(Boolean);
const affirmative=(text:string,pattern:RegExp)=>clauses(text).some(s=>!/(?:未|没有|不具备|不曾|不自称|不能|并非|不代表|缺少|暂无|计划|希望|打算|偏好|想要)/.test(s)&&pattern.test(s));
const measurementTask=(text:string)=>/(?:产品|核心|业务)指标|指标追踪|追踪.{0,8}指标|数据分析|实验验证|实验迭代|A\/B/.test(text);
const personalIteration=(f:ProfileFact)=>f.category==='project'&&f.context==='personal_project'
  &&/(?:AI|智能|Agent|助手)/i.test(f.statement)
  &&affirmative(f.statement,/提出需求|需求设计|设计功能|功能设计/)
  &&affirmative(f.statement,/改造|迭代|推动修改|反馈问题/);
const knowledgeOnly=(f:ProfileFact)=>/个人知识管理|知识整理|资料整理|复盘工作流/.test(f.statement)
  &&!affirmative(f.statement,/定义.{0,8}(?:产品|核心|业务)指标|追踪.{0,8}(?:产品|核心|业务)指标|产品.{0,8}指标分析|用户行为数据分析|完成.{0,8}实验验证|A\/B.{0,8}实验/);
const nonTask=(f:ProfileFact)=>f.category==='preference'||f.category==='constraint';
const projectAlternative=(text:string)=>/实习(?:经历)?\s*(?:或|或者|\/)\s*(?:相关)?项目/.test(text);
const explicitlyEnterprise=(text:string)=>clauses(text).some(s=>!/(?:不要求|未要求|并非|无需)/.test(s)
  &&/必须.{0,12}(?:正式|企业)|(?:正式|企业)(?:实习|项目|环境|场景)|企业.{0,6}经历/.test(s));
const iterationTask=(text:string)=>!measurementTask(text)&&/(?:AI|智能|Agent|产品|助手)/i.test(text)
  &&(/需求调研|方案设计|功能定义|功能设计|推动想法落地|快速验证|AI Coding/.test(text)||projectAlternative(text));
const noFulltimeAfterGraduation=(text:string)=>/毕业后.{0,10}(?:无|没有|未有).{0,6}全职工作(?:经验|经历)/.test(text);

/** Generated from the server snapshot, never from model-supplied hints. No IDs or prose enter logs. */
export function generationEvidenceChecks(context:ReportContext){
  const personal=context.profile.facts.filter(personalIteration);
  return {
    nonTaskFactIds:context.profile.facts.filter(nonTask).map(f=>f.factId),
    tasks:context.jdItems.filter(j=>j.kind!=='qualification').map(j=>({jdId:j.jdId,
      limitedPersonalFactIds:iterationTask(j.exactText)&&!explicitlyEnterprise(j.exactText)?personal.map(f=>f.factId):[],
      excludedTaskFactIds:context.profile.facts.filter(f=>measurementTask(j.exactText)&&knowledgeOnly(f)).map(f=>f.factId),
    })).filter(t=>t.limitedPersonalFactIds.length||t.excludedTaskFactIds.length),
    priorityQualificationJdIds:context.jdItems.filter(j=>j.kind==='qualification'&&noFulltimeAfterGraduation(j.exactText)).map(j=>j.jdId),
  };
}

export const GENERATION_SEMANTIC_RULES=Object.freeze(['NON_TASK_FACT_AS_TASK_EVIDENCE','WORKFLOW_AS_MEASUREMENT_EVIDENCE',
  'RELATED_PERSONAL_SUPPORT_OMITTED','UNBOUNDED_PRACTICE_DENIAL','UNLISTED_ENTERPRISE_REQUIREMENT',
  'PREFERRED_AS_QUALIFICATION','ELIGIBILITY_REVIEW_NOT_PRIORITIZED'] as const);
export type GenerationSemanticRule=typeof GENERATION_SEMANTIC_RULES[number];

/** Only bounded positive assertions; legitimate missing enterprise experience/negated gates are allowed. */
const deniesPractice=(text:string)=>clauses(text).some(s=>
  /完全没有相关(?:个人)?(?:实践|经历)|没有任何相关(?:个人)?(?:实践|经历)|缺少\s*AI\s*产品领域推动想法落地的经历|缺少在\s*AI\s*产品场景中推动想法落地的(?:具体)?(?:成果|经历)/i.test(s)
  &&!/(?:正式|企业|商业|跨职能)/.test(s));
const deniesAiPractice=(text:string)=>clauses(text).some(s=>
  /缺少(?:在)?\s*AI\s*产品(?:领域|场景中)推动想法落地的(?:具体)?(?:成果|经历)/i.test(s)
  &&!/(?:正式|企业|商业|跨职能)/.test(s));
const addsEnterprise=(text:string)=>clauses(text).some(s=>
  /(?:JD|该?加分项|要求|核心职责).{0,10}(?:所列|要求|涉及|必须|只能).{0,12}(?:正式|企业)(?:实习|项目|经历)|必须(?:是|有|具备)?(?:正式)?企业项目/.test(s)
  &&!/(?:不要求|未要求|并非|不是|无需|不能要求|不得要求)/.test(s));
const hardGate=(text:string,topic:RegExp)=>clauses(text).some(s=>topic.test(s)
  &&/(?:构成硬门槛|基本资格不符合|不符合基本资格|因此不能投递|不能投递|无法投递|无投递资格)/.test(s)
  &&!/(?:不构成|不是|不意味着|不代表|并非|不会导致|不能认为|不得视为)/.test(s));
const sharedProse=(r:Report)=>[r.materialFit.summary,r.applicationAction.summary,r.applicationAction.conditionalNextAction??'',
  ...r.verificationItems.flatMap(v=>[v.question,v.reason,v.askWhomOrHow,...v.answerImpacts]),
  ...r.resumeSuggestions.flatMap(s=>[s.suggestedWording,s.factualBoundary])];

/** Additional rejection only. Does not rewrite candidates, invent links, weaken A2 or revalidate immutable history. */
export function generationSemanticFailures(report:Report,context:ReportContext):GenerationSemanticRule[]{
  const failures:GenerationSemanticRule[]=[],checks=generationEvidenceChecks(context),facts=new Map(context.profile.facts.map(f=>[f.factId,f]));
  const tasks=[...report.coreDuties,...report.preferredItems],allProse=sharedProse(report);
  for(const task of tasks){
    const item=context.jdItems.find(j=>j.jdId===task.jdId)!,check=checks.tasks.find(c=>c.jdId===task.jdId)
      ??{limitedPersonalFactIds:[] as string[],excludedTaskFactIds:[] as string[]};
    for(const link of task.evidenceLinks)for(const id of link.factIds){const fact=facts.get(id)!;
      if(nonTask(fact))failures.push('NON_TASK_FACT_AS_TASK_EVIDENCE');
      if(measurementTask(item.exactText)&&knowledgeOnly(fact))failures.push('WORKFLOW_AS_MEASUREMENT_EVIDENCE');
    }
    if(check.limitedPersonalFactIds.length&&!task.evidenceLinks.some(l=>l.evidenceType==='personal_practice'
      &&l.factIds.some(id=>check.limitedPersonalFactIds.includes(id))))failures.push('RELATED_PERSONAL_SUPPORT_OMITTED');
    if(check.limitedPersonalFactIds.length){
      // missingAspects are explicitly gaps, including fragments without a verb. No candidate field is rewritten.
      const prose=[task.explanation,...task.missingAspects.map(s=>'缺少'+s),...task.evidenceLinks.flatMap(l=>[l.connection,l.boundary]),
        ...allProse,...report.inferences.filter(i=>i.jdIds.includes(task.jdId)).flatMap(i=>[i.statement,i.uncertainty])];
      if(prose.some(deniesPractice))failures.push('UNBOUNDED_PRACTICE_DENIAL');
    }
    if((projectAlternative(item.exactText)||/快速验证|AI Coding|原型设计/.test(item.exactText))&&!explicitlyEnterprise(item.exactText)){
      const prose=[task.explanation,...task.missingAspects,...task.evidenceLinks.flatMap(l=>[l.connection,l.boundary]),
        ...report.verificationItems.filter(v=>v.jdIds.includes(task.jdId)).flatMap(v=>[v.question,v.reason,v.askWhomOrHow,...v.answerImpacts]),
        ...report.resumeSuggestions.filter(s=>s.jdIds.includes(task.jdId)).flatMap(s=>[s.suggestedWording,s.factualBoundary])];
      if(prose.some(addsEnterprise))failures.push('UNLISTED_ENTERPRISE_REQUIREMENT');
    }
  }
  // Explicit AI-wide denials can also appear under another task's gaps; do not
  // interpret a generic "no relevant experience" for an unrelated duty this way.
  if(checks.tasks.some(c=>c.limitedPersonalFactIds.length)&&tasks.some(t=>[t.explanation,...t.missingAspects.map(s=>'缺少'+s)]
    .some(deniesAiPractice)))failures.push('UNBOUNDED_PRACTICE_DENIAL');
  if(context.jdItems.some(j=>projectAlternative(j.exactText))&&!context.jdItems.some(j=>explicitlyEnterprise(j.exactText))
    &&allProse.some(addsEnterprise))failures.push('UNLISTED_ENTERPRISE_REQUIREMENT');
  const qualificationText=context.jdItems.filter(j=>j.kind==='qualification').map(j=>j.exactText).join('\n');
  const majorBonus=context.jdItems.some(j=>j.kind==='preferred'&&/专业/.test(j.exactText));
  const gateProse=[...allProse,...tasks.flatMap(t=>[t.explanation,...t.missingAspects]),
    ...report.inferences.flatMap(i=>[i.statement,i.uncertainty])];
  if(majorBonus&&!/专业/.test(qualificationText)&&gateProse.some(s=>hardGate(s,/专业/)))failures.push('PREFERRED_AS_QUALIFICATION');
  if(!/实习/.test(qualificationText)&&gateProse.some(s=>hardGate(s,/实习/)))failures.push('PREFERRED_AS_QUALIFICATION');
  for(const suggestion of report.resumeSuggestions){
    if(suggestion.factIds.some(id=>nonTask(facts.get(id)!))
      &&affirmative(suggestion.suggestedWording,/已完成|承担|负责|交付|提出需求|设计功能|协调团队/)){
      failures.push('NON_TASK_FACT_AS_TASK_EVIDENCE');
    }
  }
  const pending=report.qualifications.filter(q=>checks.priorityQualificationJdIds.includes(q.jdId)&&q.status==='needs_confirmation');
  if(pending.length&&report.applicationAction.category!=='explicit_hard_gate'){
    const first=report.verificationItems[report.applicationAction.verificationItemIndexes[0]];
    if(report.applicationAction.category!=='verify_first'||!first||!pending.some(q=>first.jdIds.includes(q.jdId)))failures.push('ELIGIBILITY_REVIEW_NOT_PRIORITIZED');
  }
  return failures;
}

export function checkGenerationSemantics(report:Report,context:ReportContext):void{
  const failures=generationSemanticFailures(report,context);
  if(failures.length)throw new ReportValidationError(failures,failures.map(()=>'OTHER'));
}
