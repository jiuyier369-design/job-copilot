import type { GenerateAnalysisRequest,ProfileResource,AnalysisFailureCode } from '../../types/api.ts';
import type { JdDraft } from '../../types/jd-review.ts';
import { unavailable } from '../api/http.ts';
import { prepareConfirmedAnalysis } from '../jd/generation-context.ts';
import { type AnalysisMetadata,type ConfirmedAnalysisWrite } from './pipeline.ts';
import { invoke,knownFailure,ModelUncertain,requestFingerprint,type InternalRun,type GenerationPorts } from './runs.ts';
import type { DeepSeekCallEvent } from './deepseek-metrics.ts';
import { workerCostBound, type workerConfiguration } from './async-config.ts';

export interface QueueMessage {messageId:number;runId:string;requestId:string;userId:string;draftRevision:number;profileVersion:number}
export interface WorkerClaim {mode:'acquired'|'busy'|'terminal';run:InternalRun;token:string|null}
export interface WorkerContext {userId:string;request:GenerateAnalysisRequest;metadata:AnalysisMetadata;draft:JdDraft;profile:ProfileResource;run:InternalRun}
export interface WorkerQueue {
  read():Promise<QueueMessage|null>;
  claim(message:QueueMessage):Promise<WorkerClaim>;
  context(message:QueueMessage,token:string):Promise<WorkerContext>;
  start(message:QueueMessage,token:string,upperCny:number):Promise<boolean>;
  complete(message:QueueMessage,token:string,input:ConfirmedAnalysisWrite):Promise<InternalRun>;
  finish(message:QueueMessage,token:string,status:'failed'|'uncertain',code:AnalysisFailureCode):Promise<InternalRun>;
  archive(message:QueueMessage):Promise<void>;
  metrics(message:QueueMessage,token:string,event:DeepSeekCallEvent|null):Promise<void>;
}
export interface WorkerPorts {
  queue:WorkerQueue;config:ReturnType<typeof workerConfiguration>;metadata:AnalysisMetadata;
  model:GenerationPorts['model'];preflight:NonNullable<GenerationPorts['preflight']>;
  metrics:()=>DeepSeekCallEvent|null;fixture:boolean;
  log?:(event:{stage:'worker-claimed'|'worker-model-started'|'worker-terminal'|'worker-archive-deferred';result:string;elapsedMs:number})=>void;
}
/** One message per invocation. Durable start marker precedes any external call; lost start response never dispatches. */
export async function consumeAnalysisOnce(ports:WorkerPorts):Promise<'idle'|'processing'|'completed'|'failed'|'uncertain'>{
  const started=performance.now(),log=(stage:Parameters<NonNullable<WorkerPorts['log']>>[0]['stage'],result:string)=>{
    try{ports.log?.({stage,result,elapsedMs:Math.round(performance.now()-started)});}catch{}
  };
  const message=await ports.queue.read();if(!message)return 'idle';
  const claim=await ports.queue.claim(message);
  if(claim.mode==='busy')return 'processing';
  async function archive(run:InternalRun){
    if(run.status==='processing')return 'processing' as const;
    try{await ports.queue.archive(message!);}catch{log('worker-archive-deferred',run.status);}
    return run.status;
  }
  if(claim.mode==='terminal')return archive(claim.run);
  if(!claim.token)throw unavailable();const token=claim.token;log('worker-claimed','acquired');
  let dispatchStarted=false,saving=false;
  const prepare=async()=>{
    const c=await ports.queue.context(message,token);
    if(c.userId!==message.userId||c.run.id!==message.runId||c.request.requestId!==message.requestId
      ||c.request.expectedDraftRevision!==message.draftRevision||c.request.expectedProfileVersion!==message.profileVersion
      ||(['reportStructureVersion','promptVersion','modelProvider','modelName','testDataVersion'] as const).some(k=>c.metadata?.[k]!==ports.metadata[k])
      ||requestFingerprint(c.userId,c.request,c.run.digest,c.metadata)!==c.run.fingerprint)throw unavailable();
    const context=await prepareConfirmedAnalysis(c.userId,c.request,{
      load:async()=>structuredClone(c.draft),create:async()=>{throw unavailable();},replace:async()=>{throw unavailable();},remove:async()=>{throw unavailable();},
    },async()=>structuredClone(c.profile));
    if(context.jdSnapshot.confirmation?.digest!==c.run.digest)throw unavailable();
    ports.preflight(context);return {c,context};
  };
  try{
    const before=await prepare(),upper=workerCostBound(before.context.modelInput,ports.config);
    // A timeout/connection loss here may have committed the marker. Never assume it is safe to call.
    dispatchStarted=true;
    if(!await ports.queue.start(message,token,upper))return 'processing';
    log('worker-model-started','started');
    const candidate=await invoke({model:ports.model,metadata:ports.metadata,modelTimeoutMs:ports.config.modelTimeoutMs} as GenerationPorts,
      before.context.modelInput,before.c.request.jobTitle);
    const event=ports.metrics();
    await ports.queue.metrics(message,token,event);
    if(!ports.fixture&&(!event||event.outcome!=='valid'||event.estimatedUsd===null||event.inputTokens===null
      ||event.outputTokens===null||event.totalTokens===null||event.outputTokens>ports.config.maxOutputTokens||!event.responseModelMatched
      ||event.estimatedUsd*ports.config.usdToCny>upper||event.estimatedUsd*ports.config.usdToCny>ports.config.maxCallCny))throw new ModelUncertain();
    before.context.validateCandidate(candidate);
    const after=await prepare(),report=after.context.validateCandidate(candidate);
    saving=true;
    const {company,jobTitle,city,direction,jdSourceUrl}=after.c.request;
    const completed=await ports.queue.complete(message,token,{userId:message.userId,expectedProfileVersion:after.context.profileVersion,
      jdSnapshot:after.context.jdSnapshot,jdItems:after.context.jdItems,job:{company,jobTitle,city,direction,jdSourceUrl},report,metadata:ports.metadata});
    log('worker-terminal',completed.status);return archive(completed);
  }catch(error){
    if(dispatchStarted){try{await ports.queue.metrics(message,token,ports.metrics());}catch{}}
    const code=knownFailure(error);
    const status=code||!dispatchStarted?'failed':'uncertain';
    const finished=await ports.queue.finish(message,token,status,
      code??(!dispatchStarted?'MODEL_REJECTED':saving?'SAVE_RESULT_UNCERTAIN':'MODEL_RESULT_UNCERTAIN'));
    log('worker-terminal',finished.status);return archive(finished);
  }
}
