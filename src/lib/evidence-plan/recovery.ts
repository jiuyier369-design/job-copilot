import type { EvidenceReviewRow } from '../../types/evidence-plan.ts';
import type { PlanErrorCode, PlanResource } from '../../types/evidence-plan-protocol.ts';

export interface PlanEditorState {
  input: EvidenceReviewRow[];
  saved: PlanResource | null;
  dirty: boolean;
  busy: boolean;
  editSerial: number;
  submittedSerial: number;
  needsDiscardConfirmation: boolean;
  error: PlanErrorCode | null;
}
export function planEditor(resource: PlanResource | null): PlanEditorState {
  return { input: structuredClone(resource?.rows ?? []), saved: structuredClone(resource), dirty: false,
    busy: false, editSerial: 0, submittedSerial: 0, needsDiscardConfirmation: false, error: null };
}
export type PlanEditorEvent =
  | { type: 'edit'; rows: EvidenceReviewRow[] }
  | { type: 'start_save' }
  | { type: 'request_reload'; discardConfirmed: boolean }
  | { type: 'loaded'; resource: PlanResource; discardConfirmed: boolean }
  | { type: 'saved'; resource: PlanResource }
  | { type: 'error'; code: PlanErrorCode };
/** No network or persistence. The future Host chooses when to make a single explicit request. */
export function planEditorReducer(state: PlanEditorState, event: PlanEditorEvent): PlanEditorState {
  switch (event.type) {
    case 'edit': return { ...state, input: structuredClone(event.rows), dirty: true, editSerial: state.editSerial + 1 };
    case 'start_save': return { ...state, busy: true, submittedSerial: state.editSerial, error: null };
    case 'request_reload': return state.dirty && !event.discardConfirmed
      ? { ...state, needsDiscardConfirmation: true }
      : { ...state, busy: true, submittedSerial: state.editSerial, needsDiscardConfirmation: false };
    case 'loaded': {
      if ((state.dirty && !event.discardConfirmed) || state.editSerial !== state.submittedSerial)
        return { ...state, busy: false, needsDiscardConfirmation: true };
      return planEditor(event.resource);
    }
    case 'saved': return state.editSerial === state.submittedSerial
      ? planEditor(event.resource)
      : { ...state, saved: structuredClone(event.resource), busy: false }; // In-flight edits never disappear.
    case 'error': return { ...state, busy: false, error: event.code }; // Keep input AND last successful read.
  }
}
export const planRecoveryText: Record<PlanErrorCode, string> = {
  UNAUTHENTICATED: '登录已失效，当前输入保留。请在新标签页登录，然后主动重新读取。',
  NOT_FOUND: '计划不存在或已删除，当前输入保留。返回 JD 核对后可建立新计划。',
  INVALID_INPUT: '请检查输入，当前内容不会被清空。',
  PLAN_CONFLICT: '服务器已有新版本。保留当前输入，请确认后重新读取；不会自动覆盖。',
  PLAN_SOURCE_CHANGED: 'JD、画像或来源目录已变化，旧确认不能用于生成。请重新核对并建立新绑定。',
  SOURCE_REVIEW_REQUIRED: '来源动作尚未全部核对，请核对或移除未确认的建议。',
  PLAN_REVIEW_REQUIRED: '请逐条核对，再明确确认整份计划。',
  EVIDENCE_NOT_ALLOWED: '该来源或证据类型不在允许范围内，不会自动改标签。',
  IDEMPOTENCY_CONFLICT: '该请求编号已用于另一份计划或分析。重新生成必须明确创建新请求编号。',
  SERVICE_UNAVAILABLE: '暂时无法确认服务器结果，当前输入保留。先读取同一计划的状态，不补发写入。',
  JD_REVIEW_REQUIRED: '请先核对并确认 JD 要求清单，当前输入保留。',
  PROFILE_REQUIRED: '请先保存画像事实，当前输入保留。',
  JD_DRAFT_CONFLICT: 'JD 已更新，请重新读取并核对。不会自动覆盖当前输入。',
  PROFILE_VERSION_CONFLICT: '画像已更新，请重新核对来源。不会自动覆盖当前输入。',
};
