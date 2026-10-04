"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisRunPanel } from './analysis-run-panel';
import { createAnalysisReadClient } from '@/lib/analysis-run/read-client';
import { pollAnalysisRun } from '@/lib/analysis-run/poll';
import { initialLiveView, settleLiveRun } from '@/lib/analysis-run/live-state';
import { validAnalysisId } from '@/lib/report/resource';
import { canShowAnalysisReport } from '@/lib/analysis-run/demo-state';
import type { AnalysisRunJobField } from '@/types/analysis-run-ui';

export function AnalysisRunLiveHost(){
  const client=useMemo(()=>createAnalysisReadClient(),[]);
  const [view,setView]=useState(initialLiveView),[requestId,setRequestId]=useState<string|null>(null);
  const currentId=useRef<string|null>(null),sequence=useRef(0),pending=useRef(false);
  async function query(id:string){
    if(pending.current)return null;
    pending.current=true;const ticket=++sequence.current;
    setView(v=>({...v,isQuerying:true,canViewReport:false}));
    const result=await client.loadRun(id);
    if(ticket!==sequence.current)return null;
    pending.current=false;
    setView(v=>settleLiveRun(v,result));return result;
  }
  useEffect(()=>{
    const restore=()=>{
      sequence.current++;pending.current=false;
      const id=new URL(window.location.href).searchParams.get('requestId');
      currentId.current=id;setRequestId(id);
      setView(v=>({...initialLiveView(),fields:v.fields,canQueryStatus:validAnalysisId(id)}));
      if(id!==null)void query(id);
    };
    restore();window.addEventListener('popstate',restore);
    return ()=>{sequence.current++;window.removeEventListener('popstate',restore);};
  // Restore durable requestId from URL; no automatic POST.
  },[client]);
  useEffect(()=>{
    if(view.state.kind!=='processing'||!requestId||!validAnalysisId(requestId))return;
    return pollAnalysisRun(()=>query(requestId),()=>document.visibilityState==='visible');
  },[view.state.kind,requestId,client]);
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
    <header><p className="text-sm text-slate-500">JOB COPILOT · 测试账号</p><h1 className="text-2xl font-semibold">分析请求状态</h1>
      <p className="mt-2 text-sm text-slate-600">通过已有请求链接恢复状态。岗位字段仅为当前页面输入，不会修改历史请求；刷新不会保存这些输入。</p></header>
    {view.state.kind==='requestError'&&view.state.code==='UNAUTHENTICATED'
      ?<a className="block text-sky-700 underline" href="/login" target="_blank" rel="noopener noreferrer">在新标签页登录，然后主动查询状态</a>:null}
    {view.state.kind==='requestError'&&['INVALID_INPUT','NOT_FOUND'].includes(view.state.code)
      ?<a className="block text-sky-700 underline" href="/jd-review">返回 JD 核对，使用有效请求链接</a>:null}
    <AnalysisRunPanel {...view}
      onFieldChange={(field:AnalysisRunJobField,value:string)=>setView(v=>({...v,fields:{...v.fields,[field]:value}}))}
      onGenerate={()=>{}} onCreateNewRequest={()=>{}}
      onQueryStatus={()=>{if(requestId&&currentId.current===requestId)void query(requestId);}}
      onViewReport={()=>{if(canShowAnalysisReport(view)&&view.state.kind==='completed'&&validAnalysisId(view.state.analysisId))window.location.assign(`/analyses/${view.state.analysisId}`);}}
      onReviewJd={()=>window.location.assign('/jd-review')} onEditProfile={()=>window.location.assign('/my-profile')}/>
  </main>;
}
