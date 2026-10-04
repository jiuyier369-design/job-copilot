import test from 'node:test';
import assert from 'node:assert/strict';
import { asyncFixture } from './helpers/async-analysis.ts';
import { enqueueAnalysis } from '../src/lib/analysis/async.ts';
import { consumeFixture } from '../src/lib/analysis/edge-fixture-faults.ts';
import { consumeAnalysisOnce } from '../src/lib/analysis/worker.ts';
import { workerHttp } from '../src/lib/analysis/worker-http.ts';
import { safeCode } from '../scripts/ds3b1-tools.mjs';

test('service-only fault commands are closed by default and token validation precedes their parsing',async()=>{
  let calls=0;const token='MOCK_PRIVATE_TOKEN_'.repeat(3);
  const run=async()=>{calls++;return 'idle';};
  const request=(value:unknown,t=token)=>new Request('https://test.invalid',{method:'POST',
    headers:{'content-type':'application/json','x-job-copilot-worker':t},body:JSON.stringify(value)});
  assert.equal((await workerHttp(token,run)(request({fixtureFault:'before-read'}))).status,422);
  const open=workerHttp(token,run,true);
  assert.equal((await open(request({fixtureFault:'before-read'},'wrong'))).status,401);
  for(const body of [{fixtureFault:'unknown'},{fixtureFault:'before-read',userId:'SENSITIVE'}, {model:'SENSITIVE'}])
    assert.equal((await open(request(body))).status,422);
  assert.equal(calls,0);assert.equal((await open(request({fixtureFault:'before-read'}))).status,200);
});
test('remote fault adapters retain production core rules and never bypass durable model marker',async()=>{
  for(const fault of ['before-read','after-marker','archive-deferred'] as const){
    const x=asyncFixture();await enqueueAnalysis('A',x.request,x.admission);
    if(fault==='before-read'){
      await assert.rejects(consumeFixture(x.worker,fault));assert.equal(x.calls(),0);
      assert.equal(await consumeAnalysisOnce(x.worker),'completed');assert.equal(x.calls(),1);
    }else if(fault==='after-marker'){
      assert.equal(await consumeFixture(x.worker,fault),'uncertain');assert.equal(x.calls(),0);assert.equal(x.writes(),0);
      assert.equal(await consumeAnalysisOnce(x.worker),'idle');assert.equal(x.calls(),0);
      assert.equal((await enqueueAnalysis('A',x.request,x.admission)).status,'uncertain');
    }else{
      assert.equal(await consumeFixture(x.worker,fault),'completed');assert.equal(x.calls(),1);assert.equal(x.writes(),1);
      assert.equal(x.jobs[0].archived,false);assert.equal(await consumeAnalysisOnce(x.worker),'completed');
      assert.equal(x.calls(),1);assert.equal(x.writes(),1);assert.equal(x.jobs[0].archived,true);
    }
  }
});
test('fault adapter refuses nonfixture ports; safe error codes exclude message and unknown values',async()=>{
  const x=asyncFixture();await assert.rejects(consumeFixture({...x.worker,fixture:false},'before-read'));
  assert.equal(safeCode({code:'42501',message:'SENSITIVE'}),'42501');
  assert.equal(safeCode({code:'SENSITIVE_VALUE',message:'SENSITIVE'}),null);
});
