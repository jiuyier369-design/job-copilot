/** A1 contract. Changes to these exported shapes require Codex review. */
import type { JdDraft } from "./jd-review";

export const REPORT_STRUCTURE_VERSION = "1.0.0" as const;
export const PROFILE_STRUCTURE_VERSION = "1.0.0" as const;

export type FactCategory =
  | "education"
  | "work"
  | "project"
  | "skill"
  | "award"
  | "preference"
  | "constraint";

export type FactContext =
  | "education"
  | "formal_work"
  | "entrepreneurship"
  | "campus"
  | "competition"
  | "personal_project"
  | "self_report";

export interface ProfileFact {
  factId: string;
  category: FactCategory;
  context: FactContext;
  statement: string;
  period?: string;
  organization?: string;
}

export interface ProfileData {
  structureVersion: typeof PROFILE_STRUCTURE_VERSION;
  targetDirections: string[];
  facts: ProfileFact[];
}

export type JdItemKind = "qualification" | "core_duty" | "preferred";

export interface JdItem {
  jdId: string;
  kind: JdItemKind;
  exactText: string;
}

export type QualificationStatus = "meets" | "does_not_meet" | "needs_confirmation";
export type EvidenceType =
  | "same_task"
  | "transferable"
  | "personal_practice"
  | "no_evidence";

export interface QualificationAssessment {
  jdId: string;
  status: QualificationStatus;
  factIds: string[];
  explanation: string;
}

export interface EvidenceLink {
  evidenceType: Exclude<EvidenceType, "no_evidence">;
  factIds: string[];
  connection: string;
  boundary: string;
}

export interface TaskAssessment {
  jdId: string;
  /** Empty links mean no evidence in the current profile snapshot. */
  evidenceType: EvidenceType;
  evidenceLinks: EvidenceLink[];
  missingAspects: string[];
  needsUserConfirmation: boolean;
  explanation: string;
}

export interface Inference {
  jdIds: string[];
  statement: string;
  uncertainty: string;
}

export interface ResumeSuggestion {
  jdIds: string[];
  factIds: string[];
  suggestedWording: string;
  factualBoundary: string;
}

export interface VerificationItem {
  jdIds: string[];
  question: string;
  reason: string;
  askWhomOrHow: string;
  answerImpacts: string[];
}

export type MaterialFitLevel = "strong" | "partial" | "weak";
export type ActionCategory =
  | "prioritize"
  | "verify_first"
  | "try_with_weak_evidence"
  | "explicit_hard_gate";

export interface Report {
  materialFit: {
    level: MaterialFitLevel;
    summary: string;
    supportingJdIds: string[];
    limitingJdIds: string[];
  };
  applicationAction: {
    category: ActionCategory;
    summary: string;
    conditionalNextAction?: string;
    verificationItemIndexes: number[];
  };
  qualifications: QualificationAssessment[];
  coreDuties: TaskAssessment[];
  preferredItems: TaskAssessment[];
  inferences: Inference[];
  resumeSuggestions: ResumeSuggestion[];
  verificationItems: VerificationItem[];
}

export interface JobAnalysisRecord {
  id: string;
  userId: string;
  company: string;
  jobTitle: string;
  city: string | null;
  direction: string | null;
  jdText: string;
  jdSourceUrl: string | null;
  jdItems: JdItem[];
  /** NULL for historical/display records created before confirmed-JD persistence. */
  jdConfirmationSnapshot: JdDraft | null;
  profileVersion: number;
  profileSnapshot: ProfileData;
  report: Report;
  reportStructureVersion: typeof REPORT_STRUCTURE_VERSION;
  promptVersion: string;
  modelProvider: string;
  modelName: string;
  testDataVersion: string | null;
  createdAt: string;
}

export type ApplicationStatus =
  | "preparing"
  | "applied"
  | "assessment"
  | "interview"
  | "offer"
  | "closed";

export interface ApplicationRecord {
  id: string;
  userId: string;
  analysisId: string | null;
  company: string;
  jobTitle: string;
  city: string | null;
  direction: string | null;
  appliedOn: string | null;
  status: ApplicationStatus;
  nextAction: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Client input contracts intentionally omit userId; the server gets it from Auth. */
export type SaveProfileInput = ProfileData;
export type CreateAnalysisInput = Pick<
  JobAnalysisRecord,
  "company" | "jobTitle" | "city" | "direction" | "jdText" | "jdSourceUrl"
>;
export type SaveApplicationInput = Pick<
  ApplicationRecord,
  | "analysisId"
  | "company"
  | "jobTitle"
  | "city"
  | "direction"
  | "appliedOn"
  | "status"
  | "nextAction"
  | "notes"
>;
