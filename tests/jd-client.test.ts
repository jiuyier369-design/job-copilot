import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJdClient, validJdResource, jdClientFailure } from '../src/lib/jd/client.ts';
import { settleJdState, jdPageUrl } from '../src/lib/jd/editor-state.ts';
import { confirmedAnalysisFixture } from './helpers/confirmed-analysis.ts';
const fixture=confirmedAnalysisFixture();
const response=(data: unknown,status=200)=>Response.json(data,{status});

test('JD client validates create/load and transport options, rejects controlled fields before fetch',async()=>{
 let calls=0;
 const client=createJdClient(async(url,options)=>{
  calls++;assert.equal(options?.credentials,'same-origin');assert.equal(options?.cache,'no-store');assert.equal(options?.redirect,'error');
  if(options?.method==='POST'){const input=JSON.parse(String(options.body));assert.deepEqual(Object.keys(input).sort(),['action','rawText']);}
  else assert.equal(url,`/api/jd-drafts?id=${fixture.initial.id}`);
  return response({ok:true,data:fixture.initial});
 });
 assert.equal((await client.execute({action:'create',rawText:fixture.initial.rawText})).ok,true);
 assert.equal((await client.load(fixture.initial.id)).ok,true);
 assert.equal((await client.execute({action:'create',rawText:'test',userId:'forged'} as any)).ok,false);
 assert.equal((await client.load('')).ok,false);assert.equal(calls,2);
});
test('JD client rejects bad JSON, forged shape, coverage, confirmation digest and mismatched success',async()=>{
 assert.equal(await validJdResource(fixture.draft),true);
 for(const bad of [{...fixture.initial,userId:'forged'}, {...fixture.initial,segments:[]}, {...fixture.draft,confirmation:{...fixture.draft.confirmation,digest:'a'.repeat(64)}},null]){
  const client=createJdClient(async()=>response({ok:true,data:bad}));assert.deepEqual(await client.load(fixture.initial.id),jdClientFailure());
 }
 assert.deepEqual(await createJdClient(async()=>new Response('{')).load(fixture.initial.id),jdClientFailure());
 assert.deepEqual(await createJdClient(async()=>response({ok:true,data:fixture.draft})).execute({action:'create',rawText:fixture.initial.rawText}),jdClientFailure());
});
test('JD client recognizes frozen status/code pairs only and never trusts server messages',async()=>{
 for(const [status,code] of [[401,'UNAUTHENTICATED'],[404,'NOT_FOUND'],[409,'JD_DRAFT_CONFLICT'],[503,'SERVICE_UNAVAILABLE']] as const){
  let calls=0;const client=createJdClient(async()=>{calls++;return response({ok:false,error:{code,message:'unsafe'}},status);});
  assert.deepEqual(await client.execute({action:'create',rawText:'test'}),jdClientFailure(code));assert.equal(calls,1);
 }
 assert.deepEqual(await createJdClient(async()=>response({ok:false,error:{code:'NOT_FOUND'}},503)).load(fixture.initial.id),jdClientFailure());
});
test('JD request timeout aborts once, including an unresponsive transport, without retry',async()=>{
 let calls=0,signal: AbortSignal|undefined;
 const client=createJdClient(async(_url,options)=>{calls++;signal=options?.signal as AbortSignal;return new Promise<Response>(()=>{});},10);
 assert.deepEqual(await client.execute({action:'create',rawText:'test'}),jdClientFailure());assert.equal(calls,1);assert.equal(signal?.aborted,true);
});
test('URL create refresh/delete and recovery preserve unsaved edits on conflict/read failure',()=>{
 const state={draft:fixture.initial,rawText:'unsaved text',edited:true};
 assert.equal(settleJdState(state,jdClientFailure('JD_DRAFT_CONFLICT'),false),state);
 assert.equal(settleJdState(state,jdClientFailure(),true),state);
 const url=jdPageUrl('http://localhost/jd-review?other=1',fixture.initial);
 assert.equal(new URL(url,'http://localhost').searchParams.get('draft'),fixture.initial.id);
 assert.equal(jdPageUrl('http://localhost'+url,null),'/jd-review?other=1');
 assert.deepEqual(settleJdState(state,{ok:true,data:fixture.draft},true),{draft:fixture.draft,rawText:fixture.draft.rawText,edited:false});
 assert.deepEqual(settleJdState(state,{ok:true,data:null},true),{draft:null,rawText:'',edited:false});
});
test('demo route remains bound to memory adapter, not real client',()=>{
 const source=readFileSync('src/app/(app)/jd-review-demo/page.tsx','utf8');
 assert.ok(source.includes('createJdDemoAdapter'));assert.ok(!source.includes('createJdClient'));
});
