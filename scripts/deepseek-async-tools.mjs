import assert from 'node:assert/strict';

const stages=new Set(['local-gates','remote-baseline','memory-token','configure-real','edge-deploy','auth-regression',
  'local-server','seed','admission','automatic-completion','usage','quality','quality-review','replay','stop','drain',
  'disable-real','cleanup-users','cleanup-local','final','observing','result']);
const strings=new Set(['start','passed','stopped','processing','completed','failed','uncertain','idle','stop','length',
  'product','customer-success','solutions','deepseek','deepseek-flash','job-copilot-deepseek-v1','job-copilot-deepseek-v1.1','job-copilot-deepseek-v1.2','job-copilot-deepseek-v1.3','job-copilot-deepseek-v1.4','1.0.0','valid',
  'MODEL_TIMEOUT','NETWORK_FAILED','AUTH_FAILED','QUOTA_EXCEEDED','RATE_LIMITED','UPSTREAM_5XX','UPSTREAM_REJECTED',
  'OUTPUT_TRUNCATED','EMPTY_CONTENT','JSON_INVALID','REPORT_STRUCTURE_INVALID','A2_INVALID','REPORT_INVALID',
  'MODEL_RESULT_UNCERTAIN','SAVE_RESULT_UNCERTAIN','MODEL_REJECTED','SERVICE_UNAVAILABLE','ACTIVE','UNKNOWN',
  'schema-A2-and-Codex-review-pass','Codex-review-rejected','Codex-review-pending','not-evaluated','NOT_FOUND','UNAUTHENTICATED','INVALID_INPUT',
  'JD_DRAFT_CONFLICT','PROFILE_VERSION_CONFLICT','IDEMPOTENCY_CONFLICT']);
const numeric=new Set(['elapsedMs','httpStatus','exitCode','modelCalls','calls','upperCny','knownCny','unknownReservedCny',
  'totalReservedCny','inputUpper','inputTokens','outputTokens','totalTokens','networkMs','validationMs','version','bundleBytes',
  'postToCompletedMs','newJobs','newMessages','newReports','newCalls','scheduled','succeeded','received','pending','inFlight',
  'accounts','profiles','jd_drafts','job_analyses','applications','analysis_runs','processing','jobs','active','archived']);
const boolean=new Set(['passed','cleanupPassed','json','type','a2','saved','modelKeyAbsent','fixtureDisabled','realDisabled',
  'portFree','cronInactive','noApiKeyInBrowser','usageValid','reportRead','autoSecretsUsable','noRawOutputLogged']);
