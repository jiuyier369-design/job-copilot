import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analysisRunDemoScenarios } from '../src/fixtures/analysis-run-demo.ts';
import { analysisRunDemoTransition,analysisRunDemoView,canShowAnalysisReport,editAnalysisRunDemoField } from '../src/lib/analysis-run/demo-state.ts';

test('W9 frozen scenarios cover required states and expose no identity/source payloads',()=>{
  const keys=analysisRunDemoScenarios.map(s=>s.key);assert.equal(new Set(keys).size,keys.length);
  for(const key of ['jd-unconfirmed','profile-missing','ready','submitting','processing','completed','model-rejected','report-invalid',
    'jd-conflict','profile-conflict','model-uncertain','save-uncertain','login-expired','service-unavailable','version-unavailable','empty-required','empty-messages','querying'])assert.ok(keys.includes(key));
  const inspect=(value:unknown)=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)){
      assert.ok(!['requestId','userId','draftId','profile','jdText','report','requestFingerprint','provider','model','promptVersion'].includes(key));inspect(child);
    }
  };
  for(const s of analysisRunDemoScenarios){
    inspect(s.view);assert.equal(s.view.mode,'demo');assert.equal(canShowAnalysisReport(s.view),false);
    if(['blocked','submitting','processing','completed','failed','uncertain','requestError'].includes(s.view.state.kind))assert.equal(s.view.canGenerate,false);
    if(s.view.state.kind==='uncertain'){assert.equal(s.view.canCreateNewRequest,false);assert.equal(s.view.canQueryStatus,true);assert.match(s.view.state.message,/可能已经发生模型调用/);}
  }
});

test('Host alone controls field validation and actions; duplicate submit and unknown result never regenerate',()=>{
  const empty=analysisRunDemoView('empty-required');assert.equal(empty.canGenerate,false);
  let ready=editAnalysisRunDemoField(empty,'company','虚构公司');ready=editAnalysisRunDemoField(ready,'jobTitle','虚构岗位');assert.equal(ready.canGenerate,true);
  const bad=editAnalysisRunDemoField(ready,'jdSourceUrl','javascript:alert(1)');assert.equal(bad.canGenerate,false);
  const pending=analysisRunDemoTransition(ready,'generate');assert.equal(pending.state.kind,'submitting');assert.deepEqual(pending.fields,ready.fields);
  assert.equal(analysisRunDemoTransition(pending,'generate'),pending);assert.equal(editAnalysisRunDemoField(pending,'company','覆盖'),pending);
  const processing=analysisRunDemoTransition(pending,'submitted');assert.equal(processing.state.kind,'processing');assert.equal(processing.canGenerate,false);
  const completed=analysisRunDemoTransition(processing,'query');assert.equal(completed.state.kind,'completed');assert.equal(canShowAnalysisReport(completed),false);
  const fresh=analysisRunDemoTransition(completed,'new-request');assert.equal(fresh.state.kind,'ready');assert.deepEqual(fresh.fields,ready.fields);
  for(const key of ['model-uncertain','save-uncertain']){
    const uncertain=analysisRunDemoView(key);assert.equal(analysisRunDemoTransition(uncertain,'new-request'),uncertain);
    assert.equal(analysisRunDemoTransition(uncertain,'generate'),uncertain);
    assert.equal(analysisRunDemoTransition(uncertain,'query').state.kind,'uncertain');
  }
  const failure=analysisRunDemoView('model-rejected');assert.equal(analysisRunDemoTransition(failure,'new-request').state.kind,'ready');
  assert.equal(analysisRunDemoTransition(analysisRunDemoView('querying'),'query').isQuerying,true);
});

test('completed display requires live mode and Host-authorized saved reference; fixtures stay immutable',()=>{
  const demo=analysisRunDemoView('completed');assert.equal(canShowAnalysisReport({...demo,canViewReport:true}),false);
  assert.equal(canShowAnalysisReport({...demo,mode:'live',canViewReport:true}),false);
  const saved={...demo,mode:'live' as const,canViewReport:true,state:{kind:'completed' as const,analysisId:'synthetic-saved-reference',reportSource:'saved' as const,title:'合成测试',message:'合成测试'}};
  assert.equal(canShowAnalysisReport(saved),true);assert.equal(canShowAnalysisReport({...saved,state:{...saved.state,analysisId:''}}),false);
  assert.equal(canShowAnalysisReport({...saved,canViewReport:false}),false);
  const a=analysisRunDemoView('ready');a.fields.company='本地修改';assert.equal(analysisRunDemoView('ready').fields.company,'虚构样例公司');
});

test('UI preview and sandbox have no backend/fixture API, storage, polling or URL mutation',()=>{
  for(const path of ['src/app/(app)/analysis-run-demo/page.tsx','src/components/analysis-run/analysis-run-demo-host.tsx','src/lib/analysis-run/demo-state.ts','src/fixtures/analysis-run-demo.ts']){
    const text=readFileSync(path,'utf8');
    assert.ok(!/\bfetch\s*\(|supabase|\/api\/analyses|\/api\/analysis-runs|ENABLE_ANALYSIS_FIXTURE|randomUUID|localStorage|setInterval|history\.|location\./i.test(text),path);
  }
  const host=readFileSync('src/components/analysis-run/analysis-run-demo-host.tsx','utf8');
  assert.match(host,/useEffect\(\(\)=>\(\)=>/);assert.match(host,/clearTimeout/);
  assert.match(host,/const before=current.current,next=analysisRunDemoTransition/);
  assert.match(host,/analysisRunDemoNotice/);
  // Existing proxy matcher excludes the new public UI demo; it cannot trigger Auth refresh.
  const proxy=readFileSync('src/proxy.ts','utf8');assert.ok(!proxy.includes('/analysis-run-demo'));
});
