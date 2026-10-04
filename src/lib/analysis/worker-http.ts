import { edgeFixtureFaults,type EdgeFixtureFault } from './edge-fixture-faults.ts';
/** Private service-to-service endpoint. User JWT/userId cannot substitute for its independent secret. */
export function workerHttp(token:string|undefined,consume:(fault?:EdgeFixtureFault)=>Promise<string|{outcome:string;fixtureCalls:number}|{outcome:string;modelCalls:number}>,allowFixtureCommands=false){
  return async(request:Request)=>{
    const reply=(status:number,code:string)=>Response.json({ok:status===200,code},{status,headers:{'Cache-Control':'no-store'}});
    if(!token||token.length<32)return reply(503,'SERVICE_UNAVAILABLE');
    const supplied=request.headers.get('x-job-copilot-worker')??'';
    // Compare without early exit for matching-length secrets; never print or hash either value.
    const a=new TextEncoder().encode(token),b=new TextEncoder().encode(supplied);let difference=a.length^b.length;
    for(let i=0;i<a.length;i++)difference|=a[i]^(b[i]??0);
    if(difference!==0)return reply(401,'UNAUTHENTICATED');
    if(request.method!=='POST')return reply(405,'INVALID_INPUT');
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply(422,'INVALID_INPUT');
    try{
      if(Number(request.headers.get('content-length'))>1024)return reply(413,'INVALID_INPUT');
      const reader=request.body?.getReader();if(!reader)return reply(422,'INVALID_INPUT');
      const parts:Uint8Array[]=[];let size=0;
      try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
        if(size>1024){await reader.cancel();return reply(413,'INVALID_INPUT');}parts.push(next.value);}}
      finally{reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!body||Array.isArray(body)||typeof body!=='object')return reply(422,'INVALID_INPUT');
      const keys=Object.keys(body);
      if(keys.length!==0&&(!allowFixtureCommands||keys.length!==1||keys[0]!=='fixtureFault'
        ||!edgeFixtureFaults.includes(body.fixtureFault)))return reply(422,'INVALID_INPUT');
      const result=await consume(body.fixtureFault),outcome=typeof result==='string'?result:result.outcome;
      if(!['idle','processing','completed','failed','uncertain'].includes(outcome))return reply(503,'SERVICE_UNAVAILABLE');
      if(typeof result!=='string'){
        const field='fixtureCalls' in result?'fixtureCalls':'modelCalls';
        const calls='fixtureCalls' in result?result.fixtureCalls:result.modelCalls;
        if(typeof calls!=='number'||!Number.isSafeInteger(calls)||calls<0||calls>1)return reply(503,'SERVICE_UNAVAILABLE');
        return Response.json({ok:true,code:outcome,[field]:calls},{headers:{'Cache-Control':'no-store'}});
      }
      return reply(200,outcome);
    }catch{return reply(503,'SERVICE_UNAVAILABLE');}
  };
}
