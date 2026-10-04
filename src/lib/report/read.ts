import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, invalid, respond, success, unavailable } from '../api/http.ts';
import { analysisFromRow, reportColumns, validAnalysisId } from './resource.ts';

/** Client MUST be the authenticated session client (RLS), never an administrator. */
export function reportReadHandler(scope:()=>Promise<{userId:string;supabase:SupabaseClient}>){
  return (inputId:string)=>respond(async()=>{
    const {userId,supabase}=await scope();
    if(!validAnalysisId(inputId))throw invalid();
    const id=inputId.toLowerCase();
    const {data,error}=await supabase.from('job_analyses').select(reportColumns).eq('user_id',userId).eq('id',id).maybeSingle();
    if(error)throw unavailable();
    if(data===null)throw new ApiError(404,'NOT_FOUND','报告不存在、已删除或不属于当前账号。');
    const record=await analysisFromRow(data,userId,id);
    if(!record)throw unavailable();
    return success(record);
  });
}
