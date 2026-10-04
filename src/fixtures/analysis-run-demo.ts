import type { AnalysisRunJobFields,AnalysisRunPanelView,AnalysisRunUiState } from '../types/analysis-run-ui.ts';

export const analysisRunDemoNotice='仅 UI 演示，不调用模型、不产生费用、不保存数据。完成状态和报告引用均为虚构。';
export const analysisRunDemoFields:AnalysisRunJobFields={company:'虚构样例公司',jobTitle:'虚构应用协作岗位',city:'虚构城市',direction:'虚构应用方向',jdSourceUrl:''};
export interface AnalysisRunDemoScenario {key:string;label:string;view:AnalysisRunPanelView}
function scenario(key:string,label:string,state:AnalysisRunUiState,options:Partial<AnalysisRunPanelView>={}):AnalysisRunDemoScenario {
  return {key,label,view:{mode:'demo',fields:{...analysisRunDemoFields},fieldErrors:{},state,
    safetyNotice:analysisRunDemoNotice,actionNotice:null,fieldsDisabled:false,canGenerate:false,
    canQueryStatus:false,isQuerying:false,canViewReport:false,canCreateNewRequest:false,
    showReviewJd:false,showEditProfile:false,generateLabel:'开始生成（演示）',newRequestLabel:'创建新的生成请求（演示）',...options}};
}
export const analysisRunDemoScenarios:readonly AnalysisRunDemoScenario[]=[
  scenario('jd-unconfirmed','JD 未确认',{kind:'blocked',reason:'jd_unconfirmed',title:'请先核对 JD',message:'这份要求清单尚未确认。先完成分类并确认清单；确认不代表符合资格或岗位仍在招聘。'},{showReviewJd:true}),
  scenario('profile-missing','画像缺失',{kind:'blocked',reason:'profile_missing',title:'请先补充画像',message:'缺少可用于分析的个人事实，请先录入真实经历。'},{showEditProfile:true}),
  scenario('ready','可生成',{kind:'ready',title:'可以开始演示',message:'宿主已提供演示所需条件。此处不会提交真实请求。'},{canGenerate:true}),
  scenario('submitting','提交中',{kind:'submitting',title:'正在创建请求（演示）',message:'请等待，不要重复提交。'},{fieldsDisabled:true}),
  scenario('processing','处理中',{kind:'processing',title:'请求处理中（演示）',message:'请查询当前请求状态，不要重复生成。'},{fieldsDisabled:true,canQueryStatus:true}),
  // Deliberately synthetic reference. Never enable real report navigation for this fixture.
  scenario('completed','已完成（虚构）',{kind:'completed',analysisId:'00000000-0000-4000-8000-000000000009',reportSource:'demo',title:'完成状态演示',message:'这是虚构的完成状态，没有真实报告。'},{canCreateNewRequest:true}),
  scenario('model-rejected','模型拒绝',{kind:'failed',failureCode:'MODEL_REJECTED',title:'生成未完成',message:'模型未接受本次请求，没有可查看的报告。'},{canCreateNewRequest:true}),
  scenario('report-invalid','报告校验失败',{kind:'failed',failureCode:'REPORT_INVALID',title:'报告未通过校验',message:'输出未满足结构或证据要求，没有保存报告。'},{canCreateNewRequest:true}),
  scenario('jd-conflict','JD 版本冲突',{kind:'failed',failureCode:'JD_DRAFT_CONFLICT',title:'JD 已变化',message:'请返回 JD 核对页读取并重新确认当前清单，再决定是否创建新请求。'},{showReviewJd:true}),
  scenario('profile-conflict','画像版本冲突',{kind:'failed',failureCode:'PROFILE_VERSION_CONFLICT',title:'画像已变化',message:'请先读取并核对当前画像，再决定是否创建新请求。'},{showEditProfile:true}),
  scenario('model-uncertain','模型结果不确定',{kind:'uncertain',failureCode:'MODEL_RESULT_UNCERTAIN',title:'结果无法确定',message:'可能已经发生模型调用。请先查询当前状态，不应直接重复生成。'},{canQueryStatus:true,fieldsDisabled:true}),
  scenario('save-uncertain','保存结果不确定',{kind:'uncertain',failureCode:'SAVE_RESULT_UNCERTAIN',title:'保存结果无法确定',message:'可能已经发生模型调用，也可能已经保存。请先查询当前状态，不应直接重复生成。'},{canQueryStatus:true,fieldsDisabled:true}),
  scenario('login-expired','登录失效',{kind:'requestError',code:'UNAUTHENTICATED',title:'需要重新登录',message:'当前输入已保留。真实接线后需要重新登录，再主动查询原请求；演示不使用账号。'},{canQueryStatus:false}),
  scenario('service-unavailable','服务不可用',{kind:'requestError',code:'SERVICE_UNAVAILABLE',title:'暂时无法获取状态',message:'当前输入已保留。若已有请求，请先查询状态，不要直接重复生成。'},{canQueryStatus:true}),
  scenario('version-unavailable','版本不可用',{kind:'blocked',reason:'version_unavailable',title:'请核对当前版本',message:'当前 JD 或画像版本不可用，请先重新读取。'},{showReviewJd:true,showEditProfile:true}),
  scenario('empty-required','必填字段为空',{kind:'ready',title:'请补充岗位信息',message:'公司和岗位名称不能为空。'},{fields:{...analysisRunDemoFields,company:'',jobTitle:''},canGenerate:false,fieldErrors:{company:'请输入公司名称。',jobTitle:'请输入岗位名称。'}}),
  scenario('empty-messages','空辅助信息',{kind:'ready',title:'可以开始演示',message:'可选信息尚未填写。'},{canGenerate:true,safetyNotice:'',actionNotice:null}),
  scenario('querying','查询中',{kind:'processing',title:'正在查询（演示）',message:'正在读取当前请求状态，请等待。'},{fieldsDisabled:true,isQuerying:true}),
];
