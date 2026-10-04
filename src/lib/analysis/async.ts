import type { AnalysisRunResource } from '../../types/api.ts';
import { ApiError,readJson,respond,success } from '../api/http.ts';
import { JdError } from '../jd/content.ts';
import { prepareConfirmedAnalysis } from '../jd/generation-context.ts';
import { parseAnalysisRequest } from './pipeline.ts';
import { publicRun,requestFingerprint,type GenerationPorts,type RunReservation,type InternalRun } from './runs.ts';
export interface AdmissionPorts extends Pick<GenerationPorts,'runs'|'drafts'|'loadProfile'|'metadata'|'preflight'> {
  enqueue:(input:RunReservation)=>Promise<{acquired:boolean;run:InternalRun}>;
  checkBudget?:(input:{instruction:string;data:string})=>void;
}
/** No model function or fetch exists at this boundary. Atomic reserve+send is a single database RPC. */
export async function enqueueAnalysis(userId:string,input:unknown,ports:AdmissionPorts):Promise<AnalysisRunResource>{
  const request=parseAnalysisRequest(input),metadata=structuredClone(ports.metadata);
  const existing=await ports.runs.load(userId,request.requestId);
  if(existing){
    if(existing.fingerprint!==requestFingerprint(userId,request,existing.digest,metadata))
      throw new ApiError(409,'IDEMPOTENCY_CONFLICT','请求编号已用于不同分析。');
    return publicRun(existing);
  }
  const context=await prepareConfirmedAnalysis(userId,request,ports.drafts,ports.loadProfile);
  ports.preflight?.(context);ports.checkBudget?.(context.modelInput);
  const digest=context.jdSnapshot.confirmation!.digest;
  return publicRun((await ports.enqueue({userId,request,digest,metadata,
    fingerprint:requestFingerprint(userId,request,digest,metadata)})).run);
}
export function asyncAnalysisPost(session:()=>Promise<{userId:string}>,ports:()=>AdmissionPorts){
  return (request:Request)=>respond(async()=>{
    const input=await readJson(request),{userId}=await session();
    let run:AnalysisRunResource;
    try{run=await enqueueAnalysis(userId,input,ports());}catch(error){
      if(error instanceof JdError)throw new ApiError(error.code==='NOT_FOUND'?404:error.code==='INVALID_INPUT'?422:409,error.code,'请重新核对草稿状态和版本。');
      throw error;
    }
    return run.status==='processing'?Response.json({ok:true,data:run,code:'ANALYSIS_IN_PROGRESS'},
      {status:202,headers:{'Cache-Control':'private, no-store'}}):success(run);
  });
}
