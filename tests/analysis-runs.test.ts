import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateAnalysis,requestFingerprint,type GenerationPorts,type InternalRun,type RunRepository } from '../src/lib/analysis/runs.ts';
import { createFixtureModel,fixtureMetadata,fixtureModelTimeoutMs } from '../src/lib/analysis/fixture.ts';
import { ApiError } from '../src/lib/api/http.ts';
import { confirmedAnalysisFixture } from './helpers/confirmed-analysis.ts';
import { analysisHandlers } from '../src/lib/analysis/handlers.ts';
import { boundedAnalysisFetch } from '../src/lib/analysis/transport.ts';
import { readFileSync } from 'node:fs';
import { createAnalysisDiagnostics } from '../src/lib/analysis/diagnostics.ts';
function setup(){
  const f=confirmedAnalysisFixture();let draft=f.draft,version=1,writes=0;
  const rows=new Map<string,InternalRun>();
  const key=(user:string,id:string)=>`${user}:${id}`;
  const runs:RunRepository={
    load:async(u,id)=>structuredClone(rows.get(key(u,id))??null),
    reserve:async r=>{
      const k=key(r.userId,r.request.requestId),old=rows.get(k);
      if(old){if(old.fingerprint!==r.fingerprint)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','safe');return {acquired:false,run:structuredClone(old)};}
      const run:InternalRun={id:randomUUID(),requestId:r.request.requestId,fingerprint:r.fingerprint,digest:r.digest,
        status:'processing',analysisId:null,failureCode:null,startedAt:new Date().toISOString(),finishedAt:null};
      rows.set(k,run);return {acquired:true,run:structuredClone(run)};
    },
    complete:async(u,id)=>{const r=rows.get(key(u,id))!;if(r.status==='processing'){writes++;r.status='completed';r.analysisId=randomUUID();r.finishedAt=new Date().toISOString();}return structuredClone(r);},
    finish:async(u,id,status,code)=>{const r=rows.get(key(u,id))!;if(r.status==='processing'){r.status=status;r.failureCode=code;r.finishedAt=new Date().toISOString();}return structuredClone(r);},
  };
  const fixture=createFixtureModel({NODE_ENV:'test',ENABLE_ANALYSIS_FIXTURE:'true',ANALYSIS_MODEL_TIMEOUT_MS:'5000'});
  const ports:GenerationPorts={runs,drafts:{load:async()=>structuredClone(draft),create:async()=>{throw Error();},replace:async()=>{throw Error();},remove:async()=>{throw Error();}},
    loadProfile:async()=>({version,updatedAt:new Date().toISOString(),profile:{structureVersion:'1.0.0',targetDirections:[],facts:[{factId:'P1',category:'project',context:'personal_project',statement:'虚构实践'}]}}),
    model:fixture.generate,metadata:fixtureMetadata,modelTimeoutMs:30};
  const request={requestId:randomUUID(),draftId:draft.id,expectedDraftRevision:2,expectedProfileVersion:1,
    company:'虚构',jobTitle:'fixture:success',city:null,direction:null,jdSourceUrl:null};
  return {ports,request,fixture,rows,writes:()=>writes,changeProfile:()=>{version++;},changeDraft:()=>{draft={...draft,revision:3,confirmation:null};}};
}
test('concurrent identical requests invoke once; replay and GET recover completed; different input conflicts',async()=>{
  const x=setup();let release!:()=>void;
  const model=x.ports.model;
  x.ports.model=async(...args)=>{await new Promise<void>(r=>{release=r;});return model(...args);};
  const first=generateAnalysis('A',x.request,x.ports);
  while(!release)await new Promise(r=>setTimeout(r,1));
  const second=await generateAnalysis('A',x.request,x.ports);assert.equal(second.status,'processing');
  release();const completed=await first;assert.equal(completed.status,'completed');assert.equal(x.fixture.calls(),1);assert.equal(x.writes(),1);
  assert.deepEqual(await generateAnalysis('A',x.request,x.ports),completed);
  await assert.rejects(generateAnalysis('A',{...x.request,company:'另一岗位'},x.ports),{code:'IDEMPOTENCY_CONFLICT'});
  const h=analysisHandlers(async()=>({userId:'A',runs:x.ports.runs}),()=>x.ports);
  const response=await h.GET(x.request.requestId);assert.deepEqual((await response.json()).data,completed);
  const b=analysisHandlers(async()=>({userId:'B',runs:x.ports.runs}),()=>x.ports);assert.equal((await b.GET(x.request.requestId)).status,404);
  x.ports.model=model;await generateAnalysis('A',{...x.request,requestId:randomUUID()},x.ports);assert.equal(x.writes(),2);
});
test('pre-reserve unconfirmed, stale JD and profile reject without model or run',async()=>{
  for(const mode of ['jd','profile','unconfirmed']){
    const x=setup();if(mode==='profile')x.changeProfile();else if(mode==='unconfirmed')x.changeDraft();
    await assert.rejects(generateAnalysis('A',mode==='jd'?{...x.request,expectedDraftRevision:1}:x.request,x.ports));
    assert.equal(x.rows.size,0);assert.equal(x.fixture.calls(),0);
  }
});
test('source changes during model cannot save; replay recovers completed after source changes',async()=>{
  for(const kind of ['jd','profile']){
    const x=setup(),model=x.ports.model;
    x.ports.model=async(...args)=>{const output=await model(...args);if(kind==='jd')x.changeDraft();else x.changeProfile();return output;};
    const r=await generateAnalysis('A',x.request,x.ports);assert.equal(r.status,'failed');assert.equal(x.writes(),0);
  }
  const x=setup();const r=await generateAnalysis('A',x.request,x.ports);x.changeDraft();x.changeProfile();
  assert.deepEqual(await generateAnalysis('A',x.request,x.ports),r);assert.equal(x.fixture.calls(),1);
});
test('invalid/rejected become failed; timeout/unknown become uncertain; terminal states never retry',async()=>{
  for(const [title,status,code]of [['invalid','failed','REPORT_INVALID'],['rejected','failed','MODEL_REJECTED'],['timeout','uncertain','MODEL_RESULT_UNCERTAIN'],['network','uncertain','MODEL_RESULT_UNCERTAIN']] as const){
    const x=setup();x.request.jobTitle=`fixture:${title}`;
    let calls=0;const model=x.ports.model;x.ports.model=async(...args)=>{calls++;if(title==='network')throw Error('secret input');return model(...args);};
    const r=await generateAnalysis('A',x.request,x.ports);assert.equal(r.status,status);assert.equal(r.failureCode,code);
    assert.deepEqual(await generateAnalysis('A',x.request,x.ports),r);assert.equal(calls,1);assert.equal(x.writes(),0);
    assert.ok(!JSON.stringify(r).includes('secret'));
  }
});
test('save response loss returns committed completed; unknown save does not fabricate success',async()=>{
  for(const committed of [true,false]){
    const x=setup(),complete=x.ports.runs.complete;
    x.ports.runs.complete=async(...args)=>{if(committed)await complete(...args);throw Error('private database');};
    const r=await generateAnalysis('A',x.request,x.ports);
    assert.equal(r.status,committed?'completed':'uncertain');assert.equal(r.failureCode,committed?null:'SAVE_RESULT_UNCERTAIN');
    assert.equal(x.fixture.calls(),1);
  }
});
test('fingerprint covers owner, request, metadata and frozen source version with property-order independence',()=>{
  const x=setup(),digest='a'.repeat(64),fp=requestFingerprint('A',x.request,digest,fixtureMetadata);
  assert.equal(fp,requestFingerprint('A',{...x.request},digest,{...fixtureMetadata}));
  for(const change of [{city:'新城市'},{expectedProfileVersion:2},{expectedDraftRevision:3},{requestId:randomUUID()}])assert.notEqual(fp,requestFingerprint('A',{...x.request,...change},digest,fixtureMetadata));
  assert.notEqual(fp,requestFingerprint('B',x.request,digest,fixtureMetadata));
  assert.notEqual(fp,requestFingerprint('A',x.request,'b'.repeat(64),fixtureMetadata));
  assert.notEqual(fp,requestFingerprint('A',x.request,digest,{...fixtureMetadata,promptVersion:'new'}));
});
test('fixture never enables in production or implicitly; bounded transport aborts once and hides raw errors',async()=>{
  assert.throws(()=>createFixtureModel({NODE_ENV:'production',ENABLE_ANALYSIS_FIXTURE:'true'}));
  assert.throws(()=>createFixtureModel({NODE_ENV:'test'}));
  let calls=0,signal:AbortSignal|undefined;
  const send:typeof fetch=async(_u,init)=>{calls++;signal=init?.signal as AbortSignal;return new Promise(()=>{});};
  const response=await boundedAnalysisFetch(send,10)('https://example.invalid');
  assert.equal(response.status,499);assert.equal(calls,1);assert.equal(signal?.aborted,true);
  const hidden=await boundedAnalysisFetch(async()=>{throw Error('SENSITIVE');})('https://example.invalid');
  assert.ok(!(await hidden.text()).includes('SENSITIVE'));
});
test('sixth migration statically closes old entrypoints and restricts transitions, owner and locks',()=>{
  const sql=readFileSync('supabase/migrations/20260930000200_analysis_runs.sql','utf8');
  assert.ok(!sql.includes('40001'));assert.match(sql,/unique \(user_id, request_id\)/);
  assert.match(sql,/foreign key \(analysis_id, user_id\)/);assert.match(sql,/old.status <> 'processing'/);
  assert.match(sql,/on conflict \(user_id,request_id\) do nothing/);
  assert.match(sql,/revoke all on function public.store_confirmed_analysis[\s\S]*from public,anon,authenticated,service_role/);
  assert.match(sql,/run -> JD -> profile/);assert.match(sql,/enable row level security/);
  assert.match(sql,/failure_code is not null/);
});
test('HTTP validates origin, session, size and structure without model; safe status response',async()=>{
  const x=setup();let owner='A';
  const h=analysisHandlers(async()=>{if(!owner)throw new ApiError(401,'UNAUTHENTICATED','登录已失效');return {userId:owner,runs:x.ports.runs};},()=>x.ports);
  const send=(body:unknown,origin:string|null='http://localhost:3000')=>h.POST(new Request('http://localhost:3000/api/analyses',{
    method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)}));
  assert.equal((await send(x.request,null)).status,403);
  assert.equal((await send({...x.request,userId:'SENSITIVE'})).status,422);
  assert.equal((await send({...x.request,company:'a'.repeat(70000)})).status,413);
  owner='';assert.equal((await send(x.request)).status,401);owner='A';assert.equal(x.fixture.calls(),0);
  const r=await send(x.request);assert.equal(r.status,200);assert.match(r.headers.get('cache-control')??'',/no-store/);
  const data=await r.json();assert.equal(data.data.status,'completed');assert.ok(!JSON.stringify(data).includes('fingerprint'));
});
test('actual pipeline diagnostics distinguish rejection, invalid report, timeout and successful finish',async()=>{
  for(const scenario of ['rejected','invalid','timeout']){
    const x=setup(),events:{stage:string;result:string;elapsedMs:number}[]=[];
    x.request.jobTitle=`fixture:${scenario}`;
    x.ports.diagnostics=createAnalysisDiagnostics({NODE_ENV:'test',ENABLE_ANALYSIS_FIXTURE:'true',ANALYSIS_FIXTURE_DIAGNOSTICS:'true'},e=>events.push(e));
    const outcome=await generateAnalysis('A',x.request,x.ports);
    assert.equal(outcome.status,scenario==='timeout'?'uncertain':'failed');
    assert.ok(events.some(e=>e.stage===({rejected:'model-rejected',invalid:'model-output-invalid',timeout:'model-timeout'}[scenario])));
    assert.ok(events.some(e=>e.stage==='finish-completed'));assert.equal(x.fixture.calls(),1);
    await generateAnalysis('A',x.request,x.ports);assert.equal(x.fixture.calls(),1);
    assert.equal(events.at(-1)?.stage,'run-reserve-replayed');
    assert.ok(!JSON.stringify(events).includes(x.request.requestId));
    assert.ok(!JSON.stringify(events).includes('虚构实践'));
  }
});

