import type { JdItem, ProfileData, Report } from "../../types/job-copilot.ts";
import { jdItemsSchema, profileSchema, reportSchema } from "./schema.ts";
import { ReportValidationError, type ReportRuleCategory, type ReportEvidenceRule, type ReportRuleDetail, type ReferenceLocation, type ReportCoverageRule } from "./diagnostics.ts";
export { ReportValidationError } from "./diagnostics.ts";

export interface ReportContext { jdText: string; jdItems: JdItem[]; profile: ProfileData }

// These helpers annotate existing rejected checks; they never decide whether a report is accepted.
const referenceDetails = (rule: import("./diagnostics.ts").ReportReferenceRule): ReportRuleDetail[] => [{ category: 'REFERENCE', rule }];
const coverageDetails = (kind: 'qualification' | 'core_duty' | 'preferred', type: 'MISSING' | 'DUPLICATE' | 'EXTRA'): ReportRuleDetail[] =>
  [{ category: 'JD_COVERAGE', rule: `${kind.toUpperCase()}_${type}` as ReportCoverageRule }];
const coverageMismatchDetails = (kind: 'qualification' | 'core_duty' | 'preferred', expected: string[], actual: string[]): ReportRuleDetail[] => [
  ...(expected.some(id => !actual.includes(id)) ? coverageDetails(kind, 'MISSING') : []),
  ...(actual.some(id => !expected.includes(id)) ? coverageDetails(kind, 'EXTRA') : []),
];

