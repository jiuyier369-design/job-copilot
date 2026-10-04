import { analysisRuntime } from '@/lib/analysis/runtime';
import { respond } from '@/lib/api/http';
export const GET=(_request:Request,context:{params:Promise<{requestId:string}>})=>respond(async()=>{
  const {requestId}=await context.params;return (await analysisRuntime()).GET(requestId);
});
