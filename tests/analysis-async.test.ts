import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { asyncFixture } from './helpers/async-analysis.ts';
import { asyncAnalysisPost,enqueueAnalysis } from '../src/lib/analysis/async.ts';
import { analysisHandlers } from '../src/lib/analysis/handlers.ts';
import { consumeAnalysisOnce } from '../src/lib/analysis/worker.ts';
import { workerConfiguration,workerCostBound } from '../src/lib/analysis/async-config.ts';
import { workerHttp } from '../src/lib/analysis/worker-http.ts';
import { createWorkerModel } from '../src/lib/analysis/worker-model.ts';
import { workerRpc,analysisQueueRepository } from '../src/lib/analysis/queue-repository.ts';
import { pollAnalysisRun } from '../src/lib/analysis-run/poll.ts';
import { createAnalysisReadClient } from '../src/lib/analysis-run/read-client.ts';
import { ApiError } from '../src/lib/api/http.ts';
import { mockDeepSeekEnv } from './helpers/deepseek-generation.ts';
import { deepSeekEnvelope } from './helpers/deepseek-generation.ts';
const http=(body:unknown,origin:string|null='http://localhost:3000')=>new Request('http://localhost:3000/api/analyses',
  {method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});

test('POST is 202 before any model; simultaneous requestIds enqueue once; GET/completed replay retain original contract',async()=>{
  const x=asyncFixture(),POST=asyncAnalysisPost(async()=>({userId:'A'}),()=>x.admission);
  const responses=await Promise.all([POST(http(x.request)),POST(http(x.request))]);
  for(const response of responses){assert.equal(response.status,202);const body=await response.json();
    assert.equal(body.code,'ANALYSIS_IN_PROGRESS');assert.equal(body.data.requestId,x.request.requestId);assert.equal(body.data.status,'processing');
    assert.match(response.headers.get('cache-control')??'',/no-store/);assert.ok(!JSON.stringify(body).includes('fingerprint'));}
  assert.equal(x.jobs.length,1);assert.equal(x.calls(),0);
  const GET=analysisHandlers(async()=>({userId:'A',runs:x.ports.runs}),()=>x.ports).GET;
  assert.equal((await (await GET(x.request.requestId)).json()).data.status,'processing');
  const results=await Promise.all([consumeAnalysisOnce(x.worker),consumeAnalysisOnce(x.worker)]);
  assert.ok(results.includes('completed'));assert.equal(x.calls(),1);assert.equal(x.writes(),1);
  const completed=await enqueueAnalysis('A',x.request,x.admission);assert.equal(completed.status,'completed');
  assert.equal((await POST(http(x.request))).status,200);assert.equal(x.calls(),1);assert.equal(x.jobs.length,1);
  assert.equal((await (await GET(x.request.requestId)).json()).data.analysisId,completed.analysisId);
  await assert.rejects(enqueueAnalysis('A',{...x.request,company:'不同虚构公司'},x.admission),{code:'IDEMPOTENCY_CONFLICT'});
});

test('reserve+send failure rolls back mock transaction; lost HTTP response is recovered by GET, not a new POST',async()=>{
  const x=asyncFixture();x.failEnqueue();await assert.rejects(enqueueAnalysis('A',x.request,x.admission));
  assert.equal(x.jobs.length,0);assert.equal(x.rows.size,0);assert.equal(x.calls(),0);
  x.failEnqueue(false);await enqueueAnalysis('A',x.request,x.admission); // client discards 202
  await consumeAnalysisOnce(x.worker);
  const saved=await x.ports.runs.load('A',x.request.requestId);assert.equal(saved?.status,'completed');assert.equal(x.calls(),1);
});

test('rejected/invalid/timeout terminate without save; failed/uncertain replay and redelivery never regenerate',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const mode of ['rejected','invalid','timeout'] as const){
    const x=asyncFixture();x.setMode(mode);await enqueueAnalysis('A',x.request,x.admission);
    const pending=consumeAnalysisOnce(x.worker);while(x.calls()===0)await new Promise<void>(r=>setImmediate(r));
    if(mode==='timeout')t.mock.timers.tick(30000);
    const state=await pending;assert.equal(state,mode==='timeout'?'uncertain':'failed');assert.equal(x.writes(),0);
    const replay=await enqueueAnalysis('A',x.request,x.admission);assert.equal(replay.status,state);
    await consumeAnalysisOnce(x.worker);assert.equal(x.calls(),1);assert.equal(x.jobs.length,1);
  }
});

