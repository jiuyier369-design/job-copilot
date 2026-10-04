"use client";
import { useEffect, useState } from 'react';
import { evidencePlanDemoSource as source,evidencePlanDemoReviewed } from '@/fixtures/evidence-plan-demo';
import { checkReview,checkRow,editReview,initialReview,optionsFor,EvidencePlanError,type ReviewDemoState } from '@/lib/evidence-plan/core';
import type { EvidencePlanPanelProps } from '@/types/evidence-plan';
import { EvidencePlanPanel } from './evidence-plan-panel';

const notices:Record<string,string>={REVIEW_REQUIRED:'请逐条选择、核对并确认；待核对条目不能进入生成。',EVIDENCE_NOT_ALLOWED:'请选择允许的来源动作并说明已有动作及缺口；笔记不能代替画像事实。'};
export function EvidencePlanDemoHost({trialMode=false,onProgress}: {
  trialMode?: boolean;
  onProgress?: (progress: { checked: number; total: number; confirmed: boolean }) => void;
} = {}){
  const [empty,setEmpty]=useState(false);
  const [state,setState]=useState<ReviewDemoState>(()=>({review:initialReview(source),activeJdId:source.jdItems[0].jdId,confirmed:false,error:null}));
  useEffect(()=>{onProgress?.({checked:state.review.rows.filter(r=>r.checked).length,total:source.jdItems.length,confirmed:state.confirmed});},[onProgress,state.review,state.confirmed]);
  const fail=(error:unknown)=>setState(s=>({...s,error:notices[error instanceof EvidencePlanError?error.code:'']??'核对未通过，请检查当前条目。'}));
  let canConfirm=false;
  try{checkReview(source,{...state.review,acknowledged:true});canConfirm=true;}catch{}
  const patch=(value:Parameters<typeof editReview>[1])=>setState(s=>editReview(s,value));
  const props:EvidencePlanPanelProps={
    jdText:source.jdText,rows:state.review.rows,requirements:source.jdItems,facts:source.profile.facts,
    options:Object.fromEntries(source.jdItems.map(i=>[i.jdId,optionsFor(source,i.jdId)])),activeJdId:state.activeJdId,
    notice:'纯虚构内存演示：不调用模型、不产生费用、不保存账号数据。刷新会重置；生成始终关闭。',
    error:state.error,canConfirm:canConfirm&&!state.confirmed,confirmed:state.confirmed,
    onActivate:jdId=>setState(s=>({...s,activeJdId:jdId,error:null})),onChoice:choice=>patch({choice}),
    onSelection:(selection,selected)=>setState(s=>{
      const row=s.review.rows.find(r=>r.jdId===s.activeJdId)!;
      const selections=row.selections.filter(x=>x.actionKey!==selection.actionKey);
      if(selected)selections.push(selection);
      return editReview(s,{selections,existingAction:selections.map(x=>source.actions.find(a=>a.key===x.actionKey)!.quote).join('；')});
    }),
    onNote:(field,value)=>patch({[field]:value}),
    onCheckRow:()=>{try{checkRow(source,state.review.rows.find(r=>r.jdId===state.activeJdId)!);setState(s=>({...s,confirmed:false,error:null,
      review:{...s.review,planRevision:s.review.planRevision+1,acknowledged:false,rows:s.review.rows.map(r=>r.jdId===s.activeJdId?{...r,checked:true}:r)}}));}catch(error){fail(error);}},
    onConfirm:()=>{try{checkReview(source,{...state.review,acknowledged:true});setState(s=>({...s,confirmed:true,error:null,review:{...s.review,acknowledged:true}}));}catch(error){fail(error);}},
  };
  const displayProps=empty?{...props,jdText:'',requirements:[],rows:[],facts:[],options:{},activeJdId:'',canConfirm:false,confirmed:false,error:null}:props;
  return <main style={{maxWidth:1280,margin:'auto',padding:24}}>
    {trialMode?<h2>14 条虚构要求 · 使用 W10 面板逐条核对</h2>:<h1>逐条证据核对 · 契约原型</h1>}
    <p>仅核对计划，不是完整报告编辑器。选择支持不代表资格满足；暂无线索不代表没有经历。</p>
    {!trialMode && <><button type="button" onClick={()=>{setEmpty(false);setState({review:initialReview(source),activeJdId:'D01',confirmed:false,error:null});}}>空白核对计划</button>{' '}
    <button type="button" onClick={()=>{setEmpty(false);setState({review:structuredClone(evidencePlanDemoReviewed),activeJdId:'D06',confirmed:false,error:null});}}>查看固定完成样例（虚构）</button>{' '}
    <button type="button" onClick={()=>setEmpty(true)}>空输入场景（展示）</button></>}
    <EvidencePlanPanel {...displayProps}/>
  </main>;
}
