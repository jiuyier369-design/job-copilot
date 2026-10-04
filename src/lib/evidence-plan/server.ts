import { createHash } from 'node:crypto';
import type { AnswerSlot, CompiledEvidencePlan, EvidencePlanModelOutput, EvidencePlanSource, SlotAnswer } from '../../types/evidence-plan.ts';
import type { Report, TaskAssessment } from '../../types/job-copilot.ts';
import { array, object, strings, text } from '../report/schema.ts';
import { validateReport } from '../report/validate.ts';
import { checkReview, checkSource, EvidencePlanError } from './core.ts';

// Callers must load source/decisions from controlled server storage. No public route exists in this prototype.
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function compileEvidencePlan(source: EvidencePlanSource, input: unknown): CompiledEvidencePlan {
  const review = checkReview(source,input);
  // Canonical source order; model/client array order does not define identity.
  review.rows.sort((a,b)=>source.jdItems.findIndex(i=>i.jdId===a.jdId)-source.jdItems.findIndex(i=>i.jdId===b.jdId));
  for (const row of review.rows) row.selections.sort((a,b)=>a.actionKey.localeCompare(b.actionKey));
  const slots: AnswerSlot[] = source.jdItems.map(item=>{
    const row = review.rows.find(r=>r.jdId===item.jdId)!;
    const links = row.selections.map(selection=>{
      const action = source.actions.find(a=>a.key===selection.actionKey)!;
      const fact = source.profile.facts.find(f=>f.factId===action.factId)!;
      return { linkKey:`${item.jdId}/${action.key}`,factId:fact.factId,actionQuote:action.quote,context:fact.context,evidenceType:selection.evidenceType };
    });
    return { slotKey:`requirement/${item.jdId}`,jdId:item.jdId,kind:item.kind,exactText:item.exactText,
      choice:row.choice as AnswerSlot['choice'],links,
      qualificationStatus:item.kind==='qualification' ? (row.choice==='limited_support' ? source.scopes.find(s=>s.jdId===item.jdId)?.qualificationStatus ?? 'needs_confirmation' : 'needs_confirmation') : null,
      overallEvidenceType:item.kind==='qualification' ? null : links.length ? links[0].evidenceType as TaskAssessment['evidenceType'] : 'no_evidence',
      existingAction:row.existingAction,missingScope:row.missingScope };
  });
  return { contractVersion:review.contractVersion,sourceDigest:digest(source),planDigest:digest({source,review,slots}),input:review,slots };
}
const outputSchema = object({ planDigest:text,answers:array(object({slotKey:text,explanation:text,
  links:array(object({linkKey:text,connection:text,boundary:text})),missingAspects:strings})) });
