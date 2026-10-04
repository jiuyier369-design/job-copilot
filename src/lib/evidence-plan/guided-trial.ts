import type { EvidencePlanSource, EvidenceReviewRow, ReviewedSelection, ReviewChoice } from '../../types/evidence-plan.ts';
import type { RemainingReview, SourceGuidance, TrialProgress } from '../../types/evidence-plan-guidance.ts';
import { checkReview, checkRow, editReview, initialReview, optionsFor, type ReviewDemoState } from './core.ts';

/** Page-memory interaction experiment; source legality and confirmation still use existing checks. */
export interface GuidedTrialState extends ReviewDemoState {
  viewed: string[];
  deferred: Record<string, string>;
  pendingReason: string;
  navigationTarget: string | null;
  autoRange: Record<string, boolean>;
  notice: string | null;
}
export function initialGuidedTrial(source: EvidencePlanSource): GuidedTrialState {
  return { review: initialReview(source), activeJdId: source.jdItems[0].jdId, confirmed: false, error: null,
    viewed: [source.jdItems[0].jdId], deferred: {}, pendingReason: '', navigationTarget: null, autoRange: {}, notice: null };
}
const row = (s: GuidedTrialState) => s.review.rows.find(r => r.jdId === s.activeJdId)!;
export function rowConfirmationBlocker(source: EvidencePlanSource, r: EvidenceReviewRow): string | null {
  if (r.choice === 'pending') return '本条待核对，不能完成确认；可以说明原因后标记待核对并继续。';
  if (r.choice === 'limited_support' && !r.selections.length) return '请先选择至少一条允许的来源；没有合适来源可选暂无线索或待核对。';
  if (!r.missingScope.trim()) return '请核对范围提示或填写仍缺范围；无需重复抄写来源原句。';
  try { checkRow(source, r); return null; }
  catch { return '请检查来源、已有动作和范围；不允许把笔记当作新经历。'; }
}
export function guidedProgress(source: EvidencePlanSource, s: GuidedTrialState): TrialProgress {
  return { viewed: s.viewed.length, pending: s.review.rows.filter(r => r.choice === 'pending').length,
    markedPending: s.review.rows.filter(r => r.choice === 'pending' && s.deferred[r.jdId]).length,
    checked: s.review.rows.filter(r => r.checked).length,
    eligible: s.review.rows.filter(r => r.checked && rowConfirmationBlocker(source, r) === null).length,
    total: source.jdItems.length, confirmed: s.confirmed };
}
/** Current-state explanation only; never reconstructs a user's past clicks or intentions. */
export function remainingReviews(source: EvidencePlanSource, s: GuidedTrialState): RemainingReview[] {
  return s.review.rows.flatMap(r => {
    const blocker = rowConfirmationBlocker(source, r);
    if (r.checked && blocker === null) return [];
    const reason = r.choice === 'pending' ? s.deferred[r.jdId] ? 'PENDING_MARKED' : 'PENDING_UNMARKED'
      : r.choice === 'limited_support' && !r.selections.length ? 'SOURCE_REQUIRED'
      : !r.missingScope.trim() ? 'SCOPE_REQUIRED'
      : blocker ? 'REVIEW_REQUIRED' : 'CONFIRMATION_REQUIRED';
    const explanation = reason === 'PENDING_MARKED' ? `待核对：${s.deferred[r.jdId]}`
      : reason === 'PENDING_UNMARKED' ? '当前为待核对，尚未标记原因；可说明原因后继续。'
      : reason === 'SOURCE_REQUIRED' ? '有限支持尚未选择允许来源；无合适来源可选暂无线索或待核对。'
      : reason === 'SCOPE_REQUIRED' ? '支持范围尚未核对或填写。'
      : reason === 'REVIEW_REQUIRED' ? '当前来源或范围未通过核对，需要检查。'
      : '当前内容可核对，但尚未完成明确确认；不推断原因。';
    return [{ jdId: r.jdId, reason, explanation }];
  });
}
function move(s: GuidedTrialState, id: string): GuidedTrialState {
  return { ...s, activeJdId: id, viewed: s.viewed.includes(id) ? s.viewed : [...s.viewed, id],
    pendingReason: s.deferred[id] ?? '', navigationTarget: null, error: null };
}
function next(source: EvidencePlanSource, s: GuidedTrialState): string {
  return s.navigationTarget ?? source.jdItems[Math.min(source.jdItems.length - 1,
    source.jdItems.findIndex(i => i.jdId === s.activeJdId) + 1)].jdId;
}
function patch(s: GuidedTrialState, value: Parameters<typeof editReview>[1]): GuidedTrialState {
  const deferred = { ...s.deferred }; delete deferred[s.activeJdId];
  return { ...s, ...editReview(s, value), deferred, notice: null };
}
export type GuidedTrialEvent =
  | { type: 'activate'; id: string }
  | { type: 'choice'; choice: ReviewChoice }
  | { type: 'selection'; selection: ReviewedSelection; selected: boolean }
  | { type: 'note'; field: 'existingAction' | 'missingScope'; value: string }
  | { type: 'reason'; value: string }
  | { type: 'defer' | 'confirm_next' | 'confirm_plan' | 'stay' | 'leave_unconfirmed' };
