import { createHash, randomUUID } from "node:crypto";
import type { JdDraft } from "../../types/jd-review.ts";
import type { JdItem } from "../../types/job-copilot.ts";
import { contentOf, JdError, validateContent } from "./content.ts";
import { parseJdCommand, transitionDraft } from "./transition.ts";

export interface JdRepository {
  load(userId: string, id: string): Promise<JdDraft | null>;
  create(userId: string, draft: JdDraft): Promise<JdDraft>;
  replace(userId: string, expectedRevision: number, draft: JdDraft): Promise<JdDraft>;
  remove(userId: string, id: string, expectedRevision: number): Promise<void>;
}
export function draftDigest(draft: JdDraft): string {
  // PostgreSQL JSONB may reorder object keys. Hash explicit tuples, never property order.
  const canonical = ["jd-digest-v1", draft.id, draft.revision, draft.ruleVersion, draft.rawText,
    draft.segments.map((s) => [s.id, s.start, s.end, s.sourceStart, s.sourceEnd, s.suggestedCategory, s.category])];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
/** userId MUST come from requireUser(). Browser input cannot choose an owner. */
export function jdService(repository: JdRepository) {
  return {
    async execute(userId: string, input: unknown): Promise<JdDraft | null> {
      const command = parseJdCommand(input);
      const current = command.action === "create" ? null : await repository.load(userId, command.id);
      const next = transitionDraft(current, command, { id: randomUUID(), now: new Date().toISOString(), digest: draftDigest });
      if (command.action === "create") return repository.create(userId, next!);
      if (!next) { await repository.remove(userId, command.id, command.expectedRevision); return null; }
      return repository.replace(userId, command.expectedRevision, next);
    },
    async requirements(userId: string, id: string, revision: number): Promise<{ draft: JdDraft; jdText: string; jdItems: JdItem[] }> {
      const draft = await repository.load(userId, id);
      if (!draft) throw new JdError("NOT_FOUND");
      validateContent(contentOf(draft));
      if (draft.revision !== revision) throw new JdError("JD_DRAFT_CONFLICT");
      if (!draft.confirmation || draft.confirmation.revision !== revision || draft.confirmation.digest !== draftDigest(draft)
        || draft.segments.some((s) => s.category === null)) throw new JdError("JD_REVIEW_REQUIRED");
      const jdItems: JdItem[] = draft.segments.flatMap((s) => s.category && s.category !== "background"
        ? [{ jdId: s.id, kind: s.category, exactText: draft.rawText.slice(s.start, s.end) }] : []);
      if (!jdItems.length) throw new JdError("JD_REVIEW_REQUIRED");
      return { draft, jdText: draft.rawText, jdItems };
    },
  };
}
