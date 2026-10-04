import { randomUUID } from 'node:crypto';
import { deepSeekGenerationFixture } from './deepseek-generation.ts';
import { fixtureMetadata } from '../../src/lib/analysis/fixture.ts';
import { deepSeekPreflight } from '../../src/lib/analysis/deepseek-prompt.ts';
import { workerConfiguration } from '../../src/lib/analysis/async-config.ts';
import type { AdmissionPorts } from '../../src/lib/analysis/async.ts';
import type { WorkerPorts,WorkerQueue,QueueMessage } from '../../src/lib/analysis/worker.ts';
import type { RunReservation } from '../../src/lib/analysis/runs.ts';
import { ModelRejected } from '../../src/lib/analysis/runs.ts';
import { unavailable } from '../../src/lib/api/http.ts';
export function asyncFixture(){
  let calls=0,now=0,archiveFails=false,enqueueFails=false,startResponseLost=false,saveResponseLost=false;
  let mode:'valid'|'invalid'|'rejected'|'timeout'='valid';let mutate:(()=>void)|null=null;
  const x=deepSeekGenerationFixture({metadata:fixtureMetadata,model:async()=>null});
  type Job={m:QueueMessage;reservation:RunReservation;token:string|null;lease:number;started:boolean;archived:boolean};
  const jobs:Job[]=[];
  const find=(m:QueueMessage)=>jobs.find(j=>j.m.messageId===m.messageId)!;
  const config=workerConfiguration({ANALYSIS_WORKER_MODEL_TIMEOUT_MS:'30000',ANALYSIS_USD_TO_CNY:'8',ANALYSIS_MAX_CALL_CNY:'1'});
  const admission:AdmissionPorts={...x.ports,metadata:fixtureMetadata,preflight:deepSeekPreflight,enqueue:async reservation=>{
    const result=await x.ports.runs.reserve(reservation);
    if(!result.acquired)return result;
    if(enqueueFails){x.rows.delete(`${reservation.userId}:${reservation.request.requestId}`);throw unavailable();}
    jobs.push({m:{messageId:jobs.length+1,runId:result.run.id,requestId:result.run.requestId,userId:reservation.userId,
      draftRevision:reservation.request.expectedDraftRevision,profileVersion:reservation.request.expectedProfileVersion},
      reservation:structuredClone(reservation),token:null,lease:0,started:false,archived:false});return result;
  }};
  const queue:WorkerQueue={
    read:async()=>structuredClone(jobs.find(j=>!j.archived)?.m??null),
    claim:async m=>{
      const j=find(m);let run=(await x.ports.runs.load(m.userId,m.requestId))!;
      if(run.status!=='processing')return {mode:'terminal',token:null,run};
      if(j.lease>now)return {mode:'busy',token:null,run};
      if(j.started){run=await x.ports.runs.finish(m.userId,m.requestId,'uncertain','MODEL_RESULT_UNCERTAIN');return {mode:'terminal',token:null,run};}
      j.token=randomUUID();j.lease=now+90000;return {mode:'acquired',token:j.token,run};
    },
    context:async(m,token)=>{const j=find(m);if(j.token!==token||j.lease<=now)throw unavailable();
      return {userId:j.reservation.userId,request:structuredClone(j.reservation.request),metadata:fixtureMetadata,
        run:(await x.ports.runs.load(m.userId,m.requestId))!,draft:(await x.ports.drafts.load(m.userId,j.reservation.request.draftId))!,
        profile:(await x.ports.loadProfile(m.userId))!};},
    start:async(m,token)=>{const j=find(m);if(j.token!==token||j.lease<=now||j.started)return false;
      j.started=true;j.lease=now+90000;if(startResponseLost)throw unavailable();return true;},
    complete:async(m,token,input)=>{const j=find(m);if(j.token!==token||!j.started||j.lease<=now)throw unavailable();
      const r=await x.ports.runs.complete(m.userId,m.requestId,input);if(saveResponseLost)throw unavailable();return r;},
    finish:async(m,token,status,code)=>{const j=find(m);if(j.token!==token)throw unavailable();return x.ports.runs.finish(m.userId,m.requestId,status,code);},
    archive:async m=>{if(archiveFails)throw unavailable();const r=await x.ports.runs.load(m.userId,m.requestId);
      if(r?.status==='processing')throw unavailable();find(m).archived=true;},
    metrics:async()=>{},
  };
  const worker:WorkerPorts={queue,config,metadata:fixtureMetadata,fixture:true,metrics:()=>null,preflight:deepSeekPreflight,
    model:async(_input,_title,signal)=>{calls++;mutate?.();
      if(mode==='rejected')throw new ModelRejected();
      if(mode==='invalid')return {...structuredClone(x.report),coreDuties:[]};
      if(mode==='timeout')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(unavailable()),{once:true}));
      return structuredClone(x.report);
    }};
  return {...x,admission,worker,jobs,calls:()=>calls,advance:(ms:number)=>{now+=ms;},setMode:(v:typeof mode)=>{mode=v;},
    onModel:(fn:()=>void)=>{mutate=fn;},failArchive:(v=true)=>{archiveFails=v;},failEnqueue:(v=true)=>{enqueueFails=v;},
    loseStartResponse:()=>{startResponseLost=true;},loseSaveResponse:()=>{saveResponseLost=true;}};
}
