import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {Report,ProfileData} from '../src/types/job-copilot.ts';
import {validateThenSave,validateReport} from '../src/lib/report/validate.ts';
import {ReportValidationError,a2Diagnostic,emitA2Diagnostic,EVIDENCE_RULE_CATEGORIES,COVERAGE_RULE_CATEGORIES,REFERENCE_RULE_CATEGORIES,type ReportEvidenceRule,type A2DiagnosticEvent} from '../src/lib/report/diagnostics.ts';
import {deepSeekTestInput,deepSeekEnvelope,mockDeepSeekEnv} from './helpers/deepseek-generation.ts';
import {asyncFixture} from './helpers/async-analysis.ts';
import {createWorkerModel} from '../src/lib/analysis/worker-model.ts';
import {enqueueAnalysis} from '../src/lib/analysis/async.ts';
import {consumeAnalysisOnce} from '../src/lib/analysis/worker.ts';
const privateText='PRIVATE_JD_PROFILE_RESPONSE_CREDENTIAL';
const withEvidence=(report:Report)=>{report.coreDuties[0].evidenceType='personal_practice';report.coreDuties[0].evidenceLinks=[{
  evidenceType:'personal_practice',factIds:['P1'],connection:privateText,boundary:'虚构个人实践边界'}];return report;};
const changes:Record<ReportEvidenceRule,(report:Report,profile:ProfileData)=>void>={
  LABEL_LINK_CONFLICT:r=>{r.coreDuties[0].evidenceType='no_evidence';},
  OVERALL_LABEL_NO_MATCH:r=>{r.coreDuties[0].evidenceType='transferable';},
  EDUCATION_AS_TASK_EVIDENCE:(_r,p)=>{p.facts[0].category='education';p.facts[0].context='education';},
  PERSONAL_PRACTICE_UPGRADED:r=>{r.coreDuties[0].evidenceType='same_task';r.coreDuties[0].evidenceLinks[0].evidenceType='same_task';},
};
const emptyDetails=()=>({diagnosticVersion:2,coverageCounts:Object.fromEntries(COVERAGE_RULE_CATEGORIES.map(k=>[k,0])),referenceCounts:Object.fromEntries(REFERENCE_RULE_CATEGORIES.map(k=>[k,0]))});
const expected=(rule:ReportEvidenceRule)=>({...emptyDetails(),event:'analysis-a2-invalid',counts:{JD_COVERAGE:0,REFERENCE:0,EVIDENCE_TYPE:1,VERIFICATION:0,RESUME_WORDING:0,OTHER:0},
  evidenceCounts:Object.fromEntries(EVIDENCE_RULE_CATEGORIES.map(k=>[k,k===rule?1:0]))});
for(const rule of EVIDENCE_RULE_CATEGORIES){
  test(`${rule}: rule-site annotation counts one rejection, never persists or logs source/IDs`,async()=>{
    const x=deepSeekTestInput(),profile=structuredClone(x.profile),report=withEvidence(structuredClone(x.report)),events:A2DiagnosticEvent[]=[];
    changes[rule](report,profile);let writes=0;
    await assert.rejects(validateThenSave(report,{jdText:x.draft.rawText,jdItems:x.jdItems,profile},async()=>{writes++;}),error=>{
      assert.ok(error instanceof ReportValidationError);emitA2Diagnostic(error,e=>events.push(e));return true;
    });
    assert.deepEqual(events,[expected(rule)]);assert.equal(writes,0);
    const log=JSON.stringify(events);for(const secret of [privateText,x.draft.rawText,'P1',...x.jdItems.map(j=>j.jdId),profile.facts[0].statement])assert.ok(!log.includes(secret));
  });
  test(`${rule}: provider and async replay retain failed/REPORT_INVALID, one call and zero report writes`,async()=>{
    const x=asyncFixture(),report=withEvidence(structuredClone(x.report));changes[rule](report,x.profile);
    const events:A2DiagnosticEvent[]=[];let calls=0;
    const model=createWorkerModel({...mockDeepSeekEnv,ANALYSIS_WORKER_MODEL_TIMEOUT_MS:'45000',ANALYSIS_USD_TO_CNY:'8',ANALYSIS_MAX_CALL_CNY:'1'},
      async()=>{calls++;return Response.json({...deepSeekEnvelope(report),model:'deepseek-flash'});},e=>events.push(e));
    x.admission.metadata=model.metadata;
    const context=x.worker.queue.context,worker={...model,queue:{...x.worker.queue,context:async(...args:Parameters<typeof context>)=>({...await context(...args),metadata:model.metadata})}};
    await enqueueAnalysis('A',x.request,x.admission);assert.equal(await consumeAnalysisOnce(worker),'failed');assert.equal(x.writes(),0);
    assert.deepEqual(events,[expected(rule)]);const replay=await enqueueAnalysis('A',x.request,x.admission);assert.equal(replay.failureCode,'REPORT_INVALID');
    x.jobs[0].archived=false;assert.equal(await consumeAnalysisOnce(worker),'failed');assert.equal(calls,1);assert.equal(x.writes(),0);assert.equal(events.length,1);
  });
}
test('overlapping rule failures count separately and copied events/raw issues cannot mutate future safe summaries',()=>{
  const x=deepSeekTestInput(),report=withEvidence(structuredClone(x.report));report.coreDuties[0].evidenceLinks=[];
  assert.throws(()=>validateReport(report,{jdText:x.draft.rawText,jdItems:x.jdItems,profile:x.profile}),error=>{
    assert.ok(error instanceof ReportValidationError);const first=a2Diagnostic(error);assert.equal(first.counts.EVIDENCE_TYPE,2);
    assert.deepEqual(first.evidenceCounts,{LABEL_LINK_CONFLICT:1,OVERALL_LABEL_NO_MATCH:1,EDUCATION_AS_TASK_EVIDENCE:0,PERSONAL_PRACTICE_UPGRADED:0});
    error.issues.length=0;first.evidenceCounts.LABEL_LINK_CONFLICT=999;assert.equal(a2Diagnostic(error).evidenceCounts.LABEL_LINK_CONFLICT,1);return true;
  });
});
test('unknown text and hostile accessors are never used to infer evidence subtypes',()=>{
  let accessed=0;const raw='education qualification personal practice evidence label/links conflict '+privateText;
  const hostile={get message(){accessed++;throw Error(raw);},get evidenceCounts(){accessed++;throw Error(raw);},toJSON(){accessed++;throw Error(raw);}};
  for(const error of [hostile,Error(raw),new ReportValidationError([raw])]){
    const event=a2Diagnostic(error);assert.equal(event.counts.OTHER,1);assert.ok(Object.values(event.evidenceCounts).every(n=>n===0));assert.ok(!JSON.stringify(event).includes(raw));
  }
  emitA2Diagnostic(hostile,()=>{throw Error(raw);});assert.equal(accessed,0);
});
test('Prompt v1.2 spells out per-fact personal links, separate mixed links and a matching overall label',()=>{
  const source=readFileSync('src/lib/analysis/deepseek-prompt.ts','utf8');
  assert.ok(source.includes('学历与毕业时间不是任务经历')&&source.includes('个人项目只能 personal_practice'));
  assert.ok(source.includes('no_evidence + 空 evidenceLinks'));
  for(const rule of ['context=personal_project','按事实类型分开链接','不能放进 same_task 或 transferable','至少一条链接','整体标签不能升级个人项目链接'])
    assert.ok(source.includes(rule));
});
