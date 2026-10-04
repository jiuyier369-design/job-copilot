import { boundedAnalysisFetch } from './transport.ts';
import type { RunReservation } from './runs.ts';
import type { WorkerQueue,QueueMessage,WorkerContext } from './worker.ts';
import { parseAnalysisRequest } from './pipeline.ts';
import { checkAnalysisError,analysisRunResource } from './repository.ts';
import { unavailable } from '../api/http.ts';
import { contentOf,validateContent } from '../jd/content.ts';
import { profileSchema } from '../report/schema.ts';
export type ControlledRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
/** No query/table API or queue-name parameter exposed. Privileged RPCs only. */
export function analysisQueueRepository(rpc:ControlledRpc,usdToCny=8){
  function run(value:unknown,m:QueueMessage){return analysisRunResource(value,m.userId,m.requestId);}
  const queue:WorkerQueue={
    async read(){
      const value=await rpc('read_analysis_job_message',{}) as {messageId:number;message:Omit<QueueMessage,'messageId'>}|null;
      if(value===null)return null;
      const m=value?.message;
      if(!Number.isSafeInteger(value?.messageId)||value.messageId<1||!m
        ||Object.keys(m).sort().join(',')!=='draftRevision,profileVersion,requestId,runId,userId'
        ||![m.userId,m.runId,m.requestId].every(uuid)
        ||![m.draftRevision,m.profileVersion].every(n=>Number.isSafeInteger(n)&&n>0))throw unavailable();
      return {messageId:value.messageId,...m};
    },
    async claim(m){
      const c=await rpc('claim_analysis_job',{p_message_id:m.messageId}) as {mode:string;token:string|null;run:unknown};
      if(!c||!['acquired','busy','terminal'].includes(c.mode)||c.mode==='acquired'&&!uuid(c.token))throw unavailable();
      const record=run(c.run,m);if(record.id!==m.runId)throw unavailable();
      return {mode:c.mode as 'acquired'|'busy'|'terminal',token:c.token,run:record};
    },
    async context(m,token){
      const value=await rpc('read_analysis_worker_context',{p_run_id:m.runId,p_claim_token:token}) as {
        run:Record<string,unknown>;draft:WorkerContext['draft'];profile:WorkerContext['profile']};
      if(!value)throw unavailable();const raw=value.run,record=run(raw,m);
      if(record.id!==m.runId)throw unavailable();
      const stored=raw.request_context as {job:object;metadata:WorkerContext['metadata']};
      const request=parseAnalysisRequest({...stored.job,requestId:record.requestId,draftId:raw.draft_id,
        expectedDraftRevision:raw.expected_draft_revision,expectedProfileVersion:raw.expected_profile_version});
      // Owner is filtered in the definer context RPC; JdDraft intentionally has no owner field.
      if(value.draft?.id!==request.draftId)throw unavailable();
      validateContent(contentOf(value.draft));
      const errors:string[]=[];profileSchema(value.profile?.profile,'profile',errors);
      if(errors.length||!Number.isSafeInteger(value.profile?.version)||value.profile.version<1
        ||!Number.isFinite(Date.parse(value.profile.updatedAt)))throw unavailable();
      if(new Set(value.profile.profile.facts.map(f=>f.factId)).size!==value.profile.profile.facts.length)throw unavailable();
      return {userId:m.userId,request,metadata:stored.metadata,run:record,draft:value.draft,profile:value.profile};
    },
    async start(m,token,upper){const ok=await rpc('start_analysis_job_model',{p_run_id:m.runId,p_claim_token:token,p_upper_cny:upper});
      if(typeof ok!=='boolean')throw unavailable();return ok;},
    async complete(m,token,input){return run(await rpc('complete_queued_analysis',{p_run_id:m.runId,p_claim_token:token,
      p_expected_jd_snapshot:input.jdSnapshot,p_jd_items:input.jdItems,p_report:input.report}),m);},
    async finish(m,token,status,code){return run(await rpc('finish_queued_analysis',{p_run_id:m.runId,p_claim_token:token,p_status:status,p_failure_code:code}),m);},
    async archive(m){const ok=await rpc('archive_analysis_job_message',{p_message_id:m.messageId});if(typeof ok!=='boolean')throw unavailable();},
    async metrics(m,token,event){await rpc('record_analysis_job_usage',{p_run_id:m.runId,p_claim_token:token,p_metrics:event?
      {...event,usdToCny,estimatedCny:event.estimatedUsd===null?null:event.estimatedUsd*usdToCny,cnyEstimateBasis:'configured-upper'}:null});},
  };
  return {...queue,async enqueue({userId,request:r,fingerprint,digest,metadata}:RunReservation){
    const {company,jobTitle,city,direction,jdSourceUrl}=r;
    const data=await rpc('enqueue_analysis_run',{p_user_id:userId,p_request_id:r.requestId,p_fingerprint:fingerprint,
      p_draft_id:r.draftId,p_draft_revision:r.expectedDraftRevision,p_profile_version:r.expectedProfileVersion,p_digest:digest,
      p_context:{job:{company,jobTitle,city,direction,jdSourceUrl},metadata}}) as {acquired:boolean;run:unknown};
    if(!data||typeof data.acquired!=='boolean')throw unavailable();
    return {acquired:data.acquired,run:analysisRunResource(data.run,userId,r.requestId)};
  }};
}
/** Server-only. Admission retains 8s; Worker uses 4s to reserve terminal cleanup time. Zero retries. */
export function workerRpc(url:string,key:string,signal?:AbortSignal,send:typeof fetch=fetch,timeoutMs=8000):ControlledRpc{
  if(!key||!url.startsWith('https://')||new URL(url).pathname!=='/'
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>8000)throw unavailable();
  const bounded=boundedAnalysisFetch(send,timeoutMs);
  return async(name,args)=>{
    const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    try{
      const response=await bounded(`${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',redirect:'error',cache:'no-store',
        headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify(args),signal:combined});
      // PostgREST void RPC success has no JSON body. Other statuses retain strict JSON validation.
      if(response.ok&&response.status===204)return null;
      const value=await response.json();
      if(!response.ok){checkAnalysisError(value);throw unavailable();}return value;
    }catch(error){
      // Preserve only internally mapped safety classes, never provider response text.
      if(error instanceof Error&&['ApiError','JdError','ModelRejected'].includes(error.constructor.name))throw error;
      throw unavailable();
    }
  };
}
