import { unavailable } from '../api/http.ts';
import { edgeFixtureConfiguration,edgeFixtureModel } from './edge-fixture.ts';
import { consumeFixture } from './edge-fixture-faults.ts';
import { workerHttp } from './worker-http.ts';
import { workerRpc,analysisQueueRepository } from './queue-repository.ts';
import { createWorkerModel } from './worker-model.ts';
import { consumeAnalysisOnce,type WorkerPorts } from './worker.ts';
import { DeepSeekConfigurationError } from './deepseek-errors.ts';
import type { A2DiagnosticLog } from '../report/diagnostics.ts';

type Environment=(name:string)=>string|undefined;
export type EdgeSetupStage='worker-authenticated'|'worker-real-config'|'worker-model-client'|'worker-supabase-client'|'worker-queue-read';
export interface EdgeSetupEvent {stage:EdgeSetupStage;result:'passed'|'failed';elapsedMs:number;category:'PROVIDER_DISABLED'|'CONFIG_INVALID'|'KEY_NOT_CONFIGURED'|'SERVICE_UNAVAILABLE'|null}
export type EdgeSetupLog=(event:EdgeSetupEvent)=>void;
export const EDGE_TEST_URL='https://abcdefghijklmnopqrst.supabase.co';
export const EDGE_REAL_SETTINGS={ENABLE_DEEPSEEK:'true',MODEL_PROVIDER:'deepseek',MODEL_NAME:'deepseek-flash',
  MODEL_BASE_URL:'https://api.deepseek.com',DEEPSEEK_MAX_OUTPUT_TOKENS:'8192',
  ANALYSIS_WORKER_MODEL_TIMEOUT_MS:'45000',ANALYSIS_USD_TO_CNY:'8',ANALYSIS_MAX_CALL_CNY:'1'} as const;

/** Dedicated acceptance deployment. Modes are explicit and mutually exclusive; no provider fallback. */
export function edgeRealConfiguration(get:Environment){
  if(get('SUPABASE_URL')!==EDGE_TEST_URL||get('ENABLE_EDGE_DEEPSEEK')!=='true'||get('ENABLE_EDGE_FIXTURE')==='true')throw unavailable();
  for(const [name,value]of Object.entries(EDGE_REAL_SETTINGS))if(get(name)!==value)throw unavailable();
  let keys:unknown;try{keys=JSON.parse(get('SUPABASE_SECRET_KEYS')??'');}catch{throw unavailable();}
  const key=keys&&typeof keys==='object'&&!Array.isArray(keys)?(keys as Record<string,unknown>).default:null;
  if(typeof key!=='string'||!key.startsWith('sb_secret_'))throw unavailable();
  return {url:EDGE_TEST_URL,key,env:{...EDGE_REAL_SETTINGS,MODEL_API_KEY:get('MODEL_API_KEY'),
    NODE_ENV:'production',ENABLE_ANALYSIS_FIXTURE:'false'}};
}
/** Auth check happens before configuration, queue RPCs and model transport. Private response is numeric only. */
export function edgeWorker(get:Environment,send:typeof fetch,log?:WorkerPorts['log'],diagnostic?:EdgeSetupLog,a2Log?:A2DiagnosticLog){
  const emit=(stage:EdgeSetupStage,result:EdgeSetupEvent['result'],started:number,error?:unknown)=>{
    // Rebuild fixed fields only. Never forward exceptions, environment, credentials or RPC payloads.
    const category=error instanceof DeepSeekConfigurationError&&['PROVIDER_DISABLED','CONFIG_INVALID','KEY_NOT_CONFIGURED'].includes(error.category)
      ?error.category as Exclude<EdgeSetupEvent['category'],null|'SERVICE_UNAVAILABLE'>:error===undefined?null:'SERVICE_UNAVAILABLE';
    try{diagnostic?.({stage,result,elapsedMs:Math.max(0,Math.round(performance.now()-started)),category});}catch{}
  };
  async function step<T>(stage:EdgeSetupStage,fn:()=>T|Promise<T>):Promise<T>{
    const started=performance.now();try{const value=await fn();emit(stage,'passed',started);return value;}
    catch(error){emit(stage,'failed',started,error);throw error;}
  }
  const fixtureAllowed=get('ENABLE_EDGE_FIXTURE')==='true'&&get('ENABLE_EDGE_DEEPSEEK')!=='true';
  return workerHttp(get('JOB_COPILOT_WORKER_TOKEN'),async fault=>{
    emit('worker-authenticated','passed',performance.now());
    if(fixtureAllowed){
      const {url,key,config}=edgeFixtureConfiguration(get),model=edgeFixtureModel();
      const queue=analysisQueueRepository(workerRpc(url,key,AbortSignal.timeout(config.totalTimeoutMs),send,config.rpcTimeoutMs),config.usdToCny);
      const outcome=await consumeFixture({...model,config,queue,log},fault);
      return {outcome,fixtureCalls:model.calls()};
    }
    if(fault!==undefined)throw unavailable();
    const {url,key,env}=await step('worker-real-config',()=>edgeRealConfiguration(get));
    let calls=0;
    const total=AbortSignal.timeout(90000);
    const model=await step('worker-model-client',()=>createWorkerModel(env,(input,init)=>{
      calls++;return send(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,total]):total});
    },a2Log));
    const queue=await step('worker-supabase-client',()=>analysisQueueRepository(workerRpc(url,key,total,send,model.config.rpcTimeoutMs),model.config.usdToCny));
    const read=queue.read;queue.read=()=>step('worker-queue-read',()=>read());
    const outcome=await consumeAnalysisOnce({...model,queue,log});
    return {outcome,modelCalls:calls};
  },fixtureAllowed);
}
