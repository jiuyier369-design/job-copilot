import type { CompleteReportV2, NarrativeBundle, ReportV2Record } from '../../types/report-v2.ts';
import { REPORT_V2_VERSIONS } from '../../types/report-v2.ts';
import { array, boolean, integer, nullable, object, oneOf, profileSchema, type Check } from '../report/schema.ts';
import { checkV2Material, safeUuid } from '../evidence-plan-v2/domain.ts';
import { rejectV2 } from './manifest.ts';

export const V2_LIMITS = Object.freeze({ narrativeBytes: 1048576, recordBytes: 2097152, proseChars: 4000, keyChars: 160 });
const bounded = (max: number): Check => (v, _p, e) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) e.push('STRUCTURE');
};
const key = bounded(V2_LIMITS.keyChars), prose = bounded(V2_LIMITS.proseChars), keys = array(key), proseList = array(prose);
const literal = (expected: unknown): Check => (v, _p, e) => { if (v !== expected) e.push('STRUCTURE'); };
const nonnegative: Check = (v, _p, e) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) e.push('STRUCTURE'); };
const safeInteger: Check = (v, _p, e) => { if (!Number.isSafeInteger(v) || Number(v) < 0) e.push('STRUCTURE'); };
const status = oneOf('meets', 'does_not_meet', 'needs_confirmation');
const span = object({ start: safeInteger, end: safeInteger });
const materialFit = object({ level: oneOf('strong', 'partial', 'weak'), summary: prose, supportingSlotKeys: keys, limitingSlotKeys: keys });
const actionFields = { category: oneOf('prioritize', 'verify_first', 'try_with_weak_evidence', 'explicit_hard_gate'), summary: prose,
  conditionalNextAction: nullable(prose), verificationKeys: keys };
const inferenceFields = { inferenceKey: key, basisSlotKeys: keys, statement: prose, uncertainty: prose };
const verificationFields = { verificationKey: key, question: prose, reason: prose, askWhomOrHow: prose, answerImpacts: proseList };
const resume = object({ suggestionKey: key, basisLinkKeys: keys, suggestedWording: prose, factualBoundary: prose });
const narrativeSchema = object({ contractVersion: literal('narrative-bundle/2'), manifestDigest: key,
  answers: array(object({ slotKey: key, explanation: prose, missingAspects: proseList,
    links: array(object({ linkKey: key, connection: prose, boundary: prose })),
    conditions: array(object({ conditionKey: key, explanation: prose })),
    preferredSections: array(object({ sectionKey: key, explanation: prose })) })),
  materialFit, applicationAction: object(actionFields), inferences: array(object(inferenceFields)),
  verificationAnswers: array(object(verificationFields)), resumeSuggestions: array(resume) });
const linkFields = { linkKey: key, factId: key, exactQuote: bounded(20000), start: safeInteger, end: safeInteger,
  scene: oneOf('education', 'formal_work', 'entrepreneurship', 'campus', 'competition', 'personal_project', 'self_report'),
  evidenceType: oneOf('same_task', 'transferable', 'personal_practice'), reviewedScope: bounded(800), sectionKey: nullable(key), connection: prose, boundary: prose };
const taskFields = { choice: oneOf('limited_support', 'no_clue'), evidenceType: oneOf('same_task', 'transferable', 'personal_practice', 'no_evidence'),
  evidenceLinks: array(object(linkFields)), reviewedExistingAction: (v, _p, e) => { if (typeof v !== 'string' || v.length > 200000) e.push('STRUCTURE'); },
  reviewedMissingScope: bounded(800), explanation: prose, missingAspects: proseList } satisfies Record<string, Check>;
const conditionFields = { conditionKey: key, exactSourceSpan: span, exactText: bounded(20000), status, factRefs: keys,
  basisKind: oneOf('verified_date_rule', 'unresolved'), explanation: prose };
const preferredSection: Check = (v, p, e) => {
  const kind = v && typeof v === 'object' ? (v as { kind?: string }).kind : undefined;
  const base = { sectionKey: key, exactSourceSpan: span, exactText: bounded(20000) };
  if (kind === 'task') object({ ...base, kind: literal('task'), ...taskFields })(v, p, e);
  else if (kind === 'background') object({ ...base, kind: literal('background'), backgroundSupport: oneOf('supported', 'not_supported', 'needs_confirmation'),
    educationFactRefs: keys, explanation: prose })(v, p, e);
  else e.push('STRUCTURE');
};
const completeSchema = object({ reportStructureVersion: literal('2.0.0'), manifestDigest: key, materialFit,
  applicationAction: object({ ...actionFields, recommendationOnly: literal(true) }),
  qualifications: array(object({ slotKey: key, jdId: key, exactText: bounded(20000), status,
    conditions: array(object(conditionFields)), explanation: prose, unresolvedConditionKeys: keys })),
  coreDuties: array(object({ slotKey: key, jdId: key, exactText: bounded(20000), ...taskFields })),
  preferredItems: array(object({ slotKey: key, jdId: key, exactText: bounded(20000), isHardGate: literal(false), sections: array(preferredSection) })),
  inferences: array(object({ ...inferenceFields, kind: literal('ai_inference') })),
  verificationItems: array(object({ ...verificationFields, origin: oneOf('jd_unresolved_condition', 'job_scope_question'), basisSlotKeys: keys,
    conditionKeys: keys, priority: oneOf('before_decision', 'before_interview') })), resumeSuggestions: array(resume) });
