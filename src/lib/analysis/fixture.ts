import type { Report } from '../../types/job-copilot.ts';
import { unavailable } from '../api/http.ts';
import { ModelRejected, ModelUncertain } from './runs.ts';
export const fixtureMetadata={reportStructureVersion:'1.0.0' as const,promptVersion:'test-fixture-v1',
  modelProvider:'fixture',modelName:'deterministic-v1',testDataVersion:'synthetic-v1'};
export const syntheticAnalysisJd='岗位职责\n核对客户需求。\n任职要求\n本科毕业。\n公司介绍\n测试岗位。';
/** Complete existing synthetic report; no evidence is invented or promoted. */
export const fixtureReport:Report={
  materialFit:{level:'weak',summary:'尚缺任务证据。',supportingJdIds:[],limitingJdIds:['JD2']},
  applicationAction:{category:'try_with_weak_evidence',summary:'证据较弱，可由用户决定是否尝试。',verificationItemIndexes:[]},
  qualifications:[{jdId:'JD4',status:'needs_confirmation',factIds:[],explanation:'需核对毕业条件。'}],
  coreDuties:[{jdId:'JD2',evidenceType:'no_evidence',evidenceLinks:[],missingAspects:['缺少同类经历证据。'],needsUserConfirmation:true,explanation:'暂无证据。'}],
  preferredItems:[],inferences:[],resumeSuggestions:[],verificationItems:[],
};
export function fixtureModelTimeoutMs(env:{ANALYSIS_MODEL_TIMEOUT_MS?:string}):number {
  const raw=env.ANALYSIS_MODEL_TIMEOUT_MS;
  if(typeof raw!=='string'||!/^\d+$/.test(raw))throw unavailable();
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<1000||value>8000)throw unavailable();
  return value;
}
export function createFixtureModel(env:{NODE_ENV?:string;ENABLE_ANALYSIS_FIXTURE?:string;ANALYSIS_MODEL_TIMEOUT_MS?:string},onCall:()=>void=()=>{}){
  if(env.NODE_ENV==='production'||env.ENABLE_ANALYSIS_FIXTURE!=='true')throw unavailable();
  const modelTimeoutMs=fixtureModelTimeoutMs(env);
  let count=0;
  return {modelTimeoutMs,calls:()=>count,async generate(_input:{instruction:string;data:string},title:string,signal:AbortSignal):Promise<unknown>{
    count++;onCall();
    if(title==='fixture:rejected')throw new ModelRejected();
    if(title==='fixture:invalid')return {...structuredClone(fixtureReport),coreDuties:[]};
    if(title==='fixture:timeout')return new Promise((_,reject)=>{
      if(signal.aborted)reject(new ModelUncertain());else signal.addEventListener('abort',()=>reject(new ModelUncertain()),{once:true});
    });
    if(title==='fixture:delayed')await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1500);
      const abort=()=>{clearTimeout(timer);reject(new ModelUncertain());};
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    });
    return structuredClone(fixtureReport);
  }};
}
