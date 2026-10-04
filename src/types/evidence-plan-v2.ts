import type { EvidenceType, FactContext, JdItemKind, ProfileData } from './job-copilot';
import type { EvidencePlanSource, ReviewChoice } from './evidence-plan';
import type { PlanOperationReceipt } from './evidence-plan-receipts';

export const SOURCE_POLICY_V2 = 'source-review/2' as const;
export interface TextSpan { start: number; end: number }
/** Server-owned, human/rule-reviewed subdivisions, not inferred by the browser or model. */
export interface V2Requirement extends TextSpan {
  jdId: string; kind: JdItemKind; exactText: string;
  conditions: (TextSpan & { key: string; basisKind: 'verified_date_rule' | 'unresolved' })[];
  sections: (TextSpan & { key: string; kind: 'task' | 'background' })[];
}
export interface V2Material {
  binding: EvidencePlanSource['binding'];
  jdText: string;
  requirements: V2Requirement[];
  profile: ProfileData;
}
export type V2SourceType = Exclude<EvidenceType, 'no_evidence'> | 'qualification' | 'background';
export interface V2SourceSelection extends TextSpan {
  factId: string; evidenceType: V2SourceType;
  /** Preferred mixed rows require an explicit server section key. Other rows use null. */
  sectionKey: string | null;
}
export interface V2ReviewedSource extends V2SourceSelection { sourceKey: string; quote: string; scene: FactContext }
export interface V2RowConfirmation {
  rowDigest: string; rowSourceDigest: string; materialDigest: string; confirmedAt: string;
}
export interface V2PlanRow {
  jdId: string; choice: ReviewChoice; sources: V2ReviewedSource[];
  existingAction: string; missingScope: string; pendingReason: string;
  confirmation: V2RowConfirmation | null;
}
export interface V2Plan {
  id: string; ownerId: string; revision: number; policyVersion: typeof SOURCE_POLICY_V2;
  material: V2Material; materialDigest: string; rows: V2PlanRow[];
  confirmation: { revision: number; sourceDigest: string; planDigest: string } | null;
}
export type V2PlanCommand =
  | { action: 'create_plan'; draftId: string; expectedDraftRevision: number; expectedProfileVersion: number }
  | { action: 'review_row'; expectedRevision: number; jdId: string; choice: ReviewChoice;
      selectedSources: V2SourceSelection[]; missingScope: string; pendingReason: string;
      intent: 'save_progress' | 'confirm_and_continue'; acknowledged: boolean }
  | { action: 'confirm_plan'; expectedRevision: number; acknowledged: true }
  | { action: 'delete'; expectedRevision: number };
export interface V2PlanEnvelope { contractVersion: 'evidence-plan-write/2'; operationId: string; command: V2PlanCommand }
export interface V2PlanResource extends Omit<V2Plan, 'ownerId'> {
  validity: 'valid' | 'stale' | 'unverified';
  status: 'draft' | 'confirmed' | 'stale';
  eligibleJdIds: string[];
}
export interface V2OperationResult { receipt: PlanOperationReceipt; resource: V2PlanResource | null }
