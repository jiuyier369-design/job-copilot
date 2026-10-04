import type { JdDraftContent, JdSegment } from "../../types/jd-review.ts";
import { JD_RULE_VERSION } from "../../types/jd-review.ts";
import { array, integer, nullable, object, oneOf, text } from "../report/schema.ts";
export class JdError extends Error {
  readonly code: "INVALID_INPUT" | "JD_REVIEW_REQUIRED" | "JD_DRAFT_CONFLICT" | "NOT_FOUND";
  constructor(code: JdError["code"]) { super(code); this.code = code; }
}
const category = nullable(oneOf("qualification", "core_duty", "preferred", "background"));
const schema = object({ ruleVersion: oneOf(JD_RULE_VERSION), rawText: text, segments: array(object({
  id: text, start: integer, end: integer, sourceStart: integer, sourceEnd: integer,
  suggestedCategory: category, category,
})) });
/** Validate full non-whitespace coverage, provenance, order, IDs and exact source positions. */
export function validateContent(value: unknown): asserts value is JdDraftContent {
  const errors: string[] = []; schema(value, "draft", errors);
  if (errors.length) throw new JdError("INVALID_INPUT");
  const { rawText, segments } = value as JdDraftContent;
  if (!segments.length || new Set(segments.map((s) => s.id)).size !== segments.length) throw new JdError("INVALID_INPUT");
  let previousEnd = 0;
  for (const s of segments) {
    if (!/^JD\d+(?:\.\d+)*$/.test(s.id) || s.start < previousEnd || s.end <= s.start || s.end > rawText.length
      || s.sourceStart > s.start || s.sourceEnd < s.end || s.sourceEnd > rawText.length
      || /\S/.test(rawText.slice(previousEnd, s.start)) || !rawText.slice(s.start, s.end).trim()
      || /[\r\n]/.test(rawText.slice(s.sourceStart, s.sourceEnd))
      || (s.sourceStart > 0 && !/[\r\n]/.test(rawText[s.sourceStart - 1]))
      || (s.sourceEnd < rawText.length && !/[\r\n]/.test(rawText[s.sourceEnd]))) throw new JdError("INVALID_INPUT");
    // Do not split a UTF-16 surrogate pair.
    if ([s.start, s.end].some((n) => n > 0 && /[\uD800-\uDBFF]/.test(rawText[n - 1]) && /[\uDC00-\uDFFF]/.test(rawText[n] ?? ""))) throw new JdError("INVALID_INPUT");
    previousEnd = s.end;
  }
  if (/\S/.test(rawText.slice(previousEnd))) throw new JdError("INVALID_INPUT");
}
export function contentOf(value: JdDraftContent): JdDraftContent {
  return { ruleVersion: value.ruleVersion, rawText: value.rawText, segments: structuredClone(value.segments) };
}
export function splitSegment(content: JdDraftContent, id: string, offset: number): JdDraftContent {
  const next = contentOf(content);
  const index = next.segments.findIndex((s) => s.id === id);
  const segment = next.segments[index];
  if (!segment || !Number.isInteger(offset) || offset <= segment.start || offset >= segment.end) throw new JdError("INVALID_INPUT");
  // Splitting creates unclassified children so the user must revisit their meaning.
  const child = (suffix: string, start: number, end: number): JdSegment => ({ ...segment, id: `${id}.${suffix}`, start, end, category: null });
  next.segments.splice(index, 1, child("1", segment.start, offset), child("2", offset, segment.end));
  validateContent(next);
  return next;
}
