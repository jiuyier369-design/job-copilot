import type { AnalysisRunPanelView, AnalysisRunUiState } from '../../types/analysis-run-ui.ts';
import type { AnalysisRunResource } from '../../types/api.ts';
import type { ReadResult } from './read-client.ts';
import { validAnalysisId } from '../report/resource.ts';

export const providerUnavailableNotice='可靠后台生成尚未上线验收，生成和创建新请求暂未开放。本页只查询本人已保存的请求，不调用模型、不产生模型费用。';
export function initialLiveView():AnalysisRunPanelView{
  return {mode:'live',fields:{company:'',jobTitle:'',city:'',direction:'',jdSourceUrl:''},fieldErrors:{},
    state:{kind:'blocked',reason:'version_unavailable',title:'生成暂未开放',message:'请先核对 JD 并保存画像；后台队列、Worker与费用验收完成后才开放生成。'},
    safetyNotice:providerUnavailableNotice,actionNotice:null,fieldsDisabled:false,canGenerate:false,canQueryStatus:false,isQuerying:false,
    canViewReport:false,canCreateNewRequest:false,showReviewJd:true,showEditProfile:true,generateLabel:'生成暂未开放',newRequestLabel:'创建新的生成请求'};
}
function runState(run:AnalysisRunResource):AnalysisRunUiState{
  switch(run.status){
    case 'processing':return {kind:'processing',title:'请求处理中',message:'这是服务器已有请求的状态。页面会每3秒查询状态；可以手动查询，不要重复生成。'};
    case 'completed':return {kind:'completed',analysisId:run.analysisId!,reportSource:'saved',title:'报告已保存',message:'可读取本人历史报告。报告来源以报告页标注为准；本次查询没有调用模型。'};
    case 'uncertain':return {kind:'uncertain',failureCode:run.failureCode as 'MODEL_RESULT_UNCERTAIN'|'SAVE_RESULT_UNCERTAIN',title:'结果无法确定',message:'该请求可能已经发生模型调用。请先查询状态，不应直接重复生成；本页不会再次提交。'};
    case 'failed':{
      const code=run.failureCode!;
      const messages={MODEL_REJECTED:'模型明确拒绝，本次未保存报告。',REPORT_INVALID:'输出未通过报告校验，本次未保存报告。',
        JD_DRAFT_CONFLICT:'JD 已更新，本次未保存报告。请重新核对 JD。',PROFILE_VERSION_CONFLICT:'画像已更新，本次未保存报告。请核对画像版本。'};
      if(Object.hasOwn(messages,code))return {kind:'failed',failureCode:code as keyof typeof messages,title:'本次生成失败',message:messages[code as keyof typeof messages]+'不会自动重试。'};
      return {kind:'blocked',reason:code==='PROFILE_REQUIRED'?'profile_missing':'jd_unconfirmed',title:'本次请求未完成',message:code==='PROFILE_REQUIRED'?'请先保存画像。本页不会自动重试。':'请重新核对 JD 或确认记录仍存在。本页不会自动重试。'};
    }
  }
}
/** Neither success nor failure replaces the user's job fields. Unknown results disable report access. */
export function settleLiveRun(view:AnalysisRunPanelView,result:ReadResult<AnalysisRunResource>):AnalysisRunPanelView{
  const state:AnalysisRunUiState=result.ok?runState(result.data):{kind:'requestError',title:'暂时无法读取状态',message:result.error.message,code:result.error.code};
  return {...view,state,isQuerying:false,fieldsDisabled:false,canGenerate:false,canCreateNewRequest:false,
    canViewReport:result.ok&&result.data.status==='completed'&&validAnalysisId(result.data.analysisId)};
}
