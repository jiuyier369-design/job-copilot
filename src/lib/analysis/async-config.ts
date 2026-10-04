import { unavailable } from '../api/http.ts';
import { DEEPSEEK_RATES } from './deepseek-metrics.ts';
import { deepSeekPrompt } from './deepseek-prompt.ts';
export interface WorkerEnvironment {
  ANALYSIS_WORKER_MODEL_TIMEOUT_MS?:string; ANALYSIS_USD_TO_CNY?:string;
  ANALYSIS_MAX_CALL_CNY?:string; DEEPSEEK_MAX_OUTPUT_TOKENS?:string;
}
export const ASYNC_MAX_OUTPUT_TOKENS=8192;
// Late-complete failure includes a second metrics write, finish and archive (10 RPCs).
export const WORKER_MAX_RPC_REQUESTS=10;
export const WORKER_CPU_RESERVE_MS=2000;
/** Provisional background budget, independent of the synchronous 8000ms/HTTP 15000ms configuration. */
export function workerConfiguration(env:WorkerEnvironment){
  const raw=env.ANALYSIS_WORKER_MODEL_TIMEOUT_MS;
  if(!raw||!/^\d+$/.test(raw))throw unavailable();
  const modelTimeoutMs=Number(raw),usdToCny=Number(env.ANALYSIS_USD_TO_CNY),maxCallCny=Number(env.ANALYSIS_MAX_CALL_CNY);
  const output=env.DEEPSEEK_MAX_OUTPUT_TOKENS??'4096',maxOutputTokens=Number(output);
  if(!Number.isSafeInteger(modelTimeoutMs)||modelTimeoutMs<1000||modelTimeoutMs>45000
    ||!/^\d+$/.test(output)||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<256||maxOutputTokens>ASYNC_MAX_OUTPUT_TOKENS
    ||!Number.isFinite(usdToCny)||usdToCny<7||usdToCny>20
    ||!Number.isFinite(maxCallCny)||maxCallCny<=0||maxCallCny>1)throw unavailable();
  const rpcTimeoutMs=4000,totalTimeoutMs=90000;
  if(modelTimeoutMs+WORKER_MAX_RPC_REQUESTS*rpcTimeoutMs+WORKER_CPU_RESERVE_MS>=totalTimeoutMs)throw unavailable();
  return {modelTimeoutMs,usdToCny,maxCallCny,maxOutputTokens,visibilitySeconds:180,leaseSeconds:90,rpcTimeoutMs,totalTimeoutMs};
}
/** Conservative byte-BPE bound with 1024 framing allowance, no truncation or missing-usage fiction. */
export function workerCostBound(input:{instruction:string;data:string},config:ReturnType<typeof workerConfiguration>){
  const inputUpper=deepSeekPrompt(input).reduce((n,m)=>n+new TextEncoder().encode(m.content).byteLength,0)+1024;
  const upperCny=(inputUpper*DEEPSEEK_RATES.miss+config.maxOutputTokens*DEEPSEEK_RATES.output)/1e6*config.usdToCny;
  if(upperCny>config.maxCallCny)throw unavailable();
  return upperCny;
}
