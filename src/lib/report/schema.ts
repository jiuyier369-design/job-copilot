// Small dependency-free runtime schema. Model/browser data starts as unknown.
export type Check = (value: unknown, path: string, errors: string[]) => void;
export const text: Check = (v, p, e) => {
  if (typeof v !== "string" || !v.trim() || v.length > 20000) e.push(`${p}: expected non-empty text (max 20000)`);
};
export const boolean: Check = (v, p, e) => { if (typeof v !== "boolean") e.push(`${p}: expected boolean`); };
export const integer: Check = (v, p, e) => { if (!Number.isInteger(v) || Number(v) < 0) e.push(`${p}: expected non-negative integer`); };
export const oneOf = (...values: string[]): Check => (v, p, e) => {
  if (typeof v !== "string" || !values.includes(v)) e.push(`${p}: invalid enum`);
};
export const optional = (check: Check): Check => (v, p, e) => { if (v !== undefined) check(v, p, e); };
export const nullable = (check: Check): Check => (v, p, e) => { if (v !== null) check(v, p, e); };
export const array = (check: Check): Check => (v, p, e) => {
  if (!Array.isArray(v) || v.length > 500) { e.push(`${p}: expected array (max 500)`); return; }
  v.forEach((item, i) => check(item, `${p}[${i}]`, e));
};
export const object = (fields: Record<string, Check>): Check => (v, p, e) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) { e.push(`${p}: expected object`); return; }
  const value = v as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!Object.hasOwn(fields, key)) e.push(`${p}.${key}: unknown field`);
  for (const [key, check] of Object.entries(fields)) check(value[key], `${p}.${key}`, e);
};
export const strings = array(text);
const evidence = oneOf("same_task", "transferable", "personal_practice", "no_evidence");
const task = object({
  jdId: text, evidenceType: evidence,
  evidenceLinks: array(object({
    evidenceType: oneOf("same_task", "transferable", "personal_practice"),
    factIds: strings, connection: text, boundary: text,
  })),
  missingAspects: strings, needsUserConfirmation: boolean, explanation: text,
});
export const profileSchema = object({
  structureVersion: oneOf("1.0.0"), targetDirections: strings,
  facts: array(object({
    factId: text,
    category: oneOf("education", "work", "project", "skill", "award", "preference", "constraint"),
    context: oneOf("education", "formal_work", "entrepreneurship", "campus", "competition", "personal_project", "self_report"),
    statement: text, period: optional(text), organization: optional(text),
  })),
});
export const jdItemsSchema = array(object({ jdId: text, kind: oneOf("qualification", "core_duty", "preferred"), exactText: text }));
export const reportSchema = object({
  materialFit: object({ level: oneOf("strong", "partial", "weak"), summary: text, supportingJdIds: strings, limitingJdIds: strings }),
  applicationAction: object({
    category: oneOf("prioritize", "verify_first", "try_with_weak_evidence", "explicit_hard_gate"),
    summary: text, conditionalNextAction: optional(text), verificationItemIndexes: array(integer),
  }),
  qualifications: array(object({ jdId: text, status: oneOf("meets", "does_not_meet", "needs_confirmation"), factIds: strings, explanation: text })),
  coreDuties: array(task), preferredItems: array(task),
  inferences: array(object({ jdIds: strings, statement: text, uncertainty: text })),
  resumeSuggestions: array(object({ jdIds: strings, factIds: strings, suggestedWording: text, factualBoundary: text })),
  verificationItems: array(object({ jdIds: strings, question: text, reason: text, askWhomOrHow: text, answerImpacts: strings })),
});
