import { unavailable } from '../api/http.ts';
import { consumeAnalysisOnce,type WorkerPorts } from './worker.ts';
import { ModelUncertain } from './runs.ts';

export const edgeFixtureFaults=['before-read','after-marker','archive-deferred','hold-model','rejected','invalid'] as const;
export type EdgeFixtureFault=typeof edgeFixtureFaults[number];
/** Test-only fault injection; caller must validate service token AND dedicated Edge configuration first. */
export async function consumeFixture(ports:WorkerPorts,fault?:EdgeFixtureFault){
  if(!ports.fixture)throw unavailable();
  const queue={...ports.queue};
  if(fault==='before-read')queue.read=async()=>{throw unavailable();};
  if(fault==='after-marker')queue.start=async(...args)=>{
    const started=await ports.queue.start(...args);if(started)throw new ModelUncertain();return started;
  };
  if(fault==='archive-deferred')queue.archive=async()=>{throw unavailable();};
  const model:WorkerPorts['model']=async(input,title,signal)=>{
    const candidate=await ports.model(input,fault==='rejected'?'fixture:rejected':fault==='invalid'?'fixture:invalid':title,signal);
    if(fault==='hold-model')await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new ModelUncertain());};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},10000);
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    });
    return candidate;
  };
  return consumeAnalysisOnce({...ports,queue,model});
}
