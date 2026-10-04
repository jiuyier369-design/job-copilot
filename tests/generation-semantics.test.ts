import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticFixture} from './helpers/semantic-generation.ts';
import {validateReport,ReportValidationError} from '../src/lib/report/validate.ts';
import {validateGeneratedReport} from '../src/lib/report/validate-generated.ts';
import {generationEvidenceChecks,generationSemanticFailures,type GenerationSemanticRule} from '../src/lib/report/generation-semantics.ts';
import {emitA2Diagnostic} from '../src/lib/report/diagnostics.ts';
import {buildModelInput} from '../src/lib/report/model-input.ts';
import {DEEPSEEK_SYSTEM_PROMPT,DEEPSEEK_PROMPT_VERSION} from '../src/lib/analysis/deepseek-prompt.ts';
import {asyncFixture} from './helpers/async-analysis.ts';
import {enqueueAnalysis} from '../src/lib/analysis/async.ts';
import {consumeAnalysisOnce} from '../src/lib/analysis/worker.ts';
import type {Report} from '../src/types/job-copilot.ts';
import {createDeepSeekModel} from '../src/lib/analysis/deepseek.ts';
import {mockDeepSeekEnv,deepSeekEnvelope} from './helpers/deepseek-generation.ts';
import {readFileSync} from 'node:fs';

