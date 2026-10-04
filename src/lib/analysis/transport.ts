/** Bounded single attempt including body; 499 prevents SDK retries after network loss. */
export function boundedAnalysisFetch(send:typeof fetch=fetch,ms=15000):typeof fetch {
  return async(input,init={})=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([(async()=>{
      const response=await send(input,{...init,signal:init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal});
      const body=await response.arrayBuffer();
      if(response.status>=500)return blocked();
      return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,headers:response.headers});
    })(),new Promise<Response>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(blocked());},ms);})]);
    }catch{return blocked();}finally{clearTimeout(timer);}
  };
}
function blocked(){return Response.json({code:'BOUNDED_TRANSPORT',message:'request result unavailable'},{status:499});}
