'use client';
import { useEffect, useReducer, useRef } from 'react';
import { evidencePlanDemoSource as source } from '@/fixtures/evidence-plan-demo';
import { fictionalSourceGuidance } from '@/fixtures/evidence-plan-guidance-demo';
import { checkReview, optionsFor } from '@/lib/evidence-plan/core';
import { guidedProgress, guidedTrialReducer, initialGuidedTrial, remainingReviews, rowConfirmationBlocker } from '@/lib/evidence-plan/guided-trial';
import { sourceNoteKey, type EvidencePlanGuidance, type TrialProgress } from '@/types/evidence-plan-guidance';
import type { EvidencePlanPanelProps } from '@/types/evidence-plan';
import { EvidencePlanPanel } from './evidence-plan-panel';

export function EvidencePlanGuidedTrialHost({ onProgress }: { onProgress: (value: TrialProgress) => void }) {
  const [state, dispatch] = useReducer((s: ReturnType<typeof initialGuidedTrial>, e: Parameters<typeof guidedTrialReducer>[3]) =>
    guidedTrialReducer(source, fictionalSourceGuidance, s, e), source, initialGuidedTrial);
  const container = useRef<HTMLDivElement>(null);
  const progress = guidedProgress(source, state);
  useEffect(() => { onProgress(guidedProgress(source, state)); }, [onProgress, state]);
  useEffect(() => {
    const target = state.navigationTarget !== null
      ? '[aria-label="切换前提醒"] button'
      : '[aria-label="当前要求核对详情"] h2';
    container.current?.querySelector<HTMLElement>(target)?.focus();
  }, [state.activeJdId, state.navigationTarget]);
  const options = Object.fromEntries(source.jdItems.map(i => [i.jdId, optionsFor(source, i.jdId)]));
  const activeRow = state.review.rows.find(r => r.jdId === state.activeJdId)!;
  let canConfirm = false;
  try { checkReview(source, { ...state.review, acknowledged: true }); canConfirm = true; } catch {}
  const guidance: EvidencePlanGuidance = {
    progress, remaining: remainingReviews(source, state), rowStates: Object.fromEntries(state.review.rows.map(r => [r.jdId, {
      viewed: state.viewed.includes(r.jdId), deferredReason: state.deferred[r.jdId] ?? null,
      eligible: r.checked && rowConfirmationBlocker(source, r) === null,
    }])),
    sourceNotes: Object.fromEntries(Object.values(options).flat().map(o => [sourceNoteKey(o), fictionalSourceGuidance[o.actionKey]])),
    pendingReason: state.pendingReason, rowCanConfirm: rowConfirmationBlocker(source, activeRow) === null,
    rowBlocker: rowConfirmationBlocker(source, activeRow), navigationWarning: state.navigationTarget !== null,
    notice: state.notice, onPendingReason: value => dispatch({ type: 'reason', value }),
    onMarkPending: () => dispatch({ type: 'defer' }), onStay: () => dispatch({ type: 'stay' }),
    onLeaveUnconfirmed: () => dispatch({ type: 'leave_unconfirmed' }),
  };
  const props: EvidencePlanPanelProps = {
    jdText: source.jdText, requirements: source.jdItems, facts: source.profile.facts, rows: state.review.rows,
    options, activeJdId: state.activeJdId, notice: '虚构交互改进原型：仅本页内存，不连接账号、模型或保存接口。',
    error: state.error, confirmed: state.confirmed, canConfirm: canConfirm && !state.confirmed,
    onActivate: id => dispatch({ type: 'activate', id }), onChoice: choice => dispatch({ type: 'choice', choice }),
    onSelection: (selection, selected) => dispatch({ type: 'selection', selection, selected }),
    onNote: (field, value) => dispatch({ type: 'note', field, value }),
    onCheckRow: () => dispatch({ type: 'confirm_next' }), onConfirm: () => dispatch({ type: 'confirm_plan' }),
  };
  return <div ref={container}>
    <h2>逐条核对 · 原句、来源与边界</h2>
    <EvidencePlanPanel {...props} guidance={guidance} />
  </div>;
}