export function guidedTrialReducer(source: EvidencePlanSource, notes: Record<string, SourceGuidance>,
  s: GuidedTrialState, event: GuidedTrialEvent): GuidedTrialState {
  switch (event.type) {
    case 'activate': {
      if (!source.jdItems.some(i => i.jdId === event.id) || event.id === s.activeJdId) return s;
      if (!row(s).checked && !s.deferred[s.activeJdId]) return { ...s, navigationTarget: event.id, notice: null };
      return move(s, event.id);
    }
    case 'stay': return { ...s, navigationTarget: null };
    case 'leave_unconfirmed': return s.navigationTarget ? move(s, s.navigationTarget) : s;
    case 'reason': return { ...s, pendingReason: event.value.slice(0, 300) };
    case 'choice': {
      const r = row(s); const value: Parameters<typeof editReview>[1] = { choice: event.choice };
      if (event.choice === 'no_clue' && (!r.missingScope.trim() || s.autoRange[r.jdId]))
        value.missingScope = '当前画像暂未选到与本要求相关的事实；不代表没有经历，请回查或补充画像。';
      if (event.choice === 'limited_support' && s.autoRange[r.jdId]) value.missingScope = '';
      const changed = patch(s, value);
      return { ...changed, pendingReason: '', autoRange: { ...s.autoRange,
        [r.jdId]: value.missingScope !== undefined || Boolean(s.autoRange[r.jdId]) } };
    }
    case 'selection': {
      const r = row(s), options = optionsFor(source, r.jdId);
      if (r.choice !== 'limited_support' || !options.some(o => o.actionKey === event.selection.actionKey && o.evidenceType === event.selection.evidenceType))
        return { ...s, error: '请选择本条允许的来源，不能自行升级证据类型。' };
      const selections = r.selections.filter(x => x.actionKey !== event.selection.actionKey);
      if (event.selected) selections.push(event.selection);
      const value: Parameters<typeof editReview>[1] = { selections,
        existingAction: selections.map(x => source.actions.find(a => a.key === x.actionKey)!.quote).join('；') };
      if (!r.missingScope.trim() || s.autoRange[r.jdId]) value.missingScope = [...new Set(selections.map(x =>
        notes[x.actionKey]?.boundary ?? '只支持原句所述动作；其它范围仍需核对。'))].join('；');
      const changed = patch(s, value);
      return { ...changed, autoRange: { ...s.autoRange, [r.jdId]: value.missingScope !== undefined || Boolean(s.autoRange[r.jdId]) } };
    }
    case 'note': return { ...patch(s, { [event.field]: event.value }), autoRange: { ...s.autoRange, [s.activeJdId]: false } };
    case 'defer': {
      if (row(s).choice !== 'pending' || !s.pendingReason.trim()) return { ...s, error: '请先选择待核对，并说明暂时不能确认的原因。' };
      const changed = patch(s, { choice: 'pending' });
      return move({ ...changed, deferred: { ...changed.deferred, [s.activeJdId]: s.pendingReason.trim() },
        notice: '已标记待核对，输入保留；不计入本条确认或整份可用进度。' }, next(source, s));
    }
    case 'confirm_next': {
      const blocker = rowConfirmationBlocker(source, row(s));
      if (blocker) return { ...s, error: blocker };
      const changed: GuidedTrialState = { ...s, confirmed: false, error: null,
        review: { ...s.review, planRevision: s.review.planRevision + 1, acknowledged: false,
          rows: s.review.rows.map(r => r.jdId === s.activeJdId ? { ...r, checked: true } : r) },
        notice: '已完成本条确认；修改来源、选择或范围后需重新确认。' };
      return move(changed, next(source, s));
    }
    case 'confirm_plan': {
      try { checkReview(source, { ...s.review, acknowledged: true }); }
      catch { return { ...s, error: '还有待核对或未完成确认的条目，不能确认整份计划。' }; }
      return { ...s, confirmed: true, error: null, review: { ...s.review, acknowledged: true } };
    }
  }
}
