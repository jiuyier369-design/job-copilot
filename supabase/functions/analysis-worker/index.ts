// DS3C dedicated test deployment: explicit mutually-exclusive real/fixture modes, disabled by default.
import { edgeWorker } from '../../../src/lib/analysis/edge-worker.ts';
// Ambient declaration permits offline TypeScript checking; Deno also checks the deployment graph.
declare const Deno:{env:{get:(name:string)=>string|undefined};serve:(handler:(request:Request)=>Promise<Response>)=>unknown};
const get=(name:string)=>Deno.env.get(name);
const safeLog=(event:unknown)=>console.log(JSON.stringify(event));
Deno.serve(edgeWorker(get,fetch,safeLog,safeLog,safeLog));
