import { analysisRuntime } from '@/lib/analysis/runtime';
import { respond } from '@/lib/api/http';
export const POST=(request:Request)=>respond(async()=>(await analysisRuntime()).POST(request));
