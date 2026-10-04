import type { EvidencePlanOption, EvidenceReviewRow, ReviewedSelection } from './evidence-plan';
import type { EvidencePlanSource } from './evidence-plan';
import type { GenerateAnalysisRequest } from './api';
import type { QualificationStatus } from './job-copilot';

/** EP2A local proposal. No public API or database migration uses these types yet. */
export const PLAN_POLICY_VERSION = 'source-review/1' as const;
export interface CreatePlanRequest { draftId: string; expectedDraftRevision: number; expectedProfileVersion: number }
export interface PlanMaterial {
  binding: EvidencePlanSource['binding'];
  jdText: string;
  jdItems: EvidencePlanSource['jdItems'];
  profile: EvidencePlanSource['profile'];
  /** Server rules only; a user's source confirmation cannot set a qualification status. */
  qualificationDecisions: Record<string, QualificationStatus>;
}
export interface SourceProposal {
  jdId: string;
  factId: string;
  /** UTF-16 positions in the stored, unchanged profile statement. */
  start: number;
  end: number;
  evidenceType: ReviewedSelection['evidenceType'];
}
export interface PlanSourceEntry extends SourceProposal {
  key: string;
  quote: string;
  reviewed: boolean;
}
export interface PlanConfirmation {
  revision: number;
  sourceDigest: string;
  planDigest: string;
}
/** Internal only: owner and material come from the verified session/storage, never a browser body. */
export interface LocalPlanRecord {
  id: string;
  ownerId: string;
  revision: number;
  policyVersion: typeof PLAN_POLICY_VERSION;
  material: PlanMaterial;
  materialDigest: string;
  nextSourceNumber: number;
  sources: PlanSourceEntry[];
  rows: EvidenceReviewRow[];
  confirmation: PlanConfirmation | null;
}
export type PlanCommand =
  | { action: 'add_source'; expectedRevision: number; source: SourceProposal }
  | { action: 'confirm_source'; expectedRevision: number; key: string; acknowledged: true }
  | { action: 'remove_source'; expectedRevision: number; key: string }
  | { action: 'save_row'; expectedRevision: number; row: Omit<EvidenceReviewRow, 'checked'> }
  | { action: 'confirm_row'; expectedRevision: number; jdId: string }
  | { action: 'confirm_plan'; expectedRevision: number; acknowledged: true }
  | { action: 'delete'; expectedRevision: number };
export interface PlanResource {
  id: string;
  revision: number;
  status: 'draft' | 'confirmed' | 'stale';
  binding: PlanMaterial['binding'];
  sourceDigest: string;
  confirmation: PlanConfirmation | null;
  jdText: string;
  requirements: PlanMaterial['jdItems'];
  facts: PlanMaterial['profile']['facts'];
  /** Includes unresolved proposals so the owner can actually review/remove them. */
  sources: PlanSourceEntry[];
  rows: EvidenceReviewRow[];
  options: Record<string, EvidencePlanOption[]>;
}
/** Proposed new generation version; current GenerateAnalysisRequest and v1 routes stay unchanged. */
export interface GenerateWithPlanRequest extends GenerateAnalysisRequest {
  contractVersion: 'analysis-request-v2';
  planId: string;
  expectedPlanRevision: number;
}
export type PlanErrorCode = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'PLAN_CONFLICT'
  | 'PLAN_SOURCE_CHANGED' | 'SOURCE_REVIEW_REQUIRED' | 'PLAN_REVIEW_REQUIRED'
  | 'EVIDENCE_NOT_ALLOWED' | 'IDEMPOTENCY_CONFLICT' | 'SERVICE_UNAVAILABLE'
  | 'JD_REVIEW_REQUIRED' | 'PROFILE_REQUIRED' | 'JD_DRAFT_CONFLICT' | 'PROFILE_VERSION_CONFLICT';
