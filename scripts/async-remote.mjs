// Dedicated project only. Callers choose fixed internal SQL; outputs must be allowlisted aggregates.
export const TEST_REF='abcdefghijklmnopqrst';
export async function management(path,{method='GET',body}={},env=process.env){
  if(env.SUPABASE_PROJECT_REF!==TEST_REF||env.TEST_SUPABASE_URL!==`https://${TEST_REF}.supabase.co`||!env.SUPABASE_ACCESS_TOKEN)throw Error('CONFIG_INVALID');
  const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_REF}${path}`,{
    method,headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error',
  });
  if(!response.ok){const error=Error('MANAGEMENT_FAILED');error.status=response.status;throw error;}
  if(response.status===204)return null;return response.json();
}
export async function query(sql,readOnly=true){
  return management('/database/query',{method:'POST',body:{query:sql,read_only:readOnly}});
}
export const SIX=['20260928000100','20260928000200','20260929000100','20260929000200','20260930000100','20260930000200'];
export const RPCS=['enqueue_analysis_run','read_analysis_job_message','claim_analysis_job','read_analysis_worker_context',
  'start_analysis_job_model','finish_queued_analysis','complete_queued_analysis','record_analysis_job_usage','archive_analysis_job_message','purge_analysis_job_message'];