function checked<T>(value: unknown, schema: Check, limit: number): T {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { return rejectV2('STRUCTURE'); }
  if (!serialized) return rejectV2('STRUCTURE');
  if (Buffer.byteLength(serialized) > limit) return rejectV2('SIZE_LIMIT');
  const errors: string[] = []; schema(value, 'v2', errors);
  if (errors.length) return rejectV2('STRUCTURE'); return structuredClone(value) as T;
}
export const parseNarrativeBundle = (v: unknown) => checked<NarrativeBundle>(v, narrativeSchema, V2_LIMITS.narrativeBytes);
export const parseCompleteReportV2 = (v: unknown) => checked<CompleteReportV2>(v, completeSchema, V2_LIMITS.narrativeBytes);
export function parseNarrativeJson(text: string): NarrativeBundle {
  if (Buffer.byteLength(text) > V2_LIMITS.narrativeBytes) return rejectV2('SIZE_LIMIT');
  let value: unknown; try { value = JSON.parse(text); } catch { return rejectV2('STRUCTURE'); } return parseNarrativeBundle(value);
}
const rowSource = object({ factId: key, start: integer, end: integer, evidenceType: oneOf('same_task', 'transferable', 'personal_practice', 'qualification', 'background'),
  sectionKey: nullable(key), sourceKey: key, quote: bounded(20000), scene: linkFields.scene });
const note: Check = (v, _p, e) => { if (typeof v !== 'string' || v.length > 200000) e.push('STRUCTURE'); };
const materialCheck: Check = (v, _p, e) => { try { checkV2Material(v); } catch { e.push('STRUCTURE'); } };
const planSchema = object({ id: key, ownerId: key, revision: safeInteger, policyVersion: literal('source-review/2'), material: materialCheck,
  materialDigest: key, rows: array(object({ jdId: key, choice: oneOf('limited_support', 'no_clue', 'pending'), sources: array(rowSource),
    existingAction: note, missingScope: note, pendingReason: note, confirmation: nullable(object({ rowDigest: key, rowSourceDigest: key,
      materialDigest: key, confirmedAt: key })) })), confirmation: nullable(object({ revision: safeInteger, sourceDigest: key, planDigest: key })) });
const requirementsCheck: Check = (v, _p, e) => { if (!Array.isArray(v)) e.push('STRUCTURE'); }; // Exact values compared against strictly parsed material in validator.
const jdCategory = nullable(oneOf('qualification', 'core_duty', 'preferred', 'background'));
const jdSnapshot = object({ id: key, revision: safeInteger, ruleVersion: literal('rules-1'), rawText: bounded(20000),
  segments: array(object({ id: key, start: safeInteger, end: safeInteger, sourceStart: safeInteger, sourceEnd: safeInteger,
    suggestedCategory: jdCategory, category: jdCategory })),
  confirmation: object({ revision: safeInteger, digest: key, confirmedAt: key }) });
const recordSchema = object({ id: key, userId: key, createdAt: key, company: bounded(200), jobTitle: bounded(200), city: nullable(bounded(200)),
  direction: nullable(bounded(200)), jdSourceUrl: nullable(bounded(2048)),
  versions: object({ ...Object.fromEntries(Object.entries(REPORT_V2_VERSIONS).map(([k, v]) => [k, literal(v)])), promptVersion: key, testDataVersion: nullable(key) }),
  modelMetadata: object({ provider: key, model: key, inputTokens: nullable(safeInteger), outputTokens: nullable(safeInteger), totalTokens: nullable(safeInteger),
    elapsedMs: safeInteger, finishReason: literal('stop'), costEstimate: nullable(object({ currency: oneOf('CNY', 'USD'), amount: nonnegative })), pricingVersion: nullable(key) }),
  provenance: object({ jdText: bounded(20000), jdItems: requirementsCheck, jdConfirmationSnapshot: jdSnapshot, profileSnapshot: profileSchema, profileVersion: safeInteger,
    planSnapshot: planSchema, planRevision: safeInteger, sourceDigest: key, planDigest: key, slotManifestDigest: key }), report: completeSchema });
export function parseReportV2Record(v: unknown): ReportV2Record {
  const r = checked<ReportV2Record>(v, recordSchema, V2_LIMITS.recordBytes), u = r.modelMetadata;
  if (!safeUuid(r.id) || !safeUuid(r.userId) || !Number.isFinite(Date.parse(r.createdAt)) || r.provenance.planSnapshot.ownerId !== r.userId
    || (r.jdSourceUrl !== null && !/^https?:\/\//.test(r.jdSourceUrl))) return rejectV2('STRUCTURE');
  const absent = [u.inputTokens, u.outputTokens, u.totalTokens].every(n => n === null);
  if (absent ? u.costEstimate !== null : [u.inputTokens, u.outputTokens, u.totalTokens].some(n => n === null)
    || u.inputTokens! + u.outputTokens! !== u.totalTokens!) return rejectV2('STRUCTURE');
  if (u.costEstimate !== null && !u.pricingVersion) return rejectV2('STRUCTURE'); return r;
}
