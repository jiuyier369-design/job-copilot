/** Rule-site labels only. Never classify or log the free-text issue, source or report. */
export const REPORT_RULE_CATEGORIES = Object.freeze(['JD_COVERAGE', 'REFERENCE', 'EVIDENCE_TYPE', 'VERIFICATION', 'RESUME_WORDING', 'OTHER'] as const);
export type ReportRuleCategory = typeof REPORT_RULE_CATEGORIES[number];
export type ReportRuleCounts = Record<ReportRuleCategory, number>;
export const EVIDENCE_RULE_CATEGORIES = Object.freeze(['LABEL_LINK_CONFLICT', 'OVERALL_LABEL_NO_MATCH', 'EDUCATION_AS_TASK_EVIDENCE', 'PERSONAL_PRACTICE_UPGRADED'] as const);
export type ReportEvidenceRule = typeof EVIDENCE_RULE_CATEGORIES[number];
export type ReportEvidenceCounts = Record<ReportEvidenceRule, number>;
export const COVERAGE_RULE_CATEGORIES = Object.freeze([
  'QUALIFICATION_MISSING', 'QUALIFICATION_DUPLICATE', 'QUALIFICATION_EXTRA',
  'CORE_DUTY_MISSING', 'CORE_DUTY_DUPLICATE', 'CORE_DUTY_EXTRA',
  'PREFERRED_MISSING', 'PREFERRED_DUPLICATE', 'PREFERRED_EXTRA',
] as const);
export type ReportCoverageRule = typeof COVERAGE_RULE_CATEGORIES[number];
export const REFERENCE_LOCATIONS = Object.freeze([
  'QUALIFICATION_FACT', 'CORE_DUTY_FACT', 'PREFERRED_FACT',
  'MATERIAL_FIT_SUPPORTING_JD', 'MATERIAL_FIT_LIMITING_JD',
  'INFERENCE_JD', 'VERIFICATION_JD', 'RESUME_JD', 'RESUME_FACT',
] as const);
export type ReferenceLocation = typeof REFERENCE_LOCATIONS[number];
export type ReferenceFailure = 'UNKNOWN' | 'DUPLICATE' | 'EMPTY';
export type ReportReferenceRule = `${ReferenceLocation}_${ReferenceFailure}` | 'JD_MANIFEST_EMPTY' | 'JD_MANIFEST_DUPLICATE' | 'PROFILE_MANIFEST_DUPLICATE' | 'JD_SOURCE_QUOTE_NOT_IN_TEXT' | 'MATERIAL_FIT_BASIS_EMPTY';
export const REFERENCE_RULE_CATEGORIES: readonly ReportReferenceRule[] = Object.freeze([
  'QUALIFICATION_FACT_UNKNOWN', 'QUALIFICATION_FACT_DUPLICATE', 'QUALIFICATION_FACT_EMPTY',
  'CORE_DUTY_FACT_UNKNOWN', 'CORE_DUTY_FACT_DUPLICATE', 'CORE_DUTY_FACT_EMPTY',
  'PREFERRED_FACT_UNKNOWN', 'PREFERRED_FACT_DUPLICATE', 'PREFERRED_FACT_EMPTY',
  'MATERIAL_FIT_SUPPORTING_JD_UNKNOWN', 'MATERIAL_FIT_SUPPORTING_JD_DUPLICATE', 'MATERIAL_FIT_SUPPORTING_JD_EMPTY',
  'MATERIAL_FIT_LIMITING_JD_UNKNOWN', 'MATERIAL_FIT_LIMITING_JD_DUPLICATE', 'MATERIAL_FIT_LIMITING_JD_EMPTY',
  'INFERENCE_JD_UNKNOWN', 'INFERENCE_JD_DUPLICATE', 'INFERENCE_JD_EMPTY',
  'VERIFICATION_JD_UNKNOWN', 'VERIFICATION_JD_DUPLICATE', 'VERIFICATION_JD_EMPTY',
  'RESUME_JD_UNKNOWN', 'RESUME_JD_DUPLICATE', 'RESUME_JD_EMPTY',
  'RESUME_FACT_UNKNOWN', 'RESUME_FACT_DUPLICATE', 'RESUME_FACT_EMPTY',
  'JD_MANIFEST_EMPTY', 'JD_MANIFEST_DUPLICATE', 'PROFILE_MANIFEST_DUPLICATE', 'JD_SOURCE_QUOTE_NOT_IN_TEXT', 'MATERIAL_FIT_BASIS_EMPTY',
]);
export type ReportCoverageCounts = Record<ReportCoverageRule, number>;
export type ReportReferenceCounts = Record<ReportReferenceRule, number>;
export type ReportRuleDetail = { category: 'JD_COVERAGE'; rule: ReportCoverageRule } | { category: 'REFERENCE'; rule: ReportReferenceRule };
/** Optional details support reading legacy events; newly emitted events always have version 2 and both maps. */
export interface A2DiagnosticEvent { event: 'analysis-a2-invalid'; counts: ReportRuleCounts; evidenceCounts: ReportEvidenceCounts;
  diagnosticVersion?: 2; coverageCounts?: ReportCoverageCounts; referenceCounts?: ReportReferenceCounts }
