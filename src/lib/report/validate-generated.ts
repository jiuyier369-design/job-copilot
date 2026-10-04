import { validateReport, type ReportContext } from './validate.ts';
import { checkGraduationConclusions } from './graduation.ts';
import { checkGenerationSemantics } from './generation-semantics.ts';

/** Additional inference guard on new generation only; immutable history uses original A2. */
export function validateGeneratedReport(candidate: unknown, context: ReportContext) {
  const report = validateReport(candidate, context);
  checkGraduationConclusions(report, context);
  checkGenerationSemantics(report, context);
  return report;
}
