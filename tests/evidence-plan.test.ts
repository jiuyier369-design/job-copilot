import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidencePlanDemoSource as source,evidencePlanDemoReviewed as reviewed,evidencePlanMockOutput } from '../src/fixtures/evidence-plan-demo.ts';
import { checkReview,checkSource,editReview,initialReview,optionsFor,EvidencePlanError } from '../src/lib/evidence-plan/core.ts';
import { assemblePrototypeReport,buildPlanModelRequest,compileEvidencePlan,createPrototypeRunner,validateAnswers } from '../src/lib/evidence-plan/server.ts';
import { validateReport } from '../src/lib/report/validate.ts';
import type { EvidenceReviewInput,EvidencePlanModelOutput } from '../src/types/evidence-plan.ts';

const clone=<T>(value:T):T=>structuredClone(value);
const rejects=(code:string,fn:()=>unknown)=>assert.throws(fn,e=>e instanceof EvidencePlanError&&e.code===code);
const plan=()=>compileEvidencePlan(source,clone(reviewed));
const row=(value:EvidenceReviewInput,id:string)=>value.rows.find(r=>r.jdId===id)!;

test('fourteen fictional original requirements covered, original A2 accepts server-built tasks',()=>{
  assert.equal(source.jdItems.length,14);assert.equal(source.jdItems.filter(i=>i.kind==='qualification').length,3);
  const p=plan(),result=assemblePrototypeReport(source,p,evidencePlanMockOutput(p));
  assert.equal(result.qualifications.length+result.coreDuties.length+result.preferredItems.length,14);
  assert.equal(result.qualifications.find(q=>q.jdId==='D02')?.status,'meets');
  assert.equal(result.qualifications.find(q=>q.jdId==='D01')?.status,'needs_confirmation');
  assert.equal(result.qualifications.find(q=>q.jdId==='D03')?.status,'needs_confirmation');
  assert.equal(validateReport(result,{jdText:source.jdText,jdItems:source.jdItems,profile:source.profile}),result);
});
test('personal actions have only personal_practice; campus/studio remain separate contexts',()=>{
  assert.deepEqual(optionsFor(source,'D04').map(o=>o.evidenceType),['personal_practice']);
  const p=plan(),mixed=p.slots.find(s=>s.jdId==='D06')!;
  assert.equal(mixed.links.length,2);assert.deepEqual(new Set(mixed.links.map(l=>l.context)),new Set(['personal_project','competition']));
  const output=assemblePrototypeReport(source,p,evidencePlanMockOutput(p));
  const studio=output.coreDuties.find(d=>d.jdId==='D09')!;
  assert.equal(studio.evidenceType,'same_task');assert.match(studio.evidenceLinks[0].boundary,/entrepreneurship/);
});
test('client cannot upgrade personal project, use education as task, preference as completed action, or knowledge workflow as metrics',()=>{
  for(const [jdId,selection] of [
    ['D04',{actionKey:'design',evidenceType:'same_task'}],
    ['D04',{actionKey:'design',evidenceType:'transferable'}],
    ['D04',{actionKey:'degree',evidenceType:'same_task'}],
    ['D14',{actionKey:'preference',evidenceType:'transferable'}],
    ['D07',{actionKey:'knowledge',evidenceType:'personal_practice'}],
  ] as const){const input=clone(reviewed);Object.assign(row(input,jdId),{choice:'limited_support',selections:[selection],existingAction:'虚构测试动作'});rejects('EVIDENCE_NOT_ALLOWED',()=>compileEvidencePlan(source,input));}
});
test('no clue is an empty source slot, not evidence of absence or automatic eligibility',()=>{
  const p=plan();const no=p.slots.find(s=>s.jdId==='D07')!;assert.equal(no.overallEvidenceType,'no_evidence');assert.deepEqual(no.links,[]);
  assert.match(evidencePlanMockOutput(p).answers.find(a=>a.slotKey===no.slotKey)!.explanation,/不能断言/);
});
test('all rows and explicit plan acknowledgement required; user choice does not prove qualifications',()=>{
  rejects('REVIEW_REQUIRED',()=>checkReview(source,initialReview(source)));
  for(const mutate of [(x:EvidenceReviewInput)=>x.acknowledged=false,(x:EvidenceReviewInput)=>row(x,'D03').checked=false,(x:EvidenceReviewInput)=>row(x,'D03').choice='pending']){
    const x=clone(reviewed);mutate(x);rejects('REVIEW_REQUIRED',()=>checkReview(source,x));
  }
  assert.equal(plan().slots[0].qualificationStatus,'needs_confirmation');
});
test('browser cannot supply server-owned source, status or identity fields',()=>{
  for(const field of ['userId','profile','actions','qualificationStatus','report','provider']){
    const input=clone(reviewed);Object.assign(input,{[field]:'forged'});rejects('INPUT_INVALID',()=>compileEvidencePlan(source,input));
  }
});
test('no-clue notes cannot invent completed actions; duplicate source choice rejected',()=>{
  const x=clone(reviewed);row(x,'D07').existingAction='凭空声明已完成指标任务';rejects('EVIDENCE_NOT_ALLOWED',()=>compileEvidencePlan(source,x));
  const y=clone(reviewed);row(y,'D04').selections.push(clone(row(y,'D04').selections[0]));rejects('EVIDENCE_NOT_ALLOWED',()=>compileEvidencePlan(source,y));
});
test('invalid review stops before mock invocation; prototype never modifies source or historic report objects',async()=>{
  const before=JSON.stringify(source);let calls=0;const runner=createPrototypeRunner();
  await assert.rejects(()=>runner('fictional-preflight',source,initialReview(source),async p=>{calls++;return evidencePlanMockOutput(p);}));
  assert.equal(calls,0);const p=plan();assemblePrototypeReport(source,p,evidencePlanMockOutput(p));assert.equal(JSON.stringify(source),before);
});
test('valid keys alone cannot prove arbitrary prose, so semantic human review remains mandatory',()=>{
  const p=plan(),output=evidencePlanMockOutput(p);output.answers[3].explanation='虚构反例：已完成正式企业上线。';
  // Deliberately demonstrates the finite contract boundary, not a claim that this prose is true.
  assert.equal(validateAnswers(p,output).answers.length,14);
});
test('missing, duplicate and alien reviewed requirements rejected before model',()=>{
  for(const mutate of [(x:EvidenceReviewInput)=>x.rows.pop(),(x:EvidenceReviewInput)=>x.rows[1]=clone(x.rows[0]),(x:EvidenceReviewInput)=>x.rows[0].jdId='UNKNOWN']){
    const x=clone(reviewed);mutate(x);rejects('INPUT_INVALID',()=>compileEvidencePlan(source,x));
  }
});
test('source quotes and capability catalog must be traceable; unknown refs never become source evidence',()=>{
  const x=clone(source);x.actions[0].quote='不存在的事实';rejects('SOURCE_INVALID',()=>checkSource(x));
  const y=clone(source);y.jdItems[0].exactText='不是原文';rejects('SOURCE_INVALID',()=>checkSource(y));
  const input=clone(reviewed);row(input,'D04').selections[0].actionKey='UNKNOWN';rejects('EVIDENCE_NOT_ALLOWED',()=>compileEvidencePlan(source,input));
});
test('source or review edits invalidate confirmation and digest; changed sources cannot assemble old answers',()=>{
  const state={review:clone(reviewed),activeJdId:'D04',confirmed:true,error:null};
  const edited=editReview(state,{missingScope:'新的待核实范围'});
  assert.equal(edited.confirmed,false);assert.equal(edited.review.acknowledged,false);assert.equal(row(edited.review,'D04').checked,false);
  const old=plan(),changed=clone(source);changed.binding.profileVersion++;
  rejects('STALE_PLAN',()=>assemblePrototypeReport(changed,old,evidencePlanMockOutput(old)));
  const words=clone(source);words.profile.facts[7].statement+=' 补充来源。';
  rejects('STALE_PLAN',()=>assemblePrototypeReport(words,old,evidencePlanMockOutput(old)));
});
test('server slot reordering is canonical; valid output may reorder keyed answers',()=>{
  const input=clone(reviewed);input.rows.reverse();input.rows.forEach(r=>r.selections.reverse());assert.equal(compileEvidencePlan(source,input).planDigest,plan().planDigest);
  const p=plan(),output=evidencePlanMockOutput(p);output.answers.reverse();assert.equal(validateAnswers(p,output).answers.length,14);
});
test('model cannot output labels, fact IDs, qualifications, reports or overview; r25 label upgrade has no writable field',()=>{
  for(const field of ['evidenceType','factIds','jdId','status','report','materialFit']){
    const p=plan(),output=evidencePlanMockOutput(p);Object.assign(output.answers[3],{[field]:'forged'});rejects('ANSWER_INVALID',()=>validateAnswers(p,output));
  }
  const p=plan();assert.match(buildPlanModelRequest(p).instructions,/不得新增或改写/);
});
test('omitted, duplicate, extra and mispositioned answer/link keys fail; no positional zip',()=>{
  for(const mutate of [(x:EvidencePlanModelOutput)=>x.answers.pop(),(x:EvidencePlanModelOutput)=>x.answers[1]=clone(x.answers[0]),(x:EvidencePlanModelOutput)=>x.answers[0].slotKey='alien']){
    const p=plan(),output=evidencePlanMockOutput(p);mutate(output);rejects('ANSWER_COVERAGE',()=>validateAnswers(p,output));
  }
  for(const mutate of [(x:EvidencePlanModelOutput)=>x.answers[3].links[0].linkKey=x.answers[4].links[0].linkKey,(x:EvidencePlanModelOutput)=>x.answers[5].links.pop(),(x:EvidencePlanModelOutput)=>x.answers[6].links.push(clone(x.answers[3].links[0]))]){
    const p=plan(),output=evidencePlanMockOutput(p);mutate(output);rejects('ANSWER_MISALIGNED',()=>validateAnswers(p,output));
  }
});
test('tampered server manifest and stale model digest rejected; no silent relabeling',()=>{
  const p=plan(),out=evidencePlanMockOutput(p);out.planDigest='stale';rejects('STALE_PLAN',()=>validateAnswers(p,out));
  const forged=plan();forged.slots[3].links[0].evidenceType='same_task';rejects('STALE_PLAN',()=>assemblePrototypeReport(source,forged,evidencePlanMockOutput(forged)));
});
test('old A2 still independently rejects upgrade in assembled report',()=>{
  const p=plan(),report=assemblePrototypeReport(source,p,evidencePlanMockOutput(p));
  report.coreDuties[0].evidenceType='same_task';report.coreDuties[0].evidenceLinks[0].evidenceType='same_task';
  assert.throws(()=>validateReport(report,{jdText:source.jdText,jdItems:source.jdItems,profile:source.profile}));
});
test('failed output has no report; completed and failed replays/concurrent requests make one mock call',async()=>{
  for(const invalid of [false,true]){
    let calls=0;const run=createPrototypeRunner();
    const model=async(p:ReturnType<typeof plan>)=>{calls++;const out=evidencePlanMockOutput(p);if(invalid)out.answers.pop();return out;};
    const [a,b]=await Promise.all([run('fictional-request',source,reviewed,model),run('fictional-request',source,reviewed,model)]);
    assert.equal(a,b);assert.equal(calls,1);assert.equal(a?.status,invalid?'failed':'completed');assert.equal(a?.report===null,invalid);
    await run('fictional-request',source,reviewed,model);assert.equal(calls,1);
    const changed=clone(reviewed);row(changed,'D03').missingScope='新核对备注';await assert.rejects(()=>run('fictional-request',source,changed,model));assert.equal(calls,1);
    await run('new-fictional-request',source,reviewed,model);assert.equal(calls,2);
  }
});
test('safe failure projects only fixed categories, never sensitive error material; existing API stays separate',async()=>{
  const secret='sensitive-fixture-MATERIAL';let calls=0;const run=createPrototypeRunner();
  const result=await run('sensitive-request',source,reviewed,async()=>{calls++;throw new Error(secret);});
  assert.equal(result?.code,'VALIDATION_FAILED');assert.equal(JSON.stringify({status:result?.status,code:result?.code}).includes(secret),false);assert.equal(calls,1);
  const host=readFileSync('src/components/evidence-plan/evidence-plan-demo-host.tsx','utf8');
  assert.doesNotMatch(host,/fetch\(|localStorage|supabase|server\.ts|api\/analyses/);
  const server=readFileSync('src/lib/evidence-plan/server.ts','utf8');assert.doesNotMatch(server,/console\.|deepseek|repository|fetch\(/);
});