test('fixture server budget is explicit and bounded; all invalid settings return safe 503 before reserve',async()=>{
  assert.equal(fixtureModelTimeoutMs({ANALYSIS_MODEL_TIMEOUT_MS:'5000'}),5000);
  for(const raw of [undefined,'','-1','0','NaN','Infinity','abc','1.5','5e3',' 5000 ','999','8001','9007199254740993']){
    const x=setup();
    const h=analysisHandlers(async()=>({userId:'A',runs:x.ports.runs}),()=>{
      const fixture=createFixtureModel({NODE_ENV:'test',ENABLE_ANALYSIS_FIXTURE:'true',ANALYSIS_MODEL_TIMEOUT_MS:raw});
      return {...x.ports,model:fixture.generate,modelTimeoutMs:fixture.modelTimeoutMs};
    });
    const r=await h.POST(new Request('http://localhost:3000/api/analyses',{method:'POST',
      headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(x.request)}));
    assert.equal(r.status,503);const body=await r.json();assert.equal(body.error.code,'SERVICE_UNAVAILABLE');
    assert.equal(x.rows.size,0);assert.equal(x.fixture.calls(),0);
    assert.ok(!JSON.stringify(body).includes('ANALYSIS_MODEL_TIMEOUT_MS'));
  }
  for(const raw of ['1000','8000'])assert.equal(fixtureModelTimeoutMs({ANALYSIS_MODEL_TIMEOUT_MS:raw}),Number(raw));
  assert.throws(()=>createFixtureModel({NODE_ENV:'production',ENABLE_ANALYSIS_FIXTURE:'true',ANALYSIS_MODEL_TIMEOUT_MS:'5000'}),{status:503});
  const runtime=readFileSync('src/lib/analysis/runtime.ts','utf8');assert.match(runtime,/createFixtureModel\(process.env\)/);
  assert.match(runtime,/asyncAnalysisPost/);
});