test('pre-marker worker crash can reclaim with new token; stale preparing worker cannot start a model',async()=>{
  const x=asyncFixture();await enqueueAnalysis('A',x.request,x.admission);
  const m=(await x.worker.queue.read())!,old=await x.worker.queue.claim(m);
  assert.equal(old.mode,'acquired');assert.equal(x.calls(),0);x.advance(91000);
  const newer=await x.worker.queue.claim(m);assert.notEqual(newer.token,old.token);
  assert.equal(await x.worker.queue.start(m,old.token!,.1),false);
  x.advance(91000);assert.equal(await consumeAnalysisOnce(x.worker),'completed');assert.equal(x.calls(),1);
});

test('marker-to-call gap, in-call crash and model-success-before-save crash recover uncertain without repeat',async()=>{
  for(const callOccurred of [false,true]){
    const x=asyncFixture();await enqueueAnalysis('A',x.request,x.admission);
    const m=(await x.worker.queue.read())!,claim=await x.worker.queue.claim(m);
    assert.equal(await x.worker.queue.start(m,claim.token!, .1),true);
    if(callOccurred)await x.worker.model(x.input,'mock',new AbortController().signal);
    x.advance(91000);
    assert.equal(await consumeAnalysisOnce(x.worker),'uncertain');assert.equal(x.calls(),callOccurred?1:0);assert.equal(x.writes(),0);
    await enqueueAnalysis('A',x.request,x.admission);assert.equal(x.calls(),callOccurred?1:0);
  }
});

test('lost start response never dispatches; completed save response loss/archive failure never creates another report',async()=>{
  const x=asyncFixture();x.loseStartResponse();await enqueueAnalysis('A',x.request,x.admission);
  assert.equal(await consumeAnalysisOnce(x.worker),'uncertain');assert.equal(x.calls(),0);assert.equal(x.writes(),0);
  const y=asyncFixture();y.loseSaveResponse();y.failArchive();await enqueueAnalysis('A',y.request,y.admission);
  assert.equal(await consumeAnalysisOnce(y.worker),'completed');assert.equal(y.calls(),1);assert.equal(y.writes(),1);
  assert.equal(await consumeAnalysisOnce(y.worker),'completed');assert.equal(y.calls(),1);assert.equal(y.writes(),1);
  y.failArchive(false);assert.equal(await consumeAnalysisOnce(y.worker),'completed');assert.ok(y.jobs[0].archived);
});

test('sources changed before/while model prevent save; new requestId is required for explicit regeneration',async()=>{
  for(const change of ['profile','draft'] as const)for(const during of [false,true]){
    const x=asyncFixture();await enqueueAnalysis('A',x.request,x.admission);
    const mutate=()=>change==='profile'?x.changeProfile():x.changeDraft();if(during)x.onModel(mutate);else mutate();
    assert.equal(await consumeAnalysisOnce(x.worker),'failed');assert.equal(x.writes(),0);assert.equal(x.calls(),during?1:0);
    await enqueueAnalysis('A',x.request,x.admission);assert.equal(x.calls(),during?1:0);
  }
  const x=asyncFixture();await enqueueAnalysis('A',x.request,x.admission);await consumeAnalysisOnce(x.worker);
  await enqueueAnalysis('A',{...x.request,requestId:randomUUID()},x.admission);await consumeAnalysisOnce(x.worker);
  assert.equal(x.jobs.length,2);assert.equal(x.calls(),2);assert.equal(x.writes(),2);
});

test('admission rejects stale/unconfirmed/profile versions, forged userId/config, anonymous and cross-origin before enqueue',async()=>{
  const x=asyncFixture();let owner='A';const POST=asyncAnalysisPost(async()=>{if(!owner)throw new ApiError(401,'UNAUTHENTICATED','safe');return {userId:owner};},()=>x.admission);
  for(const key of ['userId','provider','model','timeoutMs','ANALYSIS_WORKER_MODEL_TIMEOUT_MS','max_tokens','budget','usdToCny','report','confirmation'])
    assert.equal((await POST(http({...x.request,[key]:'PRIVATE'}))).status,422);
  assert.equal((await POST(http(x.request,null))).status,403);assert.equal((await POST(http(x.request,'https://invalid.example'))).status,403);
  owner='';assert.equal((await POST(http(x.request))).status,401);owner='A';
  assert.equal((await POST(http({...x.request,expectedProfileVersion:99}))).status,409);
  x.changeDraft();assert.equal((await POST(http(x.request))).status,409);assert.equal(x.jobs.length,0);assert.equal(x.calls(),0);
  const y=asyncFixture();await enqueueAnalysis('A',y.request,y.admission);
  const GET=analysisHandlers(async()=>({userId:'B',runs:y.ports.runs}),()=>y.ports).GET;
  assert.equal((await GET(y.request.requestId)).status,404);
  const anon=analysisHandlers(async()=>{throw new ApiError(401,'UNAUTHENTICATED','safe');},()=>y.ports);
  assert.equal((await anon.GET(y.request.requestId)).status,401);
});

