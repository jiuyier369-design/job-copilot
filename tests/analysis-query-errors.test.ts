import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectQueryErrors,queryDiagnostic } from '../scripts/analysis-query-errors.mjs';

function fakePage({failTitle=false}={}){
  const events:Record<string,Function>={},actions:string[]=[],removals:Function[]=[];
  const endpoint='http://localhost:3000/api/analysis-runs/11111111-1111-4111-8111-111111111111';
  let handler:Function|null=null,responseListener:Function|null=null,field='',state=200;
  const timeout=()=>Object.assign(new Error('SENSITIVE_INPUT_VALUE'),{name:'TimeoutError'});
  function locator(kind:string){return {
    count:async()=>kind==='legacy'?0:kind==='report'?0:kind==='login'?(state===401?1:0):1,
    waitFor:async()=>{if(kind==='legacy'||(kind==='error'&&failTitle))throw timeout();},
    fill:async(value:string)=>{field=value;actions.push('fill');},inputValue:async()=>field,
    getAttribute:async()=>state===401?'_blank':null,innerText:async()=>'safe',first(){return this;},
    click:async()=>{
      actions.push(handler?'mock-click':'real-click');events.request?.({url:()=>endpoint,method:()=>'GET'});
      if(handler)await handler({fulfill:async({status}:{status:number})=>{state=status;}});else state=200;
      responseListener?.({url:()=>endpoint,request:()=>({method:()=>'GET'}),status:()=>state,finished:async()=>{},
        json:async()=>({ok:true,data:{status:'uncertain',requestId:endpoint.split('/').at(-1)}})});
    },
  };}
  const page={
    url:()=>`http://localhost:3000/analysis-run?requestId=${endpoint.split('/').at(-1)}`,
    getByLabel:()=>locator('legacy'),getByRole:(role:string,{name}:{name:string})=>locator(role==='textbox'?'accessible':name==='查看报告'?'report':role==='link'?'login':'query'),
    getByText:(name:string)=>locator(name==='暂时无法读取状态'?'error':'state'),locator:()=>locator('body'),
    on:(name:string,fn:Function)=>{events[name]=fn;},off:(name:string,fn:Function)=>{assert.equal(events[name],fn);delete events[name];},
    route:async(_path:string,fn:Function)=>{assert.equal(handler,null);handler=fn;actions.push('route');},
    unroute:async(_path:string,fn:Function)=>{assert.equal(handler,fn);removals.push(fn);handler=null;actions.push('unroute');},
    waitForResponse:()=>new Promise(resolve=>{responseListener=resolve;}),
    waitForFunction:async()=>{actions.push('idle');},
  };
  return {page,actions,removals,events,active:()=>handler};
}
test('legacy selector diagnosis identifies exact failing substep and stops before requests',async()=>{
  const f=fakePage(),logs:string[]=[];
  await assert.rejects(inspectQueryErrors(f.page,{selectorMode:'legacy',log:(line:string)=>logs.push(line)}));
  const records=logs.map(line=>JSON.parse(line));
  assert.ok(records.some(r=>r.step==='locator-counts'&&r.legacyCount===0&&r.accessibleCount===1));
  assert.ok(records.some(r=>r.step==='input-located'&&r.state==='failed'&&r.errorType==='timeout'));
  assert.ok(records.every(r=>r.scenario===401));assert.deepEqual(f.actions,[]);assert.deepEqual(f.events,{});
  assert.ok(!logs.join('').includes('SENSITIVE_INPUT_VALUE'));
});
test('accessible selector serializes all error/recovery requests and removes the exact handler each time',async()=>{
  const f=fakePage(),logs:string[]=[];
  await inspectQueryErrors(f.page,{selectorMode:'accessible',log:(line:string)=>logs.push(line)});
  assert.equal(f.removals.length,3);assert.equal(new Set(f.removals).size,3);assert.equal(f.active(),null);assert.deepEqual(f.events,{});
  assert.deepEqual(f.actions.filter(a=>a.includes('click')),['mock-click','real-click','mock-click','real-click','mock-click','real-click']);
  const records=logs.map(line=>JSON.parse(line));
  for(const scenario of [401,404,503]){
    assert.ok(records.some(r=>r.scenario===scenario&&r.step==='response-received'&&r.httpStatus===scenario&&r.intercepts===1&&r.requests===1));
    assert.ok(records.some(r=>r.scenario===scenario&&r.step==='real-response'&&r.httpStatus===200&&r.intercepts===1));
    assert.ok(records.some(r=>r.scenario===scenario&&r.step==='state-restored'&&r.completed));
  }
  assert.ok(!/未提交虚构输入|11111111|http:/.test(logs.join('')));
});
test('first unexpected failure stops remaining cases but still removes mock route and request observer',async()=>{
  const f=fakePage({failTitle:true}),logs:string[]=[];
  await assert.rejects(inspectQueryErrors(f.page,{selectorMode:'accessible',log:(line:string)=>logs.push(line)}));
  assert.equal(f.removals.length,1);assert.equal(f.active(),null);assert.deepEqual(f.events,{});
  assert.equal(f.actions.filter(a=>a==='real-click').length,0);
  assert.ok(logs.map(line=>JSON.parse(line)).every(r=>r.scenario===401));
});
test('diagnostic logger permits fixed numeric/boolean fields only, including on error',async()=>{
  const logs:string[]=[];const step=queryDiagnostic((line:string)=>logs.push(line));
  await step(401,'input-retained',async()=>({completed:true,userId:'SECRET_UUID',input:'SECRET_INPUT',rawError:'SECRET_ERROR',intercepts:1}));
  await assert.rejects(step(401,'query-clicked',async()=>{throw new Error('SECRET_KEY');}));
  assert.ok(!/SECRET|userId|rawError/.test(logs.join('')));
  assert.ok(logs.some(line=>JSON.parse(line).errorType==='unexpected'));
});