test('browser cannot override budget through frozen generation request',async()=>{
  const x=setup(),h=analysisHandlers(async()=>({userId:'A',runs:x.ports.runs}),()=>x.ports);
  for(const field of ['modelTimeoutMs','ANALYSIS_MODEL_TIMEOUT_MS']){
    const r=await h.POST(new Request('http://localhost:3000/api/analyses',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},
      body:JSON.stringify({...x.request,[field]:999999})}));
    assert.equal(r.status,422);
  }
  assert.equal(x.fixture.calls(),0);assert.equal(x.rows.size,0);
});

test('explicit 5000ms abort settles fixture once; finish precedes HTTP response; replay and GET never call again',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const x=setup(),fixture=createFixtureModel({NODE_ENV:'test',ENABLE_ANALYSIS_FIXTURE:'true',ANALYSIS_MODEL_TIMEOUT_MS:'5000'});
  x.request.jobTitle='fixture:timeout';let signal:AbortSignal|undefined,settlements=0,finishes=0;
  const originalFinish=x.ports.runs.finish;
  x.ports.runs.finish=async(...args)=>{finishes++;return originalFinish(...args);};
  x.ports.modelTimeoutMs=fixture.modelTimeoutMs;
  x.ports.model=(input,title,s)=>{signal=s;return fixture.generate(input,title,s).finally(()=>{settlements++;});};
  const h=analysisHandlers(async()=>({userId:'A',runs:x.ports.runs}),()=>x.ports);
  const send=()=>h.POST(new Request('http://localhost:3000/api/analyses',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(x.request)}));
  let responded=false;const pending=send().then(r=>{responded=true;return r;});
  while(!signal)await new Promise<void>(resolve=>setImmediate(resolve));
  t.mock.timers.tick(4999);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(signal.aborted,false);assert.equal(responded,false);
  t.mock.timers.tick(1);const response=await pending;
  assert.equal(signal.aborted,true);assert.equal(settlements,1);assert.equal(finishes,1);assert.equal(response.status,200);
  const run=(await response.json()).data;
  assert.equal(run.status,'uncertain');assert.equal(run.failureCode,'MODEL_RESULT_UNCERTAIN');assert.equal(x.writes(),0);
  t.mock.timers.tick(10000);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(settlements,1);
  assert.deepEqual((await (await send()).json()).data,run);
  assert.deepEqual((await (await h.GET(x.request.requestId)).json()).data,run);
  assert.equal(fixture.calls(),1);assert.equal(finishes,1);
});
