import type { JdDraft } from "../../types/jd-review.ts";

/** Frozen UI projection, not proof of server authorization. Never enables a model call. */
export function jdReviewView(draft: JdDraft | null, edited: boolean, pending: boolean) {
  const remaining = draft?.segments.filter((s) => s.category === null).length ?? 0;
  const hasRequirement = draft?.segments.some((s) => s.category !== null && s.category !== "background") ?? false;
  return {
    remaining,
    hasRequirement,
    canConfirm: !!draft && !edited && !pending && remaining === 0 && hasRequirement,
    isConfirmed: !!draft?.confirmation && draft.confirmation.revision === draft.revision && !edited && !pending,
    mustResegment: edited,
  };
}
