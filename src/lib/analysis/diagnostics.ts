/** Local fixture diagnostics only. Never attach identifiers or raw errors. */
export const analysisDiagnosticStages = [
  'context-build-started','context-build-completed',
  'run-prepared','run-reserve-acquired','run-reserve-replayed','model-started','model-returned',
  'model-rejected','model-output-invalid','model-timeout','finish-started','finish-completed',
  'finish-failed','complete-started','complete-completed','http-response-ready',
] as const;
const results = ['ready','acquired','started','returned','rejected','invalid','timeout','unavailable',
  'processing','completed','failed','uncertain'] as const;
export type AnalysisDiagnosticStage = typeof analysisDiagnosticStages[number];
export type AnalysisDiagnosticResult = typeof results[number];
export interface AnalysisDiagnosticEvent {stage:AnalysisDiagnosticStage;result:AnalysisDiagnosticResult;elapsedMs:number}
export type AnalysisDiagnostics = (stage:AnalysisDiagnosticStage,result:AnalysisDiagnosticResult)=>void;
export function safeAnalysisDiagnosticEvent(value:unknown):AnalysisDiagnosticEvent|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='elapsedMs,result,stage'
    ||!analysisDiagnosticStages.includes(v.stage as AnalysisDiagnosticStage)
    ||!results.includes(v.result as AnalysisDiagnosticResult)
    ||!Number.isSafeInteger(v.elapsedMs)||Number(v.elapsedMs)<0)return null;
  return {stage:v.stage as AnalysisDiagnosticStage,result:v.result as AnalysisDiagnosticResult,elapsedMs:Number(v.elapsedMs)};
}
export function fixtureDiagnosticsEnabled(env:{NODE_ENV?:string;ENABLE_ANALYSIS_FIXTURE?:string;ANALYSIS_FIXTURE_DIAGNOSTICS?:string}){
  return env.NODE_ENV!=='production'&&env.ENABLE_ANALYSIS_FIXTURE==='true'&&env.ANALYSIS_FIXTURE_DIAGNOSTICS==='true';
}
export function createAnalysisDiagnostics(env:Parameters<typeof fixtureDiagnosticsEnabled>[0],
  sink:(event:AnalysisDiagnosticEvent)=>void,clock:()=>number=()=>performance.now()):AnalysisDiagnostics {
  const enabled=fixtureDiagnosticsEnabled(env),started=clock();
  return (stage,result)=>{
    if(!enabled||!analysisDiagnosticStages.includes(stage)||!results.includes(result))return;
    const elapsedMs=Math.max(0,Math.round(clock()-started));
    if(!Number.isFinite(elapsedMs))return;
    // Logging failure must never change a generation decision or persisted state.
    try{sink({stage,result,elapsedMs});}catch{}
  };
}

/** Dedicated DS2 process only; no fixture backend or production activation. Same fixed safe fields. */
export function createDs2Diagnostics(enabled:boolean, sink:(event:AnalysisDiagnosticEvent)=>void):AnalysisDiagnostics {
  const started=performance.now();
  return (stage,result)=>{
    if(!enabled||!analysisDiagnosticStages.includes(stage)||!results.includes(result))return;
    try{sink({stage,result,elapsedMs:Math.max(0,Math.round(performance.now()-started))});}catch{}
  };
}
