import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobAnalysisRecord } from '../src/types/job-copilot.ts';
import { confirmedAnalysisFixture } from './helpers/confirmed-analysis.ts';
import { validAnalysisRecord,analysisFromRow,reportColumns } from '../src/lib/report/resource.ts';
import { reportReadHandler } from '../src/lib/report/read.ts';
import { ApiError } from '../src/lib/api/http.ts';
import { createAnalysisReadClient,validRunResource,readFailure } from '../src/lib/analysis-run/read-client.ts';
import { initialLiveView,settleLiveRun } from '../src/lib/analysis-run/live-state.ts';
import { canShowAnalysisReport } from '../src/lib/analysis-run/demo-state.ts';
import { readFileSync } from 'node:fs';
const id='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const fixture=confirmedAnalysisFixture();
const record:JobAnalysisRecord={id,userId,company:'虚构',jobTitle:'虚构岗位',city:null,direction:null,jdText:fixture.draft.rawText,
  jdSourceUrl:null,jdItems:fixture.jdItems,jdConfirmationSnapshot:fixture.draft,profileVersion:1,
  profileSnapshot:{structureVersion:'1.0.0',targetDirections:[],facts:[]},report:fixture.report,
  reportStructureVersion:'1.0.0',promptVersion:'synthetic-v1',modelProvider:'fixture',modelName:'deterministic-v1',testDataVersion:'synthetic-v1',createdAt:'2026-09-30T00:00:00Z'};
