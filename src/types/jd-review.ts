/** Frozen W8 contract. Offsets are JavaScript UTF-16 indices into the unchanged raw JD. */
export const JD_RULE_VERSION = "rules-1" as const;
export type JdCategory = "qualification" | "core_duty" | "preferred" | "background";
export interface JdSegment {
  id: string;
  start: number;
  end: number;
  /** Whole original line; child segments always point back to this source. */
  sourceStart: number;
  sourceEnd: number;
  suggestedCategory: JdCategory | null;
  category: JdCategory | null;
}
export interface JdDraftContent {
  ruleVersion: typeof JD_RULE_VERSION;
  rawText: string;
  segments: JdSegment[];
}
export interface JdDraft extends JdDraftContent {
  id: string;
  revision: number;
  confirmation: { revision: number; digest: string; confirmedAt: string } | null;
}
export type JdDraftCommand =
  | { action: "create"; rawText: string }
  | { action: "replace_text"; id: string; expectedRevision: number; rawText: string }
  | { action: "classify"; id: string; expectedRevision: number; segmentId: string; category: JdCategory | null }
  | { action: "split"; id: string; expectedRevision: number; segmentId: string; offset: number }
  | { action: "confirm"; id: string; expectedRevision: number; acknowledged: true }
  | { action: "delete"; id: string; expectedRevision: number };
export type JdReviewErrorCode = "INVALID_INPUT" | "JD_REVIEW_REQUIRED" | "JD_DRAFT_CONFLICT" | "NOT_FOUND" | "UNAUTHENTICATED" | "FORBIDDEN_ORIGIN" | "SERVICE_UNAVAILABLE";
export type JdReviewResult = { ok: true; data: JdDraft | null } | { ok: false; error: { code: JdReviewErrorCode; message: string } };
/** Demo implementation is memory-only; real adapter is a later Codex integration. */
export interface JdReviewAdapter { execute(command: JdDraftCommand): Promise<JdReviewResult> }
export interface JdReviewProps {
  initial: JdDraft | null;
  adapter: JdReviewAdapter & { load?: (id: string) => Promise<JdReviewResult> };
  mode?: "demo" | "saved";
  restoreId?: string | null;
  onSaved?: (draft: JdDraft | null) => void;
}
export const jdCategoryLabels: Record<JdCategory, string> = {
  qualification: "资格条件", core_duty: "核心职责", preferred: "优先／加分项", background: "背景信息",
};
