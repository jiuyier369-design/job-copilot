import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisFailureCode } from '../../types/api.ts';
import { ApiError, unavailable } from '../api/http.ts';
import { ModelRejected } from './runs.ts';
import { JdError } from '../jd/content.ts';
import type { InternalRun, RunRepository } from './runs.ts';
export function checkAnalysisError(error:{code?:string;message?:string}|null){
  if(!error)return;
  if(error.code==='23514'&&error.message==='MODEL_REJECTED')throw new ModelRejected();
  if(error.code==='PT409'||error.code==='40001'){
    if(error.message==='PROFILE_VERSION_CONFLICT')throw new ApiError(409,'PROFILE_VERSION_CONFLICT','画像已更新，本次结果未保存。');
    if(error.message==='JD_DRAFT_CONFLICT')throw new JdError('JD_DRAFT_CONFLICT');
    if(error.message==='IDEMPOTENCY_CONFLICT')throw new ApiError(409,'IDEMPOTENCY_CONFLICT','请求编号已用于不同分析。');
  }
  if(error.code==='P0002'&&error.message==='NOT_FOUND')throw new JdError('NOT_FOUND');
  if(error.code==='P0002'&&error.message==='PROFILE_REQUIRED')throw new ApiError(409,'PROFILE_REQUIRED','请先保存画像。');
  if(error.code==='23514'&&error.message==='JD_REVIEW_REQUIRED')throw new JdError('JD_REVIEW_REQUIRED');
  throw unavailable();
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const failed=['MODEL_REJECTED','REPORT_INVALID','JD_DRAFT_CONFLICT','PROFILE_VERSION_CONFLICT','JD_REVIEW_REQUIRED','NOT_FOUND','PROFILE_REQUIRED'];
export function analysisRunResource(value:unknown,userId:string,requestId:string):InternalRun{
  if(!value||typeof value!=='object')throw unavailable();
  const r=value as Record<string,unknown>;
  if(r.user_id!==userId||r.request_id!==requestId||!uuid(r.id)||!uuid(r.request_id)
    ||typeof r.request_fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(r.request_fingerprint)
    ||typeof r.confirmation_digest!=='string'||!/^[a-f0-9]{64}$/.test(r.confirmation_digest)
    ||typeof r.started_at!=='string'||!Number.isFinite(Date.parse(r.started_at)))throw unavailable();
  const finished=typeof r.finished_at==='string'&&Number.isFinite(Date.parse(r.finished_at));
  const valid=r.status==='processing'?r.analysis_id===null&&r.failure_code===null&&r.finished_at===null
    :r.status==='completed'?uuid(r.analysis_id)&&r.failure_code===null&&finished
    :r.status==='failed'?r.analysis_id===null&&failed.includes(String(r.failure_code))&&finished
    :r.status==='uncertain'?r.analysis_id===null&&['MODEL_RESULT_UNCERTAIN','SAVE_RESULT_UNCERTAIN'].includes(String(r.failure_code))&&finished:false;
  if(!valid)throw unavailable();
  return {id:r.id,requestId:r.request_id,fingerprint:r.request_fingerprint,digest:r.confirmation_digest,
    status:r.status as InternalRun['status'],analysisId:r.analysis_id as string|null,failureCode:r.failure_code as AnalysisFailureCode|null,
    startedAt:r.started_at,finishedAt:r.finished_at as string|null};
}
/** Privileged client with bounded transport. Never insert reports/runs directly. */
export function analysisRepository(client:SupabaseClient):RunRepository{
  async function rpc(name:string,args:Record<string,unknown>){
    const {data,error}=await client.rpc(name,args);checkAnalysisError(error);return data;
  }
  return {
    async load(userId,requestId){const d=await rpc('read_analysis_run',{p_user_id:userId,p_request_id:requestId});return d===null?null:analysisRunResource(d,userId,requestId);},
    async reserve({userId,request:r,fingerprint,digest,metadata}){
      const {company,jobTitle,city,direction,jdSourceUrl}=r;
      const data=await rpc('reserve_analysis_run',{p_user_id:userId,p_request_id:r.requestId,p_fingerprint:fingerprint,
        p_draft_id:r.draftId,p_draft_revision:r.expectedDraftRevision,p_profile_version:r.expectedProfileVersion,p_digest:digest,
        p_context:{job:{company,jobTitle,city,direction,jdSourceUrl},metadata}});
      if(!data||typeof data.acquired!=='boolean')throw unavailable();
      return {acquired:data.acquired,run:analysisRunResource(data.run,userId,r.requestId)};
    },
    async complete(userId,requestId,input){return analysisRunResource(await rpc('complete_analysis_run',{p_user_id:userId,p_request_id:requestId,
      p_expected_jd_snapshot:input.jdSnapshot,p_jd_items:input.jdItems,p_report:input.report}),userId,requestId);},
    async finish(userId,requestId,status,code){return analysisRunResource(await rpc('finish_analysis_run',{p_user_id:userId,p_request_id:requestId,
      p_status:status,p_failure_code:code}),userId,requestId);},
  };
}
