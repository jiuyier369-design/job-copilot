import { analysisRunDemoScenarios } from '../../fixtures/analysis-run-demo.ts';
import type { AnalysisRunJobField,AnalysisRunPanelView } from '../../types/analysis-run-ui.ts';

/** Pure UI sandbox. No UUID creation, persistence, API adapter or network. */
export function analysisRunDemoView(key:string):AnalysisRunPanelView {
  const item=analysisRunDemoScenarios.find(s=>s.key===key);
  if(!item)throw new Error('Unknown UI scenario');
  return structuredClone(item.view);
}
/** Host-authorized saved reference only; a demo reference can never open a report. */
export function canShowAnalysisReport(view:AnalysisRunPanelView):boolean {
  return view.mode==='live'&&view.canViewReport&&view.state.kind==='completed'
    &&view.state.reportSource==='saved'&&Boolean(view.state.analysisId);
}
export function editAnalysisRunDemoField(view:AnalysisRunPanelView,field:AnalysisRunJobField,value:string):AnalysisRunPanelView {
  if(view.fieldsDisabled)return view;
  const fields={...view.fields,[field]:value};
  const fieldErrors:AnalysisRunPanelView['fieldErrors']={};
  if(!fields.company.trim())fieldErrors.company='请输入公司名称。';
  if(!fields.jobTitle.trim())fieldErrors.jobTitle='请输入岗位名称。';
  if(fields.jdSourceUrl){
    try{const url=new URL(fields.jdSourceUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}
    catch{fieldErrors.jdSourceUrl='请输入完整的 http 或 https 来源链接，或留空。';}
  }
  return {...view,fields,fieldErrors,canGenerate:view.state.kind==='ready'&&Object.keys(fieldErrors).length===0};
}
export function analysisRunDemoTransition(view:AnalysisRunPanelView,action:'generate'|'submitted'|'query'|'new-request'):AnalysisRunPanelView {
  const fields=structuredClone(view.fields);
  const next=(key:string)=>({...analysisRunDemoView(key),fields});
  if(action==='generate')return view.canGenerate?next('submitting'):view;
  if(action==='submitted')return view.state.kind==='submitting'?next('processing'):view;
  if(action==='query'){
    if(!view.canQueryStatus||view.isQuerying)return view;
    if(view.state.kind==='processing')return next('completed');
    return {...view,actionNotice:'演示查询完成，状态未改变；没有发出任何网络请求。'};
  }
  if(!view.canCreateNewRequest)return view;
  return editAnalysisRunDemoField(next('ready'),'company',fields.company);
}
