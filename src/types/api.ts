import type { CreateAnalysisInput, ProfileData } from "./job-copilot";

/** Frozen wire contract; auth/profile/JD and analysis generation/run-query are implemented.
 * Report reading is connected; DeepSeek adapter is opt-in and not yet charged-tested. */
export type ApiErrorCode =
  | "UNAUTHENTICATED" | "INVALID_INPUT" | "FORBIDDEN_ORIGIN"
  | "PROFILE_REQUIRED" | "PROFILE_VERSION_CONFLICT" | "NOT_FOUND"
  | "ANALYSIS_IN_USE" | "JD_REVIEW_REQUIRED" | "JD_DRAFT_CONFLICT" | "REPORT_INVALID"
  | "RATE_LIMITED" | "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT"
  | "SERVICE_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "ANALYSIS_IN_PROGRESS";
export type ApiResult<T> = { ok: true; data: T } | {
  ok: false; error: { code: ApiErrorCode; message: string; issues?: string[] };
};
export interface ProfileResource { profile: ProfileData; version: number; updatedAt: string }
export interface SaveProfileRequest { profile: ProfileData; expectedVersion: number | null }
/** New generation accepts a server-confirmed draft reference, never browser JD items. */
export interface GenerateAnalysisRequest extends Omit<CreateAnalysisInput, "jdText"> {
  requestId: string;
  expectedProfileVersion: number;
  draftId: string;
  expectedDraftRevision: number;
}
export type AnalysisRunStatus = "processing" | "completed" | "failed" | "uncertain";
export type AnalysisFailureCode = "MODEL_REJECTED" | "REPORT_INVALID" | "MODEL_RESULT_UNCERTAIN"
  | "SAVE_RESULT_UNCERTAIN" | "JD_DRAFT_CONFLICT" | "PROFILE_VERSION_CONFLICT" | "JD_REVIEW_REQUIRED" | "NOT_FOUND" | "PROFILE_REQUIRED";
/** Safe projection only: no owner, fingerprint, source snapshots or model input. */
export interface AnalysisRunResource {
  requestId: string;
  status: AnalysisRunStatus;
  analysisId: string | null;
  failureCode: AnalysisFailureCode | null;
  startedAt: string;
  finishedAt: string | null;
}
export type GenerateAnalysisResult = ApiResult<AnalysisRunResource> & { code?: "ANALYSIS_IN_PROGRESS" };
export interface ProfileEditorProps {
  initial: ProfileResource | null;
  onSave: (input: SaveProfileRequest) => Promise<ApiResult<ProfileResource>>;
}