export function validateAnswers(plan: CompiledEvidencePlan, value: unknown): EvidencePlanModelOutput {
  const errors: string[]=[]; outputSchema(value,'answers',errors);
  if(errors.length) throw new EvidencePlanError('ANSWER_INVALID');
  const output=value as EvidencePlanModelOutput;
  if(output.planDigest!==plan.planDigest) throw new EvidencePlanError('STALE_PLAN');
  if(output.answers.length!==plan.slots.length || new Set(output.answers.map(a=>a.slotKey)).size!==output.answers.length ||
      plan.slots.some(s=>!output.answers.some(a=>a.slotKey===s.slotKey))) throw new EvidencePlanError('ANSWER_COVERAGE');
  for(const slot of plan.slots){
    const answer=output.answers.find(a=>a.slotKey===slot.slotKey)!;
    if(answer.explanation.length>2000 || answer.missingAspects.length>8 || answer.missingAspects.some(s=>s.length>800) ||
        answer.links.some(l=>l.connection.length>800 || l.boundary.length>800)) throw new EvidencePlanError('ANSWER_INVALID');
    if(answer.links.length!==slot.links.length || new Set(answer.links.map(l=>l.linkKey)).size!==answer.links.length ||
        slot.links.some(l=>!answer.links.some(a=>a.linkKey===l.linkKey))) throw new EvidencePlanError('ANSWER_MISALIGNED');
  }
  return structuredClone(output);
}
export function buildPlanModelRequest(plan:CompiledEvidencePlan){
  return {contractVersion:plan.contractVersion,planDigest:plan.planDigest,
    instructions:'只输出planDigest与answers。每个slotKey恰好一次；每个linkKey恰好一次。编号、场景、事实、证据标签和资格状态由服务器固定，不得新增或改写。仅填写explanation、connection、boundary、missingAspects；用户笔记不是新画像事实。有限支持不等于企业经历，暂无线索不等于不存在经历。不得补造职责、数字或能力。',
    slots:structuredClone(plan.slots)};
}
/** Test bridge only: non-task sections are explicitly withheld, not model-generated production judgments. */
export function assemblePrototypeReport(source: EvidencePlanSource, plan: CompiledEvidencePlan, candidate: unknown): Report {
  checkSource(source);
  const current = compileEvidencePlan(source,plan.input);
  if(digest(current)!==digest(plan) || digest(source)!==plan.sourceDigest) throw new EvidencePlanError('STALE_PLAN');
  const output=validateAnswers(plan,candidate);
  const get=(slot:AnswerSlot):SlotAnswer=>output.answers.find(a=>a.slotKey===slot.slotKey)!;
  const tasks=(kind:'core_duty'|'preferred'):TaskAssessment[]=>plan.slots.filter(s=>s.kind===kind).map(s=>{
    const answer=get(s);
    return {jdId:s.jdId,evidenceType:s.overallEvidenceType!,evidenceLinks:s.links.map(l=>{
      const words=answer.links.find(a=>a.linkKey===l.linkKey)!;
      return {factIds:[l.factId],evidenceType:l.evidenceType as Exclude<TaskAssessment['evidenceType'],'no_evidence'>,
        connection:`已核对来源动作：${l.actionQuote}。${words.connection}`,
        boundary:`发生场景：${l.context}。用户核对的缺口：${s.missingScope}。${words.boundary}`};
    }),explanation:answer.explanation,missingAspects:[s.missingScope,...answer.missingAspects],needsUserConfirmation:true};
  });
  const report:Report={
    materialFit:{level:'partial',summary:'仅逐条答案原型；未形成完整材料适配结论。',supportingJdIds:[],limitingJdIds:source.jdItems.map(i=>i.jdId)},
    applicationAction:{category:'try_with_weak_evidence',summary:'演示占位，不提供真实投递建议。',verificationItemIndexes:[]},
    qualifications:plan.slots.filter(s=>s.kind==='qualification').map(s=>({jdId:s.jdId,status:s.qualificationStatus!,factIds:s.links.map(l=>l.factId),explanation:get(s).explanation})),
    coreDuties:tasks('core_duty'),preferredItems:tasks('preferred'),inferences:[],resumeSuggestions:[],verificationItems:[],
  };
  return validateReport(report,{jdText:source.jdText,jdItems:source.jdItems,profile:source.profile});
}
/** No persistence exists. Mock terminal ledger proves failed/replayed requests never invoke a model again. */
export function createPrototypeRunner(){
  const runs=new Map<string,{fingerprint:string;status:'completed'|'failed';report:Report|null;code:string|null}>();
  const pending=new Map<string,{fingerprint:string;promise:Promise<ReturnType<typeof runs.get>>}>();
  return async(requestId:string,source:EvidencePlanSource,input:unknown,model:(plan:CompiledEvidencePlan)=>Promise<unknown>)=>{
    const plan=compileEvidencePlan(source,input),fingerprint=plan.planDigest;
    const existing=runs.get(requestId);if(existing){if(existing.fingerprint!==fingerprint)throw new EvidencePlanError('STALE_PLAN');return existing;}
    const running=pending.get(requestId);if(running){if(running.fingerprint!==fingerprint)throw new EvidencePlanError('STALE_PLAN');return running.promise;}
    const promise=Promise.resolve().then(async()=>{
      try {const report=assemblePrototypeReport(source,plan,await model(plan));const result={fingerprint,status:'completed' as const,report,code:null};runs.set(requestId,result);return result;}
      catch(error){const result={fingerprint,status:'failed' as const,report:null,code:error instanceof EvidencePlanError?error.code:'VALIDATION_FAILED'};runs.set(requestId,result);return result;}
      finally{pending.delete(requestId);}
    });
    pending.set(requestId,{fingerprint,promise});return promise;
  };
}
