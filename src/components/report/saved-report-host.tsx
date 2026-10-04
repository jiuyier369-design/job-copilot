"use client";
import { useEffect,useMemo,useRef,useState } from 'react';
import { createAnalysisReadClient, type ReadResult } from '@/lib/analysis-run/read-client';
import type { JobAnalysisRecord } from '@/types/job-copilot';
import { ReportView } from './report-view';

export function SavedReportHost({id}:{id:string}){
  const client=useMemo(()=>createAnalysisReadClient(),[]);
  const [result,setResult]=useState<ReadResult<JobAnalysisRecord>|null>(null),[pending,setPending]=useState(false);
  const busy=useRef(false),sequence=useRef(0);
  async function load(){
    if(busy.current)return;busy.current=true;const ticket=++sequence.current;setPending(true);
    const next=await client.loadReport(id);
    if(ticket!==sequence.current)return;
    busy.current=false;setPending(false);setResult(next);
  }
  useEffect(()=>{busy.current=false;setResult(null);void load();return ()=>{sequence.current++;};},[id,client]);
  if(result?.ok)return <ReportView analysis={result.data} mode={result.data.modelProvider==='fixture'?'saved-test':'saved'}/>;
  return <main className="mx-auto max-w-3xl space-y-4 px-4 py-8"><h1 className="text-2xl font-semibold">本人历史报告</h1>
    {pending?<p role="status">正在读取报告…</p>:null}
    {result&&!result.ok?<p role="alert">{result.error.message}</p>:null}
    {result&&!result.ok&&result.error.code==='UNAUTHENTICATED'?<a href="/login" target="_blank" rel="noopener noreferrer" className="block text-sky-700 underline">在新标签页登录</a>:null}
    <button className="rounded border px-4 py-2 disabled:opacity-50" disabled={pending} onClick={()=>void load()}>重新读取报告</button>
    <a className="block text-sky-700 underline" href="/analysis-run">返回分析请求状态</a>
  </main>;
}
