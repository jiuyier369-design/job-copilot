import type { JdDraft, JdDraftCommand } from "../../types/jd-review.ts";
import { boolean, integer, nullable, object, oneOf, text } from "../report/schema.ts";
import { contentOf, JdError, splitSegment, validateContent } from "./content.ts";
import { segmentJd } from "./segment.ts";

export function parseJdCommand(input: unknown): JdDraftCommand {
  if (!input || typeof input !== "object") throw new JdError("INVALID_INPUT");
  const action = (input as { action?: string }).action;
  const base = { action: oneOf(action ?? ""), id: text, expectedRevision: integer };
  const schemas = {
    create: object({ action: oneOf("create"), rawText: text }),
    replace_text: object({ ...base, rawText: text }),
    classify: object({ ...base, segmentId: text, category: nullable(oneOf("qualification", "core_duty", "preferred", "background")) }),
    split: object({ ...base, segmentId: text, offset: integer }),
    confirm: object({ ...base, acknowledged: boolean }),
    delete: object(base),
  };
  if (!action || !Object.hasOwn(schemas, action)) throw new JdError("INVALID_INPUT");
  const errors: string[] = [];
  schemas[action as keyof typeof schemas](input, "command", errors);
  if (errors.length) throw new JdError("INVALID_INPUT");
  const command = input as JdDraftCommand;
  if (command.action !== "create" && (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || command.expectedRevision >= 2147483647
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.id))) throw new JdError("INVALID_INPUT");
  if (command.action === "confirm" && command.acknowledged !== true) throw new JdError("JD_REVIEW_REQUIRED");
  return command;
}

/** Pure transition. Confirmation signing is supplied by the server; demo signatures are never trusted. */
export function transitionDraft(current: JdDraft | null, command: JdDraftCommand,
  options: { id: string; now: string; digest: (draft: JdDraft) => string }): JdDraft | null {
  if (command.action === "create") {
    const content = segmentJd(command.rawText); validateContent(content);
    return { ...content, id: options.id, revision: 1, confirmation: null };
  }
  if (!current || current.id !== command.id) throw new JdError("NOT_FOUND");
  if (current.revision !== command.expectedRevision) throw new JdError("JD_DRAFT_CONFLICT");
  validateContent(contentOf(current));
  if (command.action === "delete") return null;
  const next: JdDraft = { ...structuredClone(current), revision: current.revision + 1, confirmation: null };
  switch (command.action) {
    case "replace_text": Object.assign(next, segmentJd(command.rawText)); break;
    case "classify": {
      const segment = next.segments.find((s) => s.id === command.segmentId);
      if (!segment) throw new JdError("INVALID_INPUT");
      segment.category = command.category; break;
    }
    case "split": Object.assign(next, splitSegment(next, command.segmentId, command.offset)); break;
    case "confirm": {
      if (next.segments.some((s) => s.category === null) || !next.segments.some((s) => s.category !== "background")) throw new JdError("JD_REVIEW_REQUIRED");
      next.confirmation = { revision: next.revision, digest: options.digest(next), confirmedAt: options.now }; break;
    }
  }
  validateContent(contentOf(next));
  return next;
}
