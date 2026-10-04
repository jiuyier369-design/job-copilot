import assert from 'node:assert/strict';

const steps=new Set(['locator-counts','input-located','input-filled','query-idle','route-installed','query-clicked',
  'response-received','error-title','input-retained','login-entry','route-removed','real-query-clicked','real-response','state-restored','cleanup-route']);
/** Test-only diagnostics. Fixed names/booleans/counts; never raw Playwright errors or values. */
export function queryDiagnostic(log=console.log){
  return async(scenario,step,run)=>{
    assert.ok([401,404,503].includes(scenario)&&steps.has(step));const started=Date.now();
    const emit=(state,details={})=>{
      const safe={scenario,step,state,elapsedMs:Date.now()-started};
      for(const key of ['legacyCount','accessibleCount','intercepts','requests','httpStatus','completed']){
        const value=details[key];if(typeof value==='boolean'||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1000))safe[key]=value;
      }
      if(['timeout','assertion','unexpected'].includes(details.errorType))safe.errorType=details.errorType;
      log(JSON.stringify(safe));
    };
    emit('start');
    try{const result=await run();emit('complete',result);return result;}
    catch(error){emit('failed',{errorType:error?.name==='TimeoutError'?'timeout':error?.code==='ERR_ASSERTION'?'assertion':'unexpected'});throw error;}
  };
}
async function queryIdle(page){
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='查询当前状态'&&!b.disabled),undefined,{timeout:15000});
}
async function title(page,text){await page.getByText(text,{exact:true}).first().waitFor({state:'visible',timeout:15000});}
/** No navigation, account creation, generation, polling, or retry. Caller owns finally cleanup. */
export async function inspectQueryErrors(page,{selectorMode='accessible',log=console.log}={}){
  const diagnostic=queryDiagnostic(log);
  const target=new URL(page.url());const requestId=target.searchParams.get('requestId');assert.ok(requestId);
  const endpoint=new URL(`/api/analysis-runs/${encodeURIComponent(requestId)}`,target.origin).href;
  const company=selectorMode==='legacy'?page.getByLabel('公司',{exact:true}):page.getByRole('textbox',{name:'公司',exact:true});
  const query=page.getByRole('button',{name:'查询当前状态',exact:true});
  let requests=0;
  const observe=request=>{if(request.url()===endpoint&&request.method()==='GET')requests++;};
  page.on('request',observe);
  try{
    for(const [scenario,code]of [[401,'UNAUTHENTICATED'],[404,'NOT_FOUND'],[503,'SERVICE_UNAVAILABLE']]){
      let intercepts=0,installed=false;
      const handler=async route=>{intercepts++;await route.fulfill({status:scenario,contentType:'application/json',body:JSON.stringify({ok:false,error:{code,message:'must-not-display'}})});};
      try{
        await diagnostic(scenario,'locator-counts',async()=>({legacyCount:await page.getByLabel('公司',{exact:true}).count(),accessibleCount:await page.getByRole('textbox',{name:'公司',exact:true}).count()}));
        await diagnostic(scenario,'input-located',async()=>{await company.waitFor({state:'visible',timeout:15000});assert.equal(await company.count(),1);return {completed:true};});
        await diagnostic(scenario,'input-filled',async()=>{await company.fill('未提交虚构输入');return {completed:true};});
        await diagnostic(scenario,'query-idle',async()=>{await queryIdle(page);return {completed:true};});
        await diagnostic(scenario,'route-installed',async()=>{await page.route(endpoint,handler);installed=true;return {completed:true};});
        let response;const before=requests;
        await diagnostic(scenario,'query-clicked',async()=>{
          const received=page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='GET',{timeout:15000});
          // Consume the listener promise on click failure; never leave an unhandled rejection.
          try{await query.click();response=await received;}catch(error){received.catch(()=>{});throw error;}
          return {completed:true,requests:requests-before,intercepts};
        });
        await diagnostic(scenario,'response-received',async()=>{assert.equal(response.status(),scenario);assert.equal(intercepts,1);assert.equal(requests-before,1);await response.finished();return {httpStatus:response.status(),intercepts,requests:requests-before};});
        await diagnostic(scenario,'error-title',async()=>{await title(page,'暂时无法读取状态');await queryIdle(page);return {completed:true};});
        await diagnostic(scenario,'input-retained',async()=>{assert.equal(await company.inputValue(),'未提交虚构输入');assert.equal(await page.getByRole('button',{name:'查看报告',exact:true}).count(),0);assert.ok(!(await page.locator('body').innerText()).includes('must-not-display'));return {completed:true};});
        await diagnostic(scenario,'login-entry',async()=>{const login=page.getByRole('link',{name:'在新标签页登录，然后主动查询状态',exact:true});if(scenario===401)assert.equal(await login.getAttribute('target'),'_blank');else assert.equal(await login.count(),0);return {completed:true};});
        await diagnostic(scenario,'route-removed',async()=>{await page.unroute(endpoint,handler);installed=false;return {completed:true,intercepts};});
        const previous=intercepts,priorRequests=requests;
        await diagnostic(scenario,'real-query-clicked',async()=>{
          const received=page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='GET',{timeout:15000});
          try{await query.click();response=await received;}catch(error){received.catch(()=>{});throw error;}
          return {completed:true,requests:requests-priorRequests,intercepts};
        });
        await diagnostic(scenario,'real-response',async()=>{
          assert.equal(response.status(),200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.data.status,'uncertain');
          assert.equal(result.data.requestId,requestId);assert.equal(requests-priorRequests,1);assert.equal(intercepts,previous);
          return {httpStatus:200,requests:requests-priorRequests,intercepts};
        });
        await diagnostic(scenario,'state-restored',async()=>{await title(page,'结果无法确定');await queryIdle(page);assert.equal(await company.inputValue(),'未提交虚构输入');return {completed:true};});
      }finally{
        if(installed)await diagnostic(scenario,'cleanup-route',async()=>{await page.unroute(endpoint,handler);installed=false;return {completed:true};});
      }
    }
  }finally{page.off('request',observe);}
}
