import type { EvidenceType, FactContext, JdItem, ProfileData, QualificationStatus } from './job-copilot';

/** Prototype only. Not a replacement for the public generation request or report schema. */
export type ReviewChoice = 'limited_support' | 'no_clue' | 'pending';
export type LinkType = Exclude<EvidenceType, 'no_evidence'>;
export interface EvidenceAction {
  key: string;
  factId: string;
  quote: string;
  capability: string;
}
export interface RequirementScope {
  jdId: string;
  capabilities: string[];
  /** Only reliable, server-established qualification decisions; never inferred from a user click. */
  qualificationStatus?: QualificationStatus;
}
export interface EvidencePlanSource {
  binding: { draftId: string; draftRevision: number; confirmationDigest: string; profileVersion: number };
  jdText: string;
  jdItems: JdItem[];
  profile: ProfileData;
  /** Curated source actions for this fictional prototype, NOT an implemented arbitrary-text classifier. */
  actions: EvidenceAction[];
  scopes: RequirementScope[];
}
export interface ReviewedSelection { actionKey: string; evidenceType: LinkType | 'qualification' }
export interface EvidenceReviewRow {
  jdId: string;
  choice: ReviewChoice;
  selections: ReviewedSelection[];
  existingAction: string;
  missingScope: string;
  checked: boolean;
}
export interface EvidenceReviewInput {
  contractVersion: 'evidence-plan-prototype/1';
  binding: EvidencePlanSource['binding'];
  planRevision: number;
  rows: EvidenceReviewRow[];
  acknowledged: boolean;
}
export interface AnswerLinkSlot {
  linkKey: string;
  factId: string;
  actionQuote: string;
  context: FactContext;
  evidenceType: LinkType | 'qualification';
}
export interface AnswerSlot {
  slotKey: string;
  jdId: string;
  kind: JdItem['kind'];
  exactText: string;
  choice: Exclude<ReviewChoice, 'pending'>;
  qualificationStatus: QualificationStatus | null;
  overallEvidenceType: EvidenceType | null;
  links: AnswerLinkSlot[];
  existingAction: string;
  missingScope: string;
}
export interface CompiledEvidencePlan {
  contractVersion: EvidenceReviewInput['contractVersion'];
  sourceDigest: string;
  planDigest: string;
  input: EvidenceReviewInput;
  slots: AnswerSlot[];
}
/** Model cannot output JD IDs, fact IDs, labels, status, overview, actions or resume suggestions. */
export interface SlotAnswer {
  slotKey: string;
  explanation: string;
  links: { linkKey: string; connection: string; boundary: string }[];
  missingAspects: string[];
}
export interface EvidencePlanModelOutput { planDigest: string; answers: SlotAnswer[] }

export interface EvidencePlanOption extends ReviewedSelection {
  label: string;
  factStatement: string;
  scene: FactContext;
  actionQuote: string;
}
export interface EvidencePlanPanelProps {
  jdText: string;
  rows: EvidenceReviewRow[];
  requirements: JdItem[];
  facts: ProfileData['facts'];
  options: Record<string, EvidencePlanOption[]>;
  activeJdId: string;
  notice: string;
  error: string | null;
  canConfirm: boolean;
  confirmed: boolean;
  onActivate: (jdId: string) => void;
  onChoice: (choice: ReviewChoice) => void;
  onSelection: (selection: ReviewedSelection, selected: boolean) => void;
  onNote: (field: 'existingAction' | 'missingScope', value: string) => void;
  onCheckRow: () => void;
  onConfirm: () => void;
}
