import type { ActionCategory, EvidenceType, FactContext, MaterialFitLevel, QualificationStatus } from './job-copilot.ts';
import type { TextSpan, V2Plan, V2SourceType } from './evidence-plan-v2.ts';
import type { JdDraft } from './jd-review.ts';

export const REPORT_V2_VERSIONS = Object.freeze({ generationContractVersion: 'analysis-request-v2',
  reportStructureVersion: '2.0.0', sourcePolicyVersion: 'source-review/2', slotManifestVersion: 'slot-manifest/2',
  validatorVersion: 'report-validator/2' } as const);
export type TaskLinkType = Exclude<EvidenceType, 'no_evidence'>;
export interface LinkSlot extends TextSpan {
  linkKey: string; factId: string; exactQuote: string; scene: FactContext;
  evidenceType: V2SourceType; reviewedScope: string; sectionKey: string | null;
}
export interface ConditionSlot {
  conditionKey: string; exactSourceSpan: TextSpan; exactText: string; status: QualificationStatus;
  factRefs: string[]; basisKind: 'verified_date_rule' | 'unresolved';
}
export interface PreferredSectionSlot {
  sectionKey: string; kind: 'task' | 'background'; exactSourceSpan: TextSpan; exactText: string;
  linkKeys: string[]; backgroundSupport: 'supported' | 'not_supported' | 'needs_confirmation' | null;
}
export interface RequirementSlot {
  slotKey: string; jdId: string; kind: 'qualification' | 'core_duty' | 'preferred'; exactText: string;
  sourceSpan: TextSpan; reviewChoice: 'limited_support' | 'no_clue'; links: LinkSlot[];
  reviewedExistingAction: string; reviewedMissingScope: string;
  conditionSlots: ConditionSlot[]; preferredSections: PreferredSectionSlot[];
}
export interface VerificationAnchor {
  verificationKey: string; origin: 'jd_unresolved_condition' | 'job_scope_question';
  basisSlotKeys: string[]; conditionKeys: string[]; priority: 'before_decision' | 'before_interview'; required: boolean;
}
export interface ReportV2Manifest {
  contractVersion: 'slot-manifest/2'; digest: string; planDigest: string; sourceDigest: string;
  materialDigest: string; slots: RequirementSlot[]; verificationAnchors: VerificationAnchor[];
  allowedActions: ActionCategory[]; inferenceKeys: string[];
  resumeAnchors: { suggestionKey: string; basisLinkKeys: string[] }[];
}
export interface NarrativeAnswer {
  slotKey: string; explanation: string; missingAspects: string[];
  links: { linkKey: string; connection: string; boundary: string }[];
  conditions: { conditionKey: string; explanation: string }[];
  preferredSections: { sectionKey: string; explanation: string }[];
}
export interface NarrativeBundle {
  contractVersion: 'narrative-bundle/2'; manifestDigest: string; answers: NarrativeAnswer[];
  materialFit: { level: MaterialFitLevel; summary: string; supportingSlotKeys: string[]; limitingSlotKeys: string[] };
  applicationAction: { category: ActionCategory; summary: string; conditionalNextAction: string | null; verificationKeys: string[] };
  inferences: { inferenceKey: string; basisSlotKeys: string[]; statement: string; uncertainty: string }[];
  verificationAnswers: { verificationKey: string; question: string; reason: string; askWhomOrHow: string; answerImpacts: string[] }[];
  resumeSuggestions: { suggestionKey: string; basisLinkKeys: string[]; suggestedWording: string; factualBoundary: string }[];
}
export interface ReportV2Task {
  choice: 'limited_support' | 'no_clue'; evidenceType: EvidenceType;
  evidenceLinks: (LinkSlot & { evidenceType: TaskLinkType; connection: string; boundary: string })[];
  reviewedExistingAction: string; reviewedMissingScope: string; explanation: string; missingAspects: string[];
}
export interface CompleteReportV2 {
  reportStructureVersion: '2.0.0'; manifestDigest: string;
  materialFit: NarrativeBundle['materialFit'];
  applicationAction: NarrativeBundle['applicationAction'] & { recommendationOnly: true };
  qualifications: { slotKey: string; jdId: string; exactText: string; status: QualificationStatus;
    conditions: (ConditionSlot & { explanation: string })[]; explanation: string; unresolvedConditionKeys: string[] }[];
  coreDuties: (ReportV2Task & { slotKey: string; jdId: string; exactText: string })[];
  preferredItems: { slotKey: string; jdId: string; exactText: string; isHardGate: false;
    sections: ({ sectionKey: string; exactSourceSpan: TextSpan; exactText: string; kind: 'task' } & ReportV2Task
      | { sectionKey: string; exactSourceSpan: TextSpan; exactText: string; kind: 'background';
        backgroundSupport: 'supported' | 'not_supported' | 'needs_confirmation'; educationFactRefs: string[]; explanation: string })[] }[];
  inferences: (NarrativeBundle['inferences'][number] & { kind: 'ai_inference' })[];
  verificationItems: (Omit<VerificationAnchor, 'required'> & NarrativeBundle['verificationAnswers'][number])[];
  resumeSuggestions: NarrativeBundle['resumeSuggestions'];
}
export interface ReportV2Metadata {
  provider: string; model: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  elapsedMs: number; finishReason: 'stop'; costEstimate: { currency: 'CNY' | 'USD'; amount: number } | null;
  pricingVersion: string | null;
}
/** Private immutable server record. A future owner-scoped response omits userId. No v1 record reuse. */
export interface ReportV2Record {
  id: string; userId: string; createdAt: string; company: string; jobTitle: string;
  city: string | null; direction: string | null; jdSourceUrl: string | null;
  versions: typeof REPORT_V2_VERSIONS & { promptVersion: string; testDataVersion: string | null };
  modelMetadata: ReportV2Metadata;
  provenance: { jdText: string; jdItems: V2Plan['material']['requirements'];
    jdConfirmationSnapshot: JdDraft;
    profileSnapshot: V2Plan['material']['profile']; profileVersion: number;
    planSnapshot: V2Plan; planRevision: number; sourceDigest: string; planDigest: string; slotManifestDigest: string };
  report: CompleteReportV2;
}