test('private worker endpoint refuses anonymous, user JWT and forged owner body before privileged work',async()=>{
  let calls=0;const token='MOCK_PRIVATE_WORKER_TOKEN_'.repeat(2),handler=workerHttp(token,async()=>{calls++;return 'idle';});
  const request=(body:unknown,credential?:string)=>new Request('https://test.invalid/worker',{method:'POST',
    headers:{'content-type':'application/json',...(credential?{'x-job-copilot-worker':credential}:{authorization:'Bearer MOCK_USER_TOKEN'})},body:JSON.stringify(body)});
  assert.equal((await handler(request({}))).status,401);assert.equal((await handler(request({},'wrong'))).status,401);
  assert.equal((await handler(request({userId:'PRIVATE'},token))).status,422);assert.equal(calls,0);
  assert.equal((await handler(request({},token))).status,200);assert.equal(calls,1);
});

test('background config is separate, bounded and fail-closed; missing usage stays uncertain, CNY budget gate precedes call',async()=>{
  const env={ANALYSIS_WORKER_MODEL_TIMEOUT_MS:'30000',ANALYSIS_USD_TO_CNY:'8',ANALYSIS_MAX_CALL_CNY:'1'};
  assert.equal(workerConfiguration(env).modelTimeoutMs,30000);
  for(const raw of ['0','-1','NaN','45001','1.1',undefined])assert.throws(()=>workerConfiguration({...env,ANALYSIS_WORKER_MODEL_TIMEOUT_MS:raw}));
  for(const raw of ['NaN','0','100',undefined])assert.throws(()=>workerConfiguration({...env,ANALYSIS_USD_TO_CNY:raw}));
  assert.throws(()=>workerConfiguration({...env,ANALYSIS_MAX_CALL_CNY:'1.01'}));
  const x=asyncFixture();assert.ok(workerCostBound(x.input,workerConfiguration(env))<=1);
  x.worker.fixture=false;await enqueueAnalysis('A',x.request,x.admission);
  assert.equal(await consumeAnalysisOnce(x.worker),'uncertain');assert.equal(x.writes(),0);assert.equal(x.calls(),1);
  await enqueueAnalysis('A',x.request,x.admission);assert.equal(x.calls(),1);
  const z=asyncFixture();for(let i=0;i<4;i++){await enqueueAnalysis('A',{...z.request,requestId:randomUUID()},z.admission);await consumeAnalysisOnce(z.worker);}
  assert.equal(z.calls(),4);assert.equal(z.jobs.length,4); // SQL does not charge the real budget for fixture
  assert.throws(()=>createWorkerModel({...mockDeepSeekEnv,...env,NODE_ENV:'production',ENABLE_ANALYSIS_FIXTURE:'true'},async()=>{throw Error('never');}));
});

test('logs only contain fixed phases/status/timing, not inputs or raw failures',async()=>{
  const x=asyncFixture(),logs:unknown[]=[];x.request.jobTitle='PRIVATE_INPUT_TOKEN_OR_KEY';x.worker.log=e=>logs.push(e);
  x.worker.model=async()=>{throw Error('PRIVATE_RAW_BODY');};
  await enqueueAnalysis('A',x.request,x.admission);assert.equal(await consumeAnalysisOnce(x.worker),'uncertain');
  assert.ok(logs.length>0);for(const log of logs)assert.deepEqual(Object.keys(log as object).sort(),['elapsedMs','result','stage']);
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'));assert.ok(!JSON.stringify(logs).includes(x.request.requestId));
});

