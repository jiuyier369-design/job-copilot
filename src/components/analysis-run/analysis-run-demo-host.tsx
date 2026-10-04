"use client";
import { useEffect,useRef,useState } from 'react';
import { AnalysisRunPanel } from './analysis-run-panel';
import { analysisRunDemoNotice,analysisRunDemoScenarios } from '@/fixtures/analysis-run-demo';
import { analysisRunDemoTransition,analysisRunDemoView,editAnalysisRunDemoField } from '@/lib/analysis-run/demo-state';
import type { AnalysisRunJobField,AnalysisRunPanelView } from '@/types/analysis-run-ui';

export function AnalysisRunDemoHost(){
  const [scenario,setScenario]=useState('jd-unconfirmed');
  const [view,setView]=useState(()=>analysisRunDemoView('jd-unconfirmed'));
  const current=useRef(view),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const commit=(next:AnalysisRunPanelView)=>{current.current=next;setView(next);};
  const cancel=()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
  const choose=(key:string)=>{cancel();setScenario(key);commit(analysisRunDemoView(key));};
  const generate=()=>{
    const before=current.current,next=analysisRunDemoTransition(before,'generate');if(next===before)return;
    commit(next);timer.current=setTimeout(()=>{timer.current=null;commit(analysisRunDemoTransition(current.current,'submitted'));},600);
  };
  const query=()=>commit(analysisRunDemoTransition(current.current,'query'));
  const navigate=(destination:string)=>commit({...current.current,actionNotice:`演示回调已触发：${destination}。此页不修改 URL；真实接线由 Codex 另行实现。`});
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
    <h1 className="text-2xl font-semibold">分析生成面板预览</h1>
    <p role="note">{analysisRunDemoNotice}</p>
    <label className="block" htmlFor="analysis-run-scenario">演示场景</label>
    <select id="analysis-run-scenario" className="w-full max-w-full rounded border p-2" value={scenario} onChange={e=>choose(e.target.value)}>
      {analysisRunDemoScenarios.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
    <AnalysisRunPanel {...view}
      onFieldChange={(field:AnalysisRunJobField,value:string)=>commit(editAnalysisRunDemoField(current.current,field,value))}
      onGenerate={generate} onQueryStatus={query}
      onViewReport={()=>{if(current.current.canViewReport)navigate('查看报告');}}
      onCreateNewRequest={()=>commit(analysisRunDemoTransition(current.current,'new-request'))}
      onReviewJd={()=>navigate('返回 JD 核对')} onEditProfile={()=>navigate('返回画像页面')}/>
  </main>;
}