function rejected(r:Report,c:ReturnType<typeof semanticFixture>['context'],rule:GenerationSemanticRule){
  validateReport(r,c); // proves rejection is the new guard, not an accidental change to original A2.
  assert.ok(generationSemanticFailures(r,c).includes(rule));
  assert.throws(()=>validateGeneratedReport(r,c),ReportValidationError);
}
for(const direction of ['product','success','solutions'] as const){
  test(`${direction}: fictional limited support, qualification priority, gaps and all modules agree`,()=>{
    const x=semanticFixture(direction),before=JSON.stringify(x);assert.equal(validateGeneratedReport(x.report,x.context),x.report);
    assert.equal(JSON.stringify(x),before);assert.deepEqual(generationSemanticFailures(x.report,x.context),[]);
    const input=JSON.parse(buildModelInput(x.context).data);
    assert.deepEqual(input.serverEvidenceChecks,generationEvidenceChecks(x.context));
  });
  test(`${direction}: relevant partial iteration cannot be erased until a full PRD exists`,()=>{
    const x=semanticFixture(direction),t=x.report.coreDuties[0];t.evidenceType='no_evidence';t.evidenceLinks=[];
    t.explanation='没有完整 PRD 或正式实习，因此整个要求暂无证据。';
    rejected(x.report,x.context,'RELATED_PERSONAL_SUPPORT_OMITTED');
  });
  for(const section of ['task','gap','overview','action','verification','resume','inference'] as const){
    test(`${direction}: bounded blanket denial is rejected in ${section}`,()=>{
      const x=semanticFixture(direction),wrong='缺少AI产品领域推动想法落地的经历';
      if(section==='task')x.report.coreDuties[0].explanation=wrong;
      if(section==='gap')x.report.coreDuties[0].missingAspects=['在 AI 产品场景中推动想法落地的具体成果'];
      if(section==='overview')x.report.materialFit.summary=wrong;
      if(section==='action')x.report.applicationAction.summary=wrong;
      if(section==='verification')x.report.verificationItems[0].reason=wrong;
      if(section==='resume')x.report.resumeSuggestions[0].factualBoundary=wrong;
      if(section==='inference')x.report.inferences=[{jdIds:['S-D-design'],statement:wrong,uncertainty:'暂不确定。'}];
      rejected(x.report,x.context,'UNBOUNDED_PRACTICE_DENIAL');
    });
  }
}
test('workflow cannot substitute for metric tracking even in a mixed evidence link',()=>{
  const x=semanticFixture(),t=x.report.coreDuties[1];t.evidenceType='personal_practice';t.evidenceLinks=[{
    evidenceType:'personal_practice',factIds:['S-F-workflow','S-F-project'],connection:'知识整理可证明产品指标追踪。',boundary:'个人场景。'}];
  rejected(x.report,x.context,'WORKFLOW_AS_MEASUREMENT_EVIDENCE');
});
test('work preference and constraint are not completed task evidence even alongside real team experience',()=>{
  for(const category of ['preference','constraint'] as const){const x=semanticFixture();x.context.profile.facts[3].category=category;
    x.report.coreDuties[2].evidenceLinks[0].factIds.push('S-F-preference');
    rejected(x.report,x.context,'NON_TASK_FACT_AS_TASK_EVIDENCE');}
});
test('AI-wide denial in another task gap is rejected while an unrelated missing task is allowed',()=>{
  const x=semanticFixture();x.report.coreDuties[2].missingAspects=['在 AI 产品场景中推动想法落地的具体成果'];
  rejected(x.report,x.context,'UNBOUNDED_PRACTICE_DENIAL');
  x.report.coreDuties[2].missingAspects=['尚无企业跨职能协作证据。'];validateGeneratedReport(x.report,x.context);
});
test('preference cannot support past resume tasks; an explicitly stated preference remains a preference',()=>{
  const x=semanticFixture();x.report.resumeSuggestions=[{jdIds:['S-D-team'],factIds:['S-F-preference'],
    suggestedWording:'已完成客户沟通并协调团队。',factualBoundary:'个人偏好。'}];
  rejected(x.report,x.context,'NON_TASK_FACT_AS_TASK_EVIDENCE');
  x.report.resumeSuggestions[0].suggestedWording='偏好客户接触的工作，不自称已完成客户交付。';validateGeneratedReport(x.report,x.context);
});
test('model-supplied hints cannot authorize preference evidence or erase server-owned exclusions',async()=>{
  const x=semanticFixture();x.report.coreDuties[2].evidenceLinks[0].factIds.push('S-F-preference');
  const input=buildModelInput(x.context),data=JSON.parse(input.data);data.serverEvidenceChecks={tasks:[],nonTaskFactIds:[],priorityQualificationJdIds:[]};
  const model=createDeepSeekModel(mockDeepSeekEnv,async()=>Response.json({...deepSeekEnvelope(x.report),model:'deepseek-flash'}));
  await assert.rejects(model.generate({...input,data:JSON.stringify(data)},'虚构岗位',new AbortController().signal),{category:'A2_INVALID'});
});
test('actual metric work remains usable; negated or planned metric work does not rescue knowledge-only evidence',()=>{
  for(const proof of ['完成产品核心指标定义，追踪产品指标并完成实验验证。','计划完成实验验证。','未完成实验验证。']){
    const x=semanticFixture(),t=x.report.coreDuties[1];x.context.profile.facts[2].statement+=proof;
    t.evidenceType='personal_practice';t.evidenceLinks=[{evidenceType:'personal_practice',factIds:['S-F-workflow'],connection:'依据事实中的任务动作。',boundary:'个人范围。'}];
    if(proof.startsWith('完成'))validateGeneratedReport(x.report,x.context);
    else rejected(x.report,x.context,'WORKFLOW_AS_MEASUREMENT_EVIDENCE');
  }
});
test('unrelated AI usage, planned iteration and non-AI tasks do not force personal evidence',()=>{
  for(const mode of ['usage','planned','non-AI'] as const){const x=semanticFixture();
    if(mode==='usage')x.context.profile.facts[1].statement='使用 AI 查询资料。';
    if(mode==='planned')x.context.profile.facts[1].statement='计划在 AI 助手中提出需求、设计功能并迭代。';
    if(mode==='non-AI'){x.context.jdItems=x.context.jdItems.filter(j=>j.kind==='qualification'||j.jdId==='S-D-team');
      x.context.jdText=x.context.jdItems.map(j=>j.exactText).join('\n');x.report.coreDuties=[x.report.coreDuties[2]];x.report.preferredItems=[];
      x.report.materialFit.supportingJdIds=['S-D-team'];x.report.materialFit.limitingJdIds=[];x.report.resumeSuggestions=[];}
    const checks=generationEvidenceChecks(x.context);assert.ok(checks.tasks.every(t=>t.limitedPersonalFactIds.length===0));
    if(mode!=='non-AI')for(const t of [x.report.coreDuties[0],...x.report.preferredItems.slice(0,2)]){t.evidenceType='no_evidence';t.evidenceLinks=[];}
    validateGeneratedReport(x.report,x.context);
  }
});
for(const section of ['task','gap','overview','action','verification','resume'] as const){
  test(`intern-or-project cannot acquire an invented enterprise-only gate in ${section}`,()=>{
    const x=semanticFixture(),wrong='缺少该加分项所列的正式实习或企业项目经历';
    if(section==='task')x.report.preferredItems[0].explanation=wrong;
    if(section==='gap')x.report.preferredItems[0].missingAspects=[wrong];
    if(section==='overview')x.report.materialFit.summary=wrong;
    if(section==='action')x.report.applicationAction.summary=wrong;
    if(section==='verification')x.report.verificationItems.push({...x.report.verificationItems[0],jdIds:['S-P-project'],reason:wrong});
    if(section==='resume')x.report.resumeSuggestions.push({...x.report.resumeSuggestions[0],jdIds:['S-P-project'],factualBoundary:wrong});
    rejected(x.report,x.context,'UNLISTED_ENTERPRISE_REQUIREMENT');
  });
  test(`major and internship competitiveness cannot become qualification gates in ${section}`,()=>{
    for(const topic of ['专业加分不足','AI 产品实习不足']){const x=semanticFixture(),wrong=topic+'因此不能投递';
      if(section==='task')x.report.preferredItems[2].explanation=wrong;
      if(section==='gap')x.report.preferredItems[2].missingAspects=[wrong];
      if(section==='overview')x.report.materialFit.summary=wrong;
      if(section==='action')x.report.applicationAction.summary=wrong;
      if(section==='verification')x.report.verificationItems[0].reason=wrong;
      if(section==='resume')x.report.resumeSuggestions[0].factualBoundary=wrong;
      rejected(x.report,x.context,'PREFERRED_AS_QUALIFICATION');}
  });
}
test('missing enterprise scope and explicit JD enterprise requirement are both preserved',()=>{
  const x=semanticFixture();x.report.materialFit.summary='已有个人支持，缺少正式企业经历，专业加分不足不意味着不能投递。';
  x.report.preferredItems[0].explanation='JD未要求企业项目，仅个人实践也可提供有限支持。';validateGeneratedReport(x.report,x.context);
  x.context.jdItems.find(j=>j.jdId==='S-P-project')!.exactText='AI 产品实习或项目经历，项目必须是正式企业项目。';
  x.context.jdText=x.context.jdItems.map(j=>j.exactText).join('\n');x.report.preferredItems[0].explanation='项目必须是正式企业项目，个人项目不证明企业经历。';
  validateGeneratedReport(x.report,x.context);
});
test('real hard qualifications remain hard; unknown post-graduation work gets first action verification',()=>{
  const x=semanticFixture();x.report.applicationAction.verificationItemIndexes=[];x.report.applicationAction.category='try_with_weak_evidence';
  rejected(x.report,x.context,'ELIGIBILITY_REVIEW_NOT_PRIORITIZED');
  x.report.verificationItems.push({...x.report.verificationItems[0],jdIds:['S-P-project'],question:'是否有相关实习？'});
  x.report.applicationAction.category='verify_first';x.report.applicationAction.verificationItemIndexes=[1,0];
  rejected(x.report,x.context,'ELIGIBILITY_REVIEW_NOT_PRIORITIZED');
  x.context.jdItems.push({jdId:'S-Q-major',kind:'qualification',exactText:'必须计算机专业。'});
  x.context.jdText=x.context.jdItems.map(j=>j.exactText).join('\n');x.context.profile.facts.push({factId:'S-F-major',category:'education',context:'education',statement:'虚构材料中的专业为历史学。'});
  x.report.qualifications.push({jdId:'S-Q-major',status:'does_not_meet',factIds:['S-F-major'],explanation:'明确不符合指定专业要求。'});
  x.report.applicationAction.category='explicit_hard_gate';x.report.applicationAction.summary='专业不符合基本资格。其他资格仍未知。';
  validateGeneratedReport(x.report,x.context);
});
test('original A2 and immutable history stay readable, labels are not silently repaired',()=>{
  const x=semanticFixture();x.report.coreDuties[2].evidenceLinks[0].factIds.push('S-F-preference');const before=JSON.stringify(x);
  assert.equal(validateReport(x.report,x.context),x.report);assert.throws(()=>validateGeneratedReport(x.report,x.context));
  assert.equal(JSON.stringify(x),before);
});
test('safe logs contain only fixed counts, never fact IDs or prose',()=>{
  const x=semanticFixture();x.report.coreDuties[2].evidenceLinks[0].factIds.push('S-F-preference');const events:unknown[]=[];
  try{validateGeneratedReport(x.report,x.context);assert.fail();}catch(e){emitA2Diagnostic(e,v=>events.push(v));}
  const text=JSON.stringify(events);assert.ok(text.includes('"OTHER":1'));
  for(const secret of [...x.context.profile.facts.flatMap(f=>[f.factId,f.statement]),...x.context.jdItems.flatMap(j=>[j.jdId,j.exactText])])assert.ok(!text.includes(secret));
});
test('DeepSeek mock runs the semantic guard; failure emits safe counts and never returns a report',async()=>{
  const x=semanticFixture();x.report.coreDuties[2].evidenceLinks[0].factIds.push('S-F-preference');let calls=0;const events:unknown[]=[];
  const model=createDeepSeekModel(mockDeepSeekEnv,async()=>{calls++;return Response.json({...deepSeekEnvelope(x.report),model:'deepseek-flash'});},undefined,false,e=>events.push(e));
  await assert.rejects(model.generate(buildModelInput(x.context),'虚构岗位',new AbortController().signal));
  assert.equal(calls,1);assert.ok(JSON.stringify(events).includes('"OTHER":1'));assert.ok(!JSON.stringify(events).includes('S-F-preference'));
});

