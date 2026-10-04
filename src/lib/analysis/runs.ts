import { createHash } from 'node:crypto';
import type { AnalysisFailureCode, AnalysisRunResource, GenerateAnalysisRequest, ProfileResource } from '../../types/api.ts';
import { ApiError, unavailable } from '../api/http.ts';
import { JdError } from '../jd/content.ts';
import type { JdRepository } from '../jd/service.ts';
import { prepareConfirmedAnalysis } from '../jd/generation-context.ts';
import { ReportValidationError } from '../report/validate.ts';
import { parseAnalysisRequest, type AnalysisMetadata, type ConfirmedAnalysisWrite } from './pipeline.ts';
import type { AnalysisDiagnostics } from './diagnostics.ts';
export interface InternalRun extends AnalysisRunResource { id:string; fingerprint:string; digest:string }
export interface RunReservation {
  userId:string; request:GenerateAnalysisRequest; fingerprint:string; digest:string; metadata:AnalysisMetadata;
}
export interface RunRepository {
  load(userId:string,requestId:string):Promise<InternalRun|null>;
  reserve(input:RunReservation):Promise<{acquired:boolean;run:InternalRun}>;
  complete(userId:string,requestId:string,input:ConfirmedAnalysisWrite):Promise<InternalRun>;
  finish(userId:string,requestId:string,status:'failed'|'uncertain',code:AnalysisFailureCode):Promise<InternalRun>;
}
export function publicRun(run:InternalRun):AnalysisRunResource {
  const {requestId,status,analysisId,failureCode,startedAt,finishedAt}=run;
  return {requestId,status,analysisId,failureCode,startedAt,finishedAt};
}
export function requestFingerprint(userId:string,r:GenerateAnalysisRequest,digest:string,m:AnalysisMetadata) {
  return createHash('sha256').update(JSON.stringify(['analysis-request-v1',userId,r.requestId,r.company,r.jobTitle,r.city,
    r.direction,r.jdSourceUrl,r.draftId,r.expectedDraftRevision,digest,r.expectedProfileVersion,
    m.promptVersion,m.modelProvider,m.modelName,m.reportStructureVersion])).digest('hex');
}
export class ModelRejected extends Error {constructor(){super('MODEL_REJECTED');}}
export class ModelUncertain extends Error {constructor(){super('MODEL_RESULT_UNCERTAIN');}}
export interface GenerationPorts {
  runs:RunRepository; drafts:JdRepository;
  loadProfile:(userId:string)=>Promise<ProfileResource|null>;
  model:(input:{instruction:string;data:string},jobTitle:string,signal:AbortSignal)=>Promise<unknown>;
  metadata:AnalysisMetadata; modelTimeoutMs?:number; diagnostics?:AnalysisDiagnostics;
  /** Provider input limits, after server confirmation/version checks and before reserve or charge. */
  preflight?:(context:Awaited<ReturnType<typeof prepareConfirmedAnalysis>>)=>void;
}
export async function invoke(ports:GenerationPorts,input:{instruction:string;data:string},title:string) {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  ports.diagnostics?.('model-started','started');
  try {return await Promise.race([ports.model(structuredClone(input),title,controller.signal),new Promise((_,reject)=>{
    timer=setTimeout(()=>{ports.diagnostics?.('model-timeout','timeout');controller.abort();reject(new ModelUncertain());},ports.modelTimeoutMs??12000);
  })]);}catch(error){
    if(error instanceof ModelRejected)ports.diagnostics?.('model-rejected','rejected');
    throw error;
  }finally{clearTimeout(timer);}
}
export function knownFailure(error:unknown):AnalysisFailureCode|null {
  if(error instanceof ReportValidationError)return 'REPORT_INVALID';
  if(error instanceof ModelRejected)return 'MODEL_REJECTED';
  if(error instanceof JdError&&['NOT_FOUND','JD_DRAFT_CONFLICT','JD_REVIEW_REQUIRED'].includes(error.code))return error.code as AnalysisFailureCode;
  if(error instanceof ApiError&&['PROFILE_VERSION_CONFLICT','PROFILE_REQUIRED'].includes(error.code))return error.code as AnalysisFailureCode;
  return null;
}
/** Only an acquired reservation may invoke a model. Replays never retry processing. */
export async function generateAnalysis(userId:string,input:unknown,ports:GenerationPorts):Promise<AnalysisRunResource> {
  const request=parseAnalysisRequest(input),metadata=structuredClone(ports.metadata);
  const existing=await ports.runs.load(userId,request.requestId);
  if(existing){
    if(existing.fingerprint!==requestFingerprint(userId,request,existing.digest,metadata))
      throw new ApiError(409,'IDEMPOTENCY_CONFLICT','该请求编号已用于不同分析，请使用新的请求编号。');
    ports.diagnostics?.('run-reserve-replayed',existing.status);
    return publicRun(existing);
  }
  const prepare=()=>prepareConfirmedAnalysis(userId,request,ports.drafts,ports.loadProfile);
  ports.diagnostics?.('context-build-started','started');
  const before=await prepare();
  ports.preflight?.(before);
  ports.diagnostics?.('context-build-completed','ready');
  ports.diagnostics?.('run-prepared','ready');
  const digest=before.jdSnapshot.confirmation!.digest;
  const reserved=await ports.runs.reserve({userId,request,digest,metadata,fingerprint:requestFingerprint(userId,request,digest,metadata)});
  if(!reserved.acquired){ports.diagnostics?.('run-reserve-replayed',reserved.run.status);return publicRun(reserved.run);}
  ports.diagnostics?.('run-reserve-acquired','acquired');
  let saving=false;
  try {
    const candidate=await invoke(ports,before.modelInput,request.jobTitle);
    ports.diagnostics?.('model-returned','returned');
    before.validateCandidate(candidate);
    const after=await prepare();
    if(after.jdSnapshot.confirmation?.digest!==digest)throw new JdError('JD_DRAFT_CONFLICT');
    const report=after.validateCandidate(candidate);
    const {company,jobTitle,city,direction,jdSourceUrl}=request;
    saving=true;
    ports.diagnostics?.('complete-started','started');
    const completed=await ports.runs.complete(userId,request.requestId,{userId,expectedProfileVersion:after.profileVersion,
      jdSnapshot:after.jdSnapshot,jdItems:after.jdItems,job:{company,jobTitle,city,direction,jdSourceUrl},report,metadata});
    ports.diagnostics?.('complete-completed',completed.status);
    return publicRun(completed);
  }catch(error){
    if(error instanceof ReportValidationError)ports.diagnostics?.('model-output-invalid','invalid');
    const failure=knownFailure(error);
    // A committed save whose response was lost cannot be overwritten by finish.
    ports.diagnostics?.('finish-started','started');
    try{
      const finished=await ports.runs.finish(userId,request.requestId,failure?'failed':'uncertain',
        failure??(saving?'SAVE_RESULT_UNCERTAIN':'MODEL_RESULT_UNCERTAIN'));
      ports.diagnostics?.('finish-completed',finished.status);return publicRun(finished);
    }catch{ports.diagnostics?.('finish-failed','unavailable');throw unavailable();}
  }
}