test('polling persists URL requestId beyond 15s fixture; GET only, terminal/error stop, hidden pause, no input replacement',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const x=asyncFixture();await enqueueAnalysis('A',x.request,x.admission);
  const url=new URL(`http://localhost:3000/analysis-run?requestId=${x.request.requestId}`);let reads=0,visible=true;
  const input='PRIVATE_UNSAVED_INPUT';let finished=false;
  let modelStarted=false;
  x.worker.model=async()=>{modelStarted=true;await new Promise(r=>setTimeout(r,16000));return structuredClone(x.report);};
  const workerPending=consumeAnalysisOnce(x.worker);
  while(!modelStarted)await new Promise<void>(r=>setImmediate(r));
  const query=async()=>{reads++;const run=(await x.ports.runs.load('A',url.searchParams.get('requestId')!))!;
    const {requestId,status,analysisId,failureCode,startedAt,finishedAt}=run;
    const client=createAnalysisReadClient(async(_url,options)=>{assert.equal(options?.method,'GET');return Response.json({ok:true,data:{requestId,status,analysisId,failureCode,startedAt,finishedAt}});});
    const result=await client.loadRun(requestId);if(result.ok&&result.data.status==='completed')finished=true;return result;};
  const stop=pollAnalysisRun(query,()=>visible);
  for(let i=0;i<5;i++){t.mock.timers.tick(3000);await new Promise<void>(r=>setImmediate(r));}
  assert.equal(reads,5);assert.equal(url.searchParams.get('requestId'),x.request.requestId);assert.equal(input,'PRIVATE_UNSAVED_INPUT');
  visible=false;t.mock.timers.tick(3000);await new Promise<void>(r=>setImmediate(r));assert.equal(reads,5);visible=true;
  await workerPending;t.mock.timers.tick(3000);await new Promise<void>(r=>setImmediate(r));assert.equal(finished,true);
  const count=reads;t.mock.timers.tick(9000);await new Promise<void>(r=>setImmediate(r));assert.equal(reads,count);stop();
  let errors=0;const cancel=pollAnalysisRun(async()=>{errors++;return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'safe'}};});
  t.mock.timers.tick(3000);await new Promise<void>(r=>setImmediate(r));t.mock.timers.tick(3000);assert.equal(errors,1);cancel();
  const host=readFileSync('src/components/analysis-run/analysis-run-live-host.tsx','utf8');assert.match(host,/searchParams.get\('requestId'\)/);
  assert.match(host,/onGenerate=\{\(\)=>\{\}\}/);assert.ok(!host.includes('localStorage'));
});

test('RPC transport has one bounded attempt; malformed queue messages and unauthorized errors are never exposed',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const rpc=workerRpc('https://test.invalid','MOCK_SERVER_SECRET',undefined,async()=>{calls++;return new Promise(()=>{});});
  const pending=rpc('read_analysis_job_message',{});t.mock.timers.tick(8000);await assert.rejects(pending,{code:'SERVICE_UNAVAILABLE'});assert.equal(calls,1);
  const q=analysisQueueRepository(async()=>({messageId:1,message:{userId:'PRIVATE'}}));await assert.rejects(q.read());
});

test('real-provider worker wiring is validated by injected fetch only: JSON/A2/usage/save and replay without external network',async()=>{
  const x=asyncFixture();let sends=0;let storedUsage:unknown=null;
  const model=createWorkerModel({...mockDeepSeekEnv,NODE_ENV:'test',ENABLE_ANALYSIS_FIXTURE:'false',
    ANALYSIS_WORKER_MODEL_TIMEOUT_MS:'30000',ANALYSIS_USD_TO_CNY:'8',ANALYSIS_MAX_CALL_CNY:'1'},async(_url,options)=>{
    sends++;assert.equal(options?.method,'POST');
    const body=JSON.parse(String(options?.body));assert.equal(body.max_tokens,4096);assert.equal(body.model,'deepseek-flash');
    assert.equal(body.thinking.type,'disabled');
    return Response.json({...deepSeekEnvelope(x.report),model:'deepseek-flash'});
  });
  x.admission.metadata=model.metadata;
  const context=x.worker.queue.context;
  const queue={...x.worker.queue,context:async(...args:Parameters<typeof context>)=>({...await context(...args),metadata:model.metadata}),
    metrics:async(_message:unknown,_token:unknown,event:unknown)=>{storedUsage=event;}};
  await enqueueAnalysis('A',x.request,x.admission);
  assert.equal(await consumeAnalysisOnce({...model,queue}),'completed');
  assert.equal(model.config.modelTimeoutMs,30000);assert.equal(x.writes(),1);assert.equal(sends,1);
  assert.ok(storedUsage&&typeof storedUsage==='object'&&'estimatedUsd' in storedUsage&&typeof storedUsage.estimatedUsd==='number');
  assert.equal((await enqueueAnalysis('A',x.request,x.admission)).status,'completed');
  await consumeAnalysisOnce({...model,queue});assert.equal(sends,1);assert.equal(x.writes(),1);
});
