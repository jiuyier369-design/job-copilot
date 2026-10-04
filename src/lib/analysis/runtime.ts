import 'server-only';
import { requireUser } from '../auth/require-user';
import { createAdminClient } from '../supabase/admin';
import { profileRepository } from '../profile/repository';
import { jdRepository } from '../jd/repository';
import { analysisRepository,checkAnalysisError } from './repository';
import { boundedAnalysisFetch } from './transport';
import { analysisHandlers } from './handlers';
import { asyncAnalysisPost } from './async';
import { analysisQueueRepository } from './queue-repository';
import { workerConfiguration,workerCostBound } from './async-config';
import { deepSeekConfiguration,deepSeekMetadata } from './deepseek';
import { deepSeekPreflight } from './deepseek-prompt';
import { createFixtureModel,fixtureMetadata } from './fixture';
import { unavailable } from '../api/http';

/** Public generation only enqueues. No model transport or synchronous fallback exists here. */
export async function analysisRuntime(){
  let scope:Awaited<ReturnType<typeof requireUser>>;
  const transport=boundedAnalysisFetch(),client=createAdminClient(transport),runs=analysisRepository(client);
  const session=async()=>{scope=await requireUser(transport);return {userId:scope.userId,runs};};
  // Keep the existing GET behavior and envelope. The old synchronous factory is never called.
  const read=analysisHandlers(session,()=>{throw unavailable();});
  const queue=analysisQueueRepository(async(name,args)=>{const {data,error}=await client.rpc(name,args);checkAnalysisError(error);return data;});
  const POST=asyncAnalysisPost(session,()=>{
    if(process.env.ENABLE_ASYNC_ANALYSIS!=='true')throw unavailable();
    if(process.env.ENABLE_ANALYSIS_FIXTURE==='true'&&process.env.ENABLE_DEEPSEEK==='true')throw unavailable();
    const config=workerConfiguration({ANALYSIS_WORKER_MODEL_TIMEOUT_MS:process.env.ANALYSIS_WORKER_MODEL_TIMEOUT_MS,
      ANALYSIS_USD_TO_CNY:process.env.ANALYSIS_USD_TO_CNY,ANALYSIS_MAX_CALL_CNY:process.env.ANALYSIS_MAX_CALL_CNY});
    let metadata=deepSeekMetadata as typeof deepSeekMetadata|typeof fixtureMetadata;
    if(process.env.ENABLE_ANALYSIS_FIXTURE==='true'){
      createFixtureModel(process.env); // Explicit nonproduction only; admission does not generate.
      metadata=fixtureMetadata;
    }else{
      deepSeekConfiguration({ENABLE_DEEPSEEK:process.env.ENABLE_DEEPSEEK,MODEL_PROVIDER:process.env.MODEL_PROVIDER,
        MODEL_NAME:process.env.MODEL_NAME,MODEL_BASE_URL:process.env.MODEL_BASE_URL,MODEL_API_KEY:process.env.MODEL_API_KEY,
        DEEPSEEK_MAX_OUTPUT_TOKENS:process.env.DEEPSEEK_MAX_OUTPUT_TOKENS,
        DEEPSEEK_TIMEOUT_MS:String(config.modelTimeoutMs)},true);
    }
    return {runs,drafts:jdRepository(client),loadProfile:profileRepository(scope.supabase).load,metadata,
      enqueue:queue.enqueue,preflight:deepSeekPreflight,checkBudget:(input:{instruction:string;data:string})=>{workerCostBound(input,config);}};
  });
  return {GET:read.GET,POST};
}