export type A2DiagnosticLog = (event: A2DiagnosticEvent) => void;

const summaries = new WeakMap<object, {counts: Readonly<ReportRuleCounts>; evidenceCounts: Readonly<ReportEvidenceCounts>;
  coverageCounts: Readonly<ReportCoverageCounts>; referenceCounts: Readonly<ReportReferenceCounts>}>();
const emptyCounts = (): ReportRuleCounts => ({ JD_COVERAGE: 0, REFERENCE: 0, EVIDENCE_TYPE: 0, VERIFICATION: 0, RESUME_WORDING: 0, OTHER: 0 });
const emptyEvidenceCounts = (): ReportEvidenceCounts => ({ LABEL_LINK_CONFLICT: 0, OVERALL_LABEL_NO_MATCH: 0, EDUCATION_AS_TASK_EVIDENCE: 0, PERSONAL_PRACTICE_UPGRADED: 0 });
const emptyCoverageCounts = () => Object.fromEntries(COVERAGE_RULE_CATEGORIES.map(rule => [rule, 0])) as ReportCoverageCounts;
const emptyReferenceCounts = () => Object.fromEntries(REFERENCE_RULE_CATEGORIES.map(rule => [rule, 0])) as ReportReferenceCounts;

export class ReportValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[], categories: readonly ReportRuleCategory[] = [], evidenceRules: readonly (ReportEvidenceRule | undefined)[] = [], details: readonly ReportRuleDetail[] = []) {
    super('REPORT_INVALID'); this.issues = issues;
    const counts = emptyCounts(), evidenceCounts = emptyEvidenceCounts(), coverageCounts = emptyCoverageCounts(), referenceCounts = emptyReferenceCounts();
    for (let i = 0; i < Math.max(1, issues.length); i++) {
      const category = categories[i];
      counts[REPORT_RULE_CATEGORIES.includes(category) ? category : 'OTHER']++;
      const rule = evidenceRules[i];
      if (category === 'EVIDENCE_TYPE' && rule && EVIDENCE_RULE_CATEGORIES.includes(rule)) evidenceCounts[rule]++;
    }
    for (const detail of details) {
      if (detail.category === 'JD_COVERAGE' && counts.JD_COVERAGE && COVERAGE_RULE_CATEGORIES.includes(detail.rule)) coverageCounts[detail.rule]++;
      if (detail.category === 'REFERENCE' && counts.REFERENCE && REFERENCE_RULE_CATEGORIES.includes(detail.rule)) referenceCounts[detail.rule]++;
    }
    // Stored separately so the diagnostic logger never enumerates the error or reads its raw issues.
    summaries.set(this, {counts: Object.freeze(counts), evidenceCounts: Object.freeze(evidenceCounts),
      coverageCounts: Object.freeze(coverageCounts), referenceCounts: Object.freeze(referenceCounts)});
  }
}

/** Unknown exceptions are OTHER. No message, stack, getters, toJSON or caller-provided labels are read. */
export function a2Diagnostic(error: unknown): A2DiagnosticEvent {
  const stored = error !== null && (typeof error === 'object' || typeof error === 'function') ? summaries.get(error) : undefined;
  const counts = emptyCounts(), evidenceCounts = emptyEvidenceCounts(), coverageCounts = emptyCoverageCounts(), referenceCounts = emptyReferenceCounts();
  if (stored) {
    for (const category of REPORT_RULE_CATEGORIES) counts[category] = stored.counts[category];
    for (const rule of EVIDENCE_RULE_CATEGORIES) evidenceCounts[rule] = stored.evidenceCounts[rule];
    for (const rule of COVERAGE_RULE_CATEGORIES) coverageCounts[rule] = stored.coverageCounts[rule];
    for (const rule of REFERENCE_RULE_CATEGORIES) referenceCounts[rule] = stored.referenceCounts[rule];
  }
  else counts.OTHER = 1;
  return { event: 'analysis-a2-invalid', counts, evidenceCounts, diagnosticVersion: 2, coverageCounts, referenceCounts };
}

/** Diagnostic logger failures cannot save a rejected report, change its failure category or trigger retry. */
export function emitA2Diagnostic(error: unknown, log?: A2DiagnosticLog): void {
  try { log?.(a2Diagnostic(error)); } catch { /* no raw logger exception */ }
}
