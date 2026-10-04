import type { AnalysisRunResource } from '../../types/api.ts';
import type { JobAnalysisRecord } from '../../types/job-copilot.ts';
import { validAnalysisId, validAnalysisRecord } from '../report/resource.ts';

export type ReadErrorCode='INVALID_INPUT'|'UNAUTHENTICATED'|'NOT_FOUND'|'SERVICE_UNAVAILABLE';
export type ReadResult<T>={ok:true;data:T}|{ok:false;error:{code:ReadErrorCode;message:string}};
const messages:Record<ReadErrorCode,string>={
  INVALID_INPUT:'链接编号无效，请返回核对页面或使用有效链接。',
  UNAUTHENTICATED:'登录已失效，当前输入仍保留。请在新标签页登录后主动重新查询。',
  NOT_FOUND:'记录不存在、已删除或不属于当前账号。当前输入仍保留。',
  SERVICE_UNAVAILABLE:'暂时无法确认查询结果，当前输入仍保留。请主动重新查询，不要重复生成。',
};
export const readFailure=(code:ReadErrorCode='SERVICE_UNAVAILABLE')=>({ok:false as const,error:{code,message:messages[code]}});
const failed=['MODEL_REJECTED','REPORT_INVALID','JD_DRAFT_CONFLICT','PROFILE_VERSION_CONFLICT','JD_REVIEW_REQUIRED','NOT_FOUND','PROFILE_REQUIRED'];
export function validRunResource(value:unknown,id:string):value is AnalysisRunResource{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const r=value as AnalysisRunResource;
  if(Object.keys(r).sort().join(',')!=='analysisId,failureCode,finishedAt,requestId,startedAt,status'
    ||r.requestId!==id||!validAnalysisId(r.requestId)||typeof r.startedAt!=='string'||!Number.isFinite(Date.parse(r.startedAt)))return false;
  const finished=typeof r.finishedAt==='string'&&Number.isFinite(Date.parse(r.finishedAt));
  return r.status==='processing'?r.analysisId===null&&r.failureCode===null&&r.finishedAt===null
    :r.status==='completed'?validAnalysisId(r.analysisId)&&r.failureCode===null&&finished
    :r.status==='failed'?r.analysisId===null&&failed.includes(String(r.failureCode))&&finished
    :r.status==='uncertain'?r.analysisId===null&&['MODEL_RESULT_UNCERTAIN','SAVE_RESULT_UNCERTAIN'].includes(String(r.failureCode))&&finished:false;
}
/** Read-only: no POST, retry or polling. The deadline includes JSON and structural validation. */
export function createAnalysisReadClient(send:typeof fetch=fetch,timeoutMs=15000){
  async function request<T>(path:string,id:string,validate:(v:unknown)=>boolean|Promise<boolean>):Promise<ReadResult<T>>{
    if(!validAnalysisId(id))return readFailure('INVALID_INPUT');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([(async():Promise<ReadResult<T>>=>{
      const response=await send(`${path}/${encodeURIComponent(id)}`,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      const result=await response.json();
      if(response.status===200&&result?.ok===true&&Object.keys(result).sort().join(',')==='data,ok'){
        return await validate(result.data)?{ok:true,data:result.data}:readFailure();
      }
      const status:Record<ReadErrorCode,number>={INVALID_INPUT:422,UNAUTHENTICATED:401,NOT_FOUND:404,SERVICE_UNAVAILABLE:503};
      const code=result?.error?.code;
      return result?.ok===false&&typeof code==='string'&&Object.hasOwn(status,code)&&status[code as ReadErrorCode]===response.status
        ?readFailure(code as ReadErrorCode):readFailure();
    })(),new Promise<ReadResult<T>>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(readFailure());},timeoutMs);})]);
    }catch{return readFailure();}finally{clearTimeout(timer);}
  }
  return {loadRun:(id:string)=>{const key=id.toLowerCase();return request<AnalysisRunResource>('/api/analysis-runs',key,v=>validRunResource(v,key));},
    loadReport:(id:string)=>{const key=id.toLowerCase();return request<JobAnalysisRecord>('/api/analyses',key,async v=>await validAnalysisRecord(v)&&(v as JobAnalysisRecord).id===key);}};
}