const nested=new Set(['records','outcomes','counts','metrics']);
const field=(o,k)=>o&&typeof o==='object'?Object.getOwnPropertyDescriptor(o,k)?.value:undefined;
export function safeDeepSeekAcceptance(input){
  const clean={};if(!input||typeof input!=='object')return clean;
  for(const key of Object.keys(input)){
    const v=field(input,key);
    if(key==='stage'){if(stages.has(v))clean[key]=v;}
    else if(numeric.has(key)){if(v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0)clean[key]=v;}
    else if(boolean.has(key)){if(typeof v==='boolean')clean[key]=v;}
    else if(['state','scenario','provider','model','promptVersion','reportStructureVersion','finishReason','outcome','failureCode','quality','status','code'].includes(key)){
      if(v===null||strings.has(v))clean[key]=v;
    }else if(nested.has(key))clean[key]=Array.isArray(v)?v.map(safeDeepSeekAcceptance):safeDeepSeekAcceptance(v);
  }return clean;
}
export function qualityProjection(report,context,secrets=[]){
  // Derived prose only, not source materials/provider envelope. Delete transient review files in finally.
  const sources=[context.jdText,...context.profile.facts.map(f=>f.statement)];
  const redact=text=>{let s=String(text);for(const secret of secrets)if(secret)s=s.split(secret).join('[凭证已移除]');
    for(const source of sources)for(let start=0;start<=source.length-12;start++){
      const part=source.slice(start,start+12);if(s.includes(part))s=s.split(part).join('[来源引用]');}
    return s;};
  // Bounded source anchors, never the full JD/profile or provider envelope; IDs are frozen evidence IDs, not record UUIDs.
  const hint=(text,limit)=>{
    let value=String(text);for(const secret of secrets)if(secret)value=value.split(secret).join('[凭证已移除]');
    return value.slice(0,Math.min(limit,Math.max(0,value.length-1)))+'…';
  };
  return {requirements:context.jdItems.map(j=>({jdId:j.jdId,kind:j.kind,hint:hint(j.exactText,48)})),
    facts:context.profile.facts.map(f=>({factId:f.factId,category:f.category,context:f.context,hint:hint(f.statement,72)})),
    materialFit:redact(report.materialFit.summary),supportingJdIds:report.materialFit.supportingJdIds,limitingJdIds:report.materialFit.limitingJdIds,
    action:redact(report.applicationAction.summary),category:report.applicationAction.category,
    conditionalNextAction:report.applicationAction.conditionalNextAction?redact(report.applicationAction.conditionalNextAction):null,
    qualifications:report.qualifications.map(q=>({jdId:q.jdId,status:q.status,explanation:redact(q.explanation),factIds:q.factIds})),
    tasks:[...report.coreDuties,...report.preferredItems].map(d=>({jdId:d.jdId,type:d.evidenceType,explanation:redact(d.explanation),gaps:d.missingAspects.map(redact),
      needsUserConfirmation:d.needsUserConfirmation,
      links:d.evidenceLinks.map(e=>({type:e.evidenceType,factIds:e.factIds,contexts:e.factIds.map(id=>context.profile.facts.find(f=>f.factId===id).context),
        connection:redact(e.connection),boundary:redact(e.boundary)}))})),
    resume:report.resumeSuggestions.map(r=>({jdIds:r.jdIds,factIds:r.factIds,wording:redact(r.suggestedWording),boundary:redact(r.factualBoundary)})),
    verification:report.verificationItems.map(v=>({jdIds:v.jdIds,question:redact(v.question),reason:redact(v.reason),how:redact(v.askWhomOrHow),impacts:v.answerImpacts.map(redact)})),
    inference:report.inferences.map(i=>({jdIds:i.jdIds,statement:redact(i.statement),uncertainty:redact(i.uncertainty)}))};
}
export async function observeRealCron(pg,floor,name){
  const {rows:[r]}=await pg.query(`select
    (select count(*)::int from cron.job_run_details d join cron.job j using(jobid) where j.jobname=$1) as scheduled,
    (select count(*)::int from cron.job_run_details d join cron.job j using(jobid) where j.jobname=$1 and d.status='succeeded') as succeeded,
    (select count(*)::int from cron.job_run_details d join cron.job j using(jobid) where j.jobname=$1 and d.status='failed') as failed,
    (select count(*)::int from cron.job_run_details d join cron.job j using(jobid) where j.jobname=$1 and d.status not in ('succeeded','failed')) as inFlight,
    (select count(*)::int from net.http_request_queue where id>$2::bigint) as pending,
    (select count(*)::int from net._http_response where id>$2::bigint) as received,
    coalesce((select jsonb_agg(jsonb_build_object('httpStatus',status_code,'timedOut',coalesce(timed_out,false),
      'transportError',error_msg is not null,'code',case when status_code=200 then content::jsonb->>'code' else null end,
      'modelCalls',case when status_code=200 then content::jsonb->'modelCalls' else null end) order by id)
      from net._http_response where id>$2::bigint),'[]'::jsonb) as responses`,[name,floor]);
  assert.equal(r.failed,0,'CRON_SQL_FAILED');
  for(const x of r.responses){assert.equal(x.httpStatus,200,'CRON_HTTP_FAILED');assert.equal(x.timedOut,false);assert.equal(x.transportError,false);
    assert.ok(['idle','processing','completed','failed','uncertain'].includes(x.code));assert.ok(Number.isSafeInteger(x.modelCalls)&&x.modelCalls>=0&&x.modelCalls<=1);}
  return r;
}
