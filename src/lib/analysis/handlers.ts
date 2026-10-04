import { ApiError, invalid, readJson, respond, success } from '../api/http.ts';
import { JdError } from '../jd/content.ts';
import { generateAnalysis, publicRun, type GenerationPorts, type RunRepository } from './runs.ts';
import type { AnalysisRunResource } from '../../types/api.ts';
const validId=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
function handled(run:()=>Promise<Response>){return respond(async()=>{
  try{return await run();}catch(error){
    if(error instanceof JdError)throw new ApiError(error.code==='NOT_FOUND'?404:error.code==='INVALID_INPUT'?422:409,error.code,'请重新核对草稿状态和版本。');
    throw error;
  }
});}
function result(run:AnalysisRunResource){
  if(run.status!=='processing')return success(run);
  return Response.json({ok:true,data:run,code:'ANALYSIS_IN_PROGRESS'},{status:202,headers:{'Cache-Control':'private, no-store'}});
}
export function analysisHandlers(session:()=>Promise<{userId:string;runs:RunRepository}>,ports:()=>GenerationPorts){
  return {
    POST:(request:Request)=>handled(async()=>{
      const input=await readJson(request);
      const {userId}=await session();
      return result(await generateAnalysis(userId,input,ports()));
    }),
    GET:(requestId:string)=>handled(async()=>{
      if(!validId(requestId))throw invalid();
      const {userId,runs}=await session();const run=await runs.load(userId,requestId.toLowerCase());
      if(!run)throw new ApiError(404,'NOT_FOUND','分析请求不存在或不可访问。');
      return success(publicRun(run));
    }),
  };
}