test('worker semantic rejection saves nothing and failed replay never calls the model again',async()=>{
  const x=asyncFixture(),oldContext=x.worker.queue.context;let calls=0;
  const profile={...x.profile,facts:[{factId:'P1',category:'preference' as const,context:'self_report' as const,statement:'偏好客户沟通。'}]};
  x.admission.loadProfile=async()=>({version:1,updatedAt:'2026-10-03T00:00:00Z',profile});
  x.worker.queue.context=async(...a)=>({...await oldContext(...a),profile:{version:1,updatedAt:'2026-10-03T00:00:00Z',profile}});
  x.worker.model=async()=>{calls++;const r=structuredClone(x.report);r.coreDuties[0].evidenceType='transferable';
    r.coreDuties[0].evidenceLinks=[{evidenceType:'transferable',factIds:['P1'],connection:'偏好意味着已经完成客户沟通。',boundary:'个人偏好。'}];return r;};
  await enqueueAnalysis('A',x.request,x.admission);assert.equal(await consumeAnalysisOnce(x.worker),'failed');assert.equal(x.writes(),0);
  assert.equal((await enqueueAnalysis('A',x.request,x.admission)).failureCode,'REPORT_INVALID');assert.equal(await consumeAnalysisOnce(x.worker),'idle');assert.equal(calls,1);
});
test('Prompt v1.4 retains evidence boundaries and explains finite server hints, not new facts',()=>{
  assert.equal(DEEPSEEK_PROMPT_VERSION,'job-copilot-deepseek-v1.4');
  for(const prefix of ['任务关联规则：','有限任务支持：','项目路径边界：','资格核验顺序：'])assert.ok(DEEPSEEK_SYSTEM_PROMPT.includes(prefix));
  assert.ok(DEEPSEEK_SYSTEM_PROMPT.includes('个人项目只能 personal_practice'));assert.ok(DEEPSEEK_SYSTEM_PROMPT.includes('不能证明产品核心指标'));
});
