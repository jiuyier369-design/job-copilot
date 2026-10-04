import type { EvidencePlanOption } from './evidence-plan';

/** Local UI experiment only. Not a persistence, report or generation contract. */
export interface TrialProgress {
  viewed: number;
  pending: number;
  markedPending: number;
  checked: number;
  eligible: number;
  total: number;
  confirmed: boolean;
}
export interface SourceGuidance { why: string; boundary: string }
export type RemainingReason = 'PENDING_MARKED' | 'PENDING_UNMARKED' | 'SOURCE_REQUIRED' | 'SCOPE_REQUIRED' | 'REVIEW_REQUIRED' | 'CONFIRMATION_REQUIRED';
export interface RemainingReview { jdId: string; reason: RemainingReason; explanation: string }
export interface EvidencePlanGuidance {
  progress: TrialProgress;
  remaining: RemainingReview[];
  rowStates: Record<string, { viewed: boolean; deferredReason: string | null; eligible: boolean }>;
  sourceNotes: Record<string, SourceGuidance>;
  pendingReason: string;
  rowCanConfirm: boolean;
  rowBlocker: string | null;
  navigationWarning: boolean;
  notice: string | null;
  onPendingReason: (reason: string) => void;
  onMarkPending: () => void;
  onStay: () => void;
  onLeaveUnconfirmed: () => void;
}
export const sourceNoteKey = (option: Pick<EvidencePlanOption, 'actionKey' | 'evidenceType'>) =>
  `${option.actionKey}/${option.evidenceType}`;