const row=Object.fromEntries(reportColumns.split(',').map(k=>[k,record[k.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()) as keyof JobAnalysisRecord]]));
const processing={requestId:id,status:'processing' as const,analysisId:null,failureCode:null,startedAt:record.createdAt,finishedAt:null};
const completed={...processing,status:'completed' as const,analysisId:userId,finishedAt:record.createdAt};
test('stored read keeps original snapshots and rejects references, coverage, tampered confirmation and bad metadata',async()=>{
  assert.equal(await validAnalysisRecord(record),true);
  assert.deepEqual(await analysisFromRow(row,userId,id),record);
  assert.equal(await analysisFromRow(row,id,id),null);
  for(const bad of [{...record,report:{...record.report,coreDuties:[]}},
    {...record,jdConfirmationSnapshot:{...fixture.draft,confirmation:{...fixture.draft.confirmation!,digest:'a'.repeat(64)}}},
    {...record,jdItems:[]},{...record,profileVersion:0},{...record,createdAt:'invalid'},
    {...record,report:{...record.report,qualifications:[{...record.report.qualifications[0],factIds:['NONEXISTENT']}]}},
    {...record,jdSourceUrl:'javascript:alert(1)'},{...record,internalSecret:'sensitive'}])assert.equal(await validAnalysisRecord(bad),false);
  // Older history remains readable without retroactively manufacturing a confirmation.
  assert.equal(await validAnalysisRecord({...record,jdConfirmationSnapshot:null}),true);
});
test('read handler uses session owner filters, unified missing 404, anonymous 401 and safe invalid-data 503',async()=>{
  const filters:unknown[]=[];
  function client(data:unknown,error:unknown=null){return {from:(table:string)=>{assert.equal(table,'job_analyses');return {select:(columns:string)=>{assert.equal(columns,reportColumns);const chain={eq:(k:string,v:string)=>{filters.push([k,v]);return chain;},maybeSingle:async()=>({data,error})};return chain;}};}} as unknown as SupabaseClient;}
  let response=await reportReadHandler(async()=>({userId,supabase:client(row)}))(id);
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);
  assert.deepEqual(filters,[['user_id',userId],['id',id]]);
  assert.deepEqual((await response.json()).data,record);
  for(const data of [null]){response=await reportReadHandler(async()=>({userId,supabase:client(data)}))(id);assert.equal(response.status,404);}
  response=await reportReadHandler(async()=>{throw new ApiError(401,'UNAUTHENTICATED','请登录。');})(id);assert.equal(response.status,401);
  response=await reportReadHandler(async()=>({userId,supabase:client({...row,report:{sensitive:'RAW_SECRET'}})}))(id);
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes('RAW_SECRET'));
});
test('read browser client validates JSON, exact report identity and state invariants before rendering',async()=>{
  const success=(data:unknown)=>async()=>Response.json({ok:true,data});
  assert.deepEqual(await createAnalysisReadClient(success(record)).loadReport(id),{ok:true,data:record});
  assert.deepEqual(await createAnalysisReadClient(success(completed)).loadRun(id),{ok:true,data:completed});
  for(const bad of [{...completed,analysisId:null},{...processing,analysisId:userId},{...completed,requestId:userId},
    {...completed,requestFingerprint:'sensitive'},{...completed,finishedAt:null}])assert.equal(validRunResource(bad,id),false);
  assert.equal((await createAnalysisReadClient(success({...record,id:userId})).loadReport(id)).ok,false);
  assert.equal((await createAnalysisReadClient(async()=>new Response('{')).loadReport(id)).ok,false);
  assert.equal((await createAnalysisReadClient(success({...record,report:{}})).loadReport(id)).ok,false);
});
test('read client handles only safe status/code pairs, never trusts upstream text or retries',async()=>{
  for(const [status,code] of [[401,'UNAUTHENTICATED'],[404,'NOT_FOUND'],[503,'SERVICE_UNAVAILABLE'],[422,'INVALID_INPUT']] as const){
    let calls=0;
    const result=await createAnalysisReadClient(async(_url,init)=>{calls++;assert.equal(init?.method,'GET');assert.equal(init?.credentials,'same-origin');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');return Response.json({ok:false,error:{code,message:'RAW_SECRET'}},{status});}).loadRun(id);
    assert.deepEqual(result,readFailure(code));assert.equal(calls,1);
  }
  assert.deepEqual(await createAnalysisReadClient(async()=>Response.json({ok:false,error:{code:'DATABASE_SECRET'}},{status:409})).loadRun(id),readFailure());
  let calls=0;assert.equal((await createAnalysisReadClient(async()=>{calls++;throw Error('not called');}).loadRun('invalid')).ok,false);assert.equal(calls,0);
});
test('read client bounds hanging requests, aborts once and makes only one attempt',async()=>{
  let calls=0,aborts=0;
  const result=await createAnalysisReadClient(async(_url,init)=>{calls++;init?.signal?.addEventListener('abort',()=>aborts++);return new Promise(()=>{});},15).loadRun(id);
  assert.deepEqual(result,readFailure());assert.equal(calls,1);assert.equal(aborts,1);
});
test('refresh projection restores every run state, preserves input on failures and never authorizes generation',()=>{
  const base={...initialLiveView(),canQueryStatus:true,fields:{...initialLiveView().fields,company:'未提交输入'}};
  for(const data of [processing,completed,
    {...processing,status:'failed' as const,failureCode:'MODEL_REJECTED' as const,finishedAt:record.createdAt},
    {...processing,status:'uncertain' as const,failureCode:'MODEL_RESULT_UNCERTAIN' as const,finishedAt:record.createdAt}]){
    const next=settleLiveRun(base,{ok:true,data});assert.equal(next.state.kind,data.status);
    assert.equal(next.fields,base.fields);assert.equal(next.canGenerate,false);assert.equal(next.canCreateNewRequest,false);
    assert.equal(canShowAnalysisReport(next),data.status==='completed');
    for(const code of ['UNAUTHENTICATED','NOT_FOUND','SERVICE_UNAVAILABLE','INVALID_INPUT'] as const){
      const error=settleLiveRun(next,readFailure(code));assert.equal(error.fields,base.fields);assert.equal(canShowAnalysisReport(error),false);
      assert.equal(error.canQueryStatus,true);
    }
  }
});
test('real host is read-only, demo stays separate and report pages supply distinct provenance modes',()=>{
  const host=readFileSync('src/components/analysis-run/analysis-run-live-host.tsx','utf8');
  assert.ok(!/loadReport|\/api\/analyses|\.POST|setInterval|analysisRunDemoTransition|analysisRunDemoView|ENABLE_ANALYSIS_FIXTURE/.test(host));
  assert.match(host,/searchParams.get\('requestId'\)/);assert.match(host,/popstate/);
  assert.match(readFileSync('src/app/(app)/analyses/page.tsx','utf8'),/mode="sample"/);
  assert.match(readFileSync('src/components/report/saved-report-host.tsx','utf8'),/modelProvider==='fixture'\?'saved-test':'saved'/);
  const demo=readFileSync('src/components/analysis-run/analysis-run-demo-host.tsx','utf8');assert.ok(!demo.includes('createAnalysisReadClient'));
});
