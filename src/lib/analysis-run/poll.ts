import type { AnalysisRunResource } from '../../types/api.ts';
import type { ReadResult } from './read-client.ts';
/** Query only: one in-flight GET, no POST, stop on error/terminal; pause while hidden. */
export function pollAnalysisRun(query:()=>Promise<ReadResult<AnalysisRunResource>|null>,visible:()=>boolean=()=>true,
  schedule:(callback:()=>void,ms:number)=>ReturnType<typeof setTimeout>=(callback,ms)=>setTimeout(callback,ms),
  cancel:(timer:ReturnType<typeof setTimeout>)=>void=clearTimeout){
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const later=()=>{if(!stopped)timer=schedule(()=>{void tick();},3000);};
  async function tick(){
    if(stopped)return;if(!visible()){later();return;}
    let result:ReadResult<AnalysisRunResource>|null;
    try{result=await query();}catch{stopped=true;return;}if(stopped)return;
    if(result&&(!result.ok||result.data.status!=='processing')){stopped=true;return;}
    later();
  }
  later();return ()=>{stopped=true;if(timer!==undefined)cancel(timer);};
}
