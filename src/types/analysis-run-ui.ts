/** W9 controlled display contract. No requests, identities, versions or raw errors. */
export interface AnalysisRunJobFields {
  company: string;
  jobTitle: string;
  city: string;
  direction: string;
  jdSourceUrl: string;
}
export type AnalysisRunJobField = keyof AnalysisRunJobFields;
export const analysisRunJobLabels: Record<AnalysisRunJobField,string> = {
  company:'公司',jobTitle:'岗位名称',city:'城市',direction:'岗位方向',jdSourceUrl:'JD 来源链接',
};
interface StateText { title:string; message:string }
export type AnalysisRunUiState = StateText & (
  | {kind:'blocked';reason:'jd_unconfirmed'|'profile_missing'|'version_unavailable'}
  | {kind:'ready'|'submitting'|'processing'}
  | {kind:'completed';analysisId:string;reportSource:'demo'|'saved'}
  | {kind:'failed';failureCode:'MODEL_REJECTED'|'REPORT_INVALID'|'JD_DRAFT_CONFLICT'|'PROFILE_VERSION_CONFLICT'}
  | {kind:'uncertain';failureCode:'MODEL_RESULT_UNCERTAIN'|'SAVE_RESULT_UNCERTAIN'}
  | {kind:'requestError';code:'UNAUTHENTICATED'|'NOT_FOUND'|'SERVICE_UNAVAILABLE'|'INVALID_INPUT'|'JD_DRAFT_CONFLICT'|'PROFILE_VERSION_CONFLICT'}
);
export interface AnalysisRunPanelView {
  mode:'demo'|'live';
  fields:AnalysisRunJobFields;
  fieldErrors:Partial<Record<AnalysisRunJobField,string>>;
  state:AnalysisRunUiState;
  safetyNotice:string;
  actionNotice:string|null;
  fieldsDisabled:boolean;
  canGenerate:boolean;
  canQueryStatus:boolean;
  isQuerying:boolean;
  canViewReport:boolean;
  canCreateNewRequest:boolean;
  showReviewJd:boolean;
  showEditProfile:boolean;
  generateLabel:string;
  newRequestLabel:string;
}
/** Controlled inputs: component forwards user actions; Host owns all decisions. */
export interface AnalysisRunPanelProps extends AnalysisRunPanelView {
  onFieldChange:(field:AnalysisRunJobField,value:string)=>void;
  onGenerate:()=>void;
  onQueryStatus:()=>void;
  onViewReport:()=>void;
  onCreateNewRequest:()=>void;
  onReviewJd:()=>void;
  onEditProfile:()=>void;
}