/** Context must come from a server-owned/reviewed JD manifest, NOT model output. */
export function validateReport(candidate: unknown, context: ReportContext): Report {
  const errors: string[] = [];
  reportSchema(candidate, "report", errors);
  profileSchema(context.profile, "profile", errors);
  jdItemsSchema(context.jdItems, "jdItems", errors);
  if (errors.length) throw new ReportValidationError(errors);
  const categories: ReportRuleCategory[] = [];
  const evidenceRules: (ReportEvidenceRule | undefined)[] = [];
  const details: ReportRuleDetail[] = [];
  const issue = (category: ReportRuleCategory, message: string, evidenceRule?: ReportEvidenceRule, annotations: readonly ReportRuleDetail[] = []) => { errors.push(message); categories.push(category); evidenceRules.push(evidenceRule); details.push(...annotations); };
  const report = candidate as Report;
  const jd = new Map(context.jdItems.map((x) => [x.jdId, x]));
  const facts = new Map(context.profile.facts.map((x) => [x.factId, x]));
  if (!jd.size || jd.size !== context.jdItems.length) issue('REFERENCE', "JD IDs must be non-empty and unique", undefined, referenceDetails(!jd.size ? 'JD_MANIFEST_EMPTY' : 'JD_MANIFEST_DUPLICATE'));
  if (facts.size !== context.profile.facts.length) issue('REFERENCE', "Profile fact IDs must be unique", undefined, referenceDetails('PROFILE_MANIFEST_DUPLICATE'));
  for (const item of context.jdItems) {
    if (!context.jdText.includes(item.exactText)) issue('REFERENCE', `${item.jdId}: source quote is not in original JD`, undefined, referenceDetails('JD_SOURCE_QUOTE_NOT_IN_TEXT'));
  }
  const refs = (ids: string[], known: Map<string, unknown>, path: string, required = false, location: ReferenceLocation) => {
    if (required && !ids.length) issue('REFERENCE', `${path}: reference required`, undefined, referenceDetails(`${location}_EMPTY`));
    if (new Set(ids).size !== ids.length) issue('REFERENCE', `${path}: duplicate references`, undefined, referenceDetails(`${location}_DUPLICATE`));
    ids.forEach((id) => { if (!known.has(id)) issue('REFERENCE', `${path}: unknown reference ${id}`, undefined, referenceDetails(`${location}_UNKNOWN`)); });
  };
  const sections = [
    ["qualification", report.qualifications], ["core_duty", report.coreDuties], ["preferred", report.preferredItems],
  ] as const;
  for (const [kind, assessments] of sections) {
    const expected = context.jdItems.filter((x) => x.kind === kind).map((x) => x.jdId);
    const actual = assessments.map((x) => x.jdId);
    if (new Set(actual).size !== actual.length) issue('JD_COVERAGE', `${kind}: duplicate assessment`, undefined, coverageDetails(kind, 'DUPLICATE'));
    if (expected.length !== actual.length || expected.some((id) => !actual.includes(id)) || actual.some((id) => !expected.includes(id))) {
      issue('JD_COVERAGE', `${kind}: coverage must exactly match reviewed JD items`, undefined, coverageMismatchDetails(kind, expected, actual));
    }
  }
  for (const q of report.qualifications) {
    refs(q.factIds, facts, q.jdId, q.status !== "needs_confirmation", 'QUALIFICATION_FACT');
  }
  for (const task of [...report.coreDuties, ...report.preferredItems]) {
    const noEvidence = task.evidenceType === "no_evidence";
    if (noEvidence !== (task.evidenceLinks.length === 0)) issue('EVIDENCE_TYPE', `${task.jdId}: evidence label/links conflict`, 'LABEL_LINK_CONFLICT');
    if (!noEvidence && !task.evidenceLinks.some((l) => l.evidenceType === task.evidenceType)) issue('EVIDENCE_TYPE', `${task.jdId}: overall label has no matching link`, 'OVERALL_LABEL_NO_MATCH');
    for (const link of task.evidenceLinks) {
      refs(link.factIds, facts, task.jdId, true, report.coreDuties.includes(task) ? 'CORE_DUTY_FACT' : 'PREFERRED_FACT');
      for (const id of link.factIds) {
        const fact = facts.get(id);
        if (fact?.category === "education") issue('EVIDENCE_TYPE', `${task.jdId}: education qualification cannot substitute for task evidence`, 'EDUCATION_AS_TASK_EVIDENCE');
        if (fact?.context === "personal_project" && link.evidenceType !== "personal_practice") issue('EVIDENCE_TYPE', `${task.jdId}: personal practice cannot be upgraded`, 'PERSONAL_PRACTICE_UPGRADED');
      }
    }
  }
  refs(report.materialFit.supportingJdIds, jd, "materialFit.supportingJdIds", false, 'MATERIAL_FIT_SUPPORTING_JD');
  refs(report.materialFit.limitingJdIds, jd, "materialFit.limitingJdIds", false, 'MATERIAL_FIT_LIMITING_JD');
  if (!report.materialFit.supportingJdIds.length && !report.materialFit.limitingJdIds.length) issue('REFERENCE', "materialFit: basis required", undefined, referenceDetails('MATERIAL_FIT_BASIS_EMPTY'));
  for (const inference of report.inferences) refs(inference.jdIds, jd, "inference", true, 'INFERENCE_JD');
  for (const item of report.verificationItems) {
    refs(item.jdIds, jd, "verification", true, 'VERIFICATION_JD');
    if (item.answerImpacts.length < 2) issue('VERIFICATION', "verification: explain at least two different answer outcomes");
  }
  const indexes = report.applicationAction.verificationItemIndexes;
  if (new Set(indexes).size !== indexes.length || indexes.some((i) => i >= report.verificationItems.length)) issue('VERIFICATION', "applicationAction: invalid verification index");
  if (report.applicationAction.category === "verify_first" && !indexes.length) issue('VERIFICATION', "verify_first: verification reference required");
  if (report.applicationAction.category === "explicit_hard_gate" && !report.qualifications.some((q) => q.status === "does_not_meet")) issue('OTHER', "hard gate requires a failed explicit qualification");

  for (const suggestion of report.resumeSuggestions) {
    refs(suggestion.jdIds, jd, "resume JD", true, 'RESUME_JD');
    refs(suggestion.factIds, facts, "resume facts", true, 'RESUME_FACT');
    const source = suggestion.factIds.map((id) => facts.get(id)?.statement ?? "").join("\n");
    // Numbers must be supported by the referenced facts, not somewhere else in the profile.
    const numbers = (s: string) => s.match(/\d+(?:\.\d+)?\s*\+?\s*%?/g)?.map((n) => n.replace(/\s/g, "")) ?? [];
    if (numbers(suggestion.suggestedWording).some((n) => !numbers(source).includes(n))) issue('RESUME_WORDING', "resume: unsupported number");
    // Narrow regression guards. These do not prove the truth of arbitrary prose.
    const claims: [RegExp, RegExp][] = [
      [/500\s*\+.*原创视频/, /500\s*\+.*原创视频/],
      [/独立开发|独立软件开发/, /独立开发|独立软件开发/],
      [/续约率|留存率|增购收入/, /续约率|留存率|增购收入/],
      [/完成商业化验证|已商业化验证/, /完成商业化验证|已商业化验证/],
      [/正式科技企业实习/, /正式科技企业实习/],
    ];
    const positiveSource = source.split(/[。；\n]/).filter((s) => !/未|无|不具备|非|不自称/.test(s)).join("\n");
    for (const [claim, support] of claims) if (claim.test(suggestion.suggestedWording) && !support.test(positiveSource)) issue('RESUME_WORDING', "resume: unsupported high-risk claim");
  }
  const decisions = report.applicationAction.summary + (report.applicationAction.conditionalNextAction ?? "");
  if (/目前仍在招|当前仍在招|已确认在招|目前正在招聘/.test(decisions)) issue('VERIFICATION', "action: live vacancy status has not been verified");
  if (context.jdText.includes("COPT") && /大模型应用岗位|大模型产品岗位/.test(report.materialFit.summary) && !/不能|并非|不是/.test(report.materialFit.summary)) issue('OTHER', "materialFit: solver is not automatically an LLM role");
  if (errors.length) throw new ReportValidationError(errors, categories, evidenceRules, details);
  return report;
}

/** Invalid output never reaches the persistence callback. */
export async function validateThenSave<T>(candidate: unknown, context: ReportContext, save: (report: Report) => Promise<T>): Promise<T> {
  const report = validateReport(candidate, context);
  return save(report);
}
