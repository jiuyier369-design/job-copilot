import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workerRpc } from '../src/lib/analysis/queue-repository.ts';
import { consumeAnalysisOnce } from '../src/lib/analysis/worker.ts';
import { enqueueAnalysis } from '../src/lib/analysis/async.ts';
import { asyncFixture } from './helpers/async-analysis.ts';

test('204 succeeds with null and never invokes response.json; strict 200/201 JSON is retained',async t=>{
  let json204=0;const original=Response.prototype.json;
  t.mock.method(Response.prototype,'json',function(this:Response){
    if(this.status===204)json204++;return original.call(this);
  });
  const rpc=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>new Response(null,{status:204}));
  assert.equal(await rpc('record_analysis_job_usage',{}),null);assert.equal(json204,0);
  for(const status of [200,201]){
    const valid=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>Response.json({safe:true},{status}));
    assert.deepEqual(await valid('mock',{}),{safe:true});
  }
});
test('JSON success cannot hide empty/malformed bodies; 205 is not a supported PostgREST void status',async()=>{
  for(const response of [new Response('',{status:200}),new Response('bad',{status:200}),new Response(null,{status:205})]){
    const rpc=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>response);
    await assert.rejects(rpc('mock',{}),{code:'SERVICE_UNAVAILABLE'});
  }
});
test('non2xx safe JSON retains business mapping; empty and bad JSON never leak raw data',async()=>{
  const mapped=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>Response.json(
    {code:'PT409',message:'PROFILE_VERSION_CONFLICT',details:'SENSITIVE_MOCK_RAW'},{status:409}));
  await assert.rejects(mapped('mock',{}),(e:unknown)=>e instanceof Error&&'code' in e&&e.code==='PROFILE_VERSION_CONFLICT'
    &&!JSON.stringify(e).includes('SENSITIVE_MOCK_RAW'));
  for(const response of [new Response('',{status:401}),new Response('SENSITIVE_MOCK_RAW',{status:422}),
    Response.json({code:'UNKNOWN',message:'SENSITIVE_MOCK_RAW'},{status:400})]){
    const rpc=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>response);
    await assert.rejects(rpc('mock',{}),(e:unknown)=>e instanceof Error&&'code' in e&&e.code==='SERVICE_UNAVAILABLE'
      &&!JSON.stringify(e).includes('SENSITIVE_MOCK_RAW'));
  }
});
test('successful void usage write permits report A2 validation and atomic save; replay does not regenerate',async()=>{
  const x=asyncFixture();let usageCalls=0;
  const rpc=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>{usageCalls++;return new Response(null,{status:204});});
  x.worker.queue.metrics=async()=>{assert.equal(await rpc('record_analysis_job_usage',{}),null);};
  await enqueueAnalysis('A',x.request,x.admission);
  assert.equal(await consumeAnalysisOnce(x.worker),'completed');assert.equal(x.calls(),1);assert.equal(x.writes(),1);assert.equal(usageCalls,1);
  assert.equal((await enqueueAnalysis('A',x.request,x.admission)).status,'completed');
  assert.equal(await consumeAnalysisOnce(x.worker),'idle');assert.equal(x.calls(),1);
});
test('real transport failures and timeout remain unavailable with a single attempt and no logs',async t=>{
  for(const send of [async()=>{throw Error('SENSITIVE_MOCK_NETWORK');},async()=>new Response(null,{status:503})]){
    const rpc=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,send);
    await assert.rejects(rpc('mock',{}),{code:'SERVICE_UNAVAILABLE'});
  }
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const rpc=workerRpc('https://mock.invalid','MOCK_ONLY',undefined,async()=>{calls++;return new Promise<Response>(()=>{});});
  const pending=rpc('mock',{});t.mock.timers.tick(8000);await assert.rejects(pending,{code:'SERVICE_UNAVAILABLE'});assert.equal(calls,1);
  const code=readFileSync('src/lib/analysis/queue-repository.ts','utf8');assert.ok(!code.includes('console.')&&!code.includes('error.message'));
});
