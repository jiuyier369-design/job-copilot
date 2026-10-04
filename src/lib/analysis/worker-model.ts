import { createDeepSeekModel,deepSeekMetadata } from './deepseek.ts';
import type { DeepSeekEnvironment } from './deepseek.ts';
import { deepSeekPreflight } from './deepseek-prompt.ts';
import { type DeepSeekCallEvent } from './deepseek-metrics.ts';
import { createFixtureModel,fixtureMetadata } from './fixture.ts';
import { unavailable } from '../api/http.ts';
import { workerConfiguration,type WorkerEnvironment } from './async-config.ts';
import type { A2DiagnosticLog } from '../report/diagnostics.ts';
export function createWorkerModel(env:DeepSeekEnvironment&WorkerEnvironment&{NODE_ENV?:string;ENABLE_ANALYSIS_FIXTURE?:string},send:typeof fetch,a2Log?:A2DiagnosticLog){
  const config=workerConfiguration(env);
  if(env.ENABLE_ANALYSIS_FIXTURE==='true'&&env.ENABLE_DEEPSEEK==='true')throw unavailable();
  if(env.ENABLE_ANALYSIS_FIXTURE==='true'){
    // Both nonproduction and explicit fixture enablement remain mandatory. No fallback.
    const model=createFixtureModel({...env,ANALYSIS_MODEL_TIMEOUT_MS:'5000'});
    return {model:model.generate,metadata:fixtureMetadata,preflight:deepSeekPreflight,config,
      fixture:true,metrics:()=>null,calls:model.calls};
  }
  let last:DeepSeekCallEvent|null=null;
  const model=createDeepSeekModel({...env,DEEPSEEK_MAX_OUTPUT_TOKENS:String(config.maxOutputTokens),DEEPSEEK_TIMEOUT_MS:String(config.modelTimeoutMs)},send,event=>{last=event;},true,a2Log);
  return {model:model.generate,metadata:deepSeekMetadata,preflight:deepSeekPreflight,config,fixture:false,metrics:()=>last};
}
