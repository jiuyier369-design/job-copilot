import type { QualificationStatus, Report } from '../../types/job-copilot.ts';
import type { ReportContext } from './validate.ts';
import { ReportValidationError } from './diagnostics.ts';

// Narrow graduation-window reasoning, not a general eligibility/degree parser.
// Only explicit dates in education facts count. No age/year-group/today inference.
const dateSource = String.raw`(?:19|20)\d{2}\s*(?:年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[-/]\d{1,2}(?:[-/]\d{1,2})?)`;
type DateSpan = { first: number; last: number };
function dateSpan(text: string): DateSpan | null {
  const parts = text.match(/\d+/g)?.map(Number);
  if (!parts || parts.length < 2) return null;
  const [year, month, day] = parts;
  if (month < 1 || month > 12) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day !== undefined && (day < 1 || day > days)) return null;
  return { first: Date.UTC(year, month - 1, day ?? 1), last: Date.UTC(year, month - 1, day ?? days) };
}
export interface GraduationCheck {
  jdId: string;
  factIds: string[];
  dateStatus: QualificationStatus;
  // null means other conditions remain outside this deliberately limited rule.
  requiredOverallStatus: QualificationStatus | null;
  reason: 'IN_WINDOW' | 'OUTSIDE_WINDOW' | 'DATE_UNCLEAR' | 'OTHER_CONDITIONS_UNPROVEN';
}

export function graduationChecks(context: ReportContext): GraduationCheck[] {
  const candidates: { factId: string; span: DateSpan }[] = [];
  let unclear = false;
  const degrees = new Set<string>();
  for (const fact of context.profile.facts) {
    if (fact.category !== 'education' || fact.context !== 'education') continue;
    for (const clause of fact.statement.split(/[。；;\n]/)) {
      if (!/毕业/.test(clause)) continue;
      const dates = [...clause.matchAll(new RegExp(dateSource, 'g'))];
      if (!dates.length) continue;
      // An explicit date must modify graduation, rather than unrelated enrollment.
      const related = dates.filter(match => {
        const start = match.index!, end = start + match[0].length;
        return /^\s*(?:预计|预期|计划)?\s*毕业/.test(clause.slice(end))
          || /毕业(?:时间|日期)?\s*(?:预计|预期|计划|为|是|于|[:：])*\s*$/.test(clause.slice(0, start));
      });
      if (!related.length) { unclear = true; continue; }
      if (/不确定|待确认|可能|暂定|延期|未定|并非|不是|不会|不在|取消|不能|或/.test(clause)) unclear = true;
      for (const degree of clause.match(/本科|硕士|博士|专科/g) ?? []) degrees.add(degree);
      for (const match of related) {
        const span = dateSpan(match[0]);
        if (!span) unclear = true;
        else candidates.push({ factId: fact.factId, span });
      }
    }
  }
  const distinct = new Set(candidates.map(c => `${c.span.first}:${c.span.last}`));
  if (distinct.size !== 1 || degrees.size > 1) unclear = true;
  const result: GraduationCheck[] = [];
  for (const item of context.jdItems) {
    if (item.kind !== 'qualification' || !/毕业/.test(item.exactText)) continue;
    if (/不在|不得在|除外|以外|不包括|不含|暂定|可能|或/.test(item.exactText)) continue;
    const windows = [...item.exactText.matchAll(new RegExp(`(${dateSource})\\s*(?:至|到|—|–|-|~|～)\\s*(${dateSource})`, 'g'))];
    // Unrecognized/multiple windows are not guessed or reclassified.
    if (windows.length !== 1) continue;
    const window = windows[0], start = dateSpan(window[1]), end = dateSpan(window[2]);
    const rest = item.exactText.replace(window[0], '');
    // A small allowed vocabulary identifies a date-only requirement. Anything
    // else is a compound requirement, never automatically promoted to meets.
    const dateOnly = rest.replace(/毕业时间|毕业日期|预计|毕业|时间|日期|应届|之间|期间|范围|窗口|在|为|从|到|的|需|须|是|于|届|[:：，,。；;()（）\s]/g, '') === '';
    let dateStatus: QualificationStatus = 'needs_confirmation';
    if (!unclear && candidates.length && start && end && start.first <= end.last) {
      const date = candidates[0].span;
      if (date.first >= start.first && date.last <= end.last) dateStatus = 'meets';
      else if (date.last < start.first || date.first > end.last) dateStatus = 'does_not_meet';
      // Partial overlap (month-only date vs exact-day window) remains unknown.
    }
    const otherUnproven = !dateOnly && dateStatus === 'meets';
    result.push({ jdId: item.jdId, factIds: [...new Set(candidates.map(c => c.factId))], dateStatus,
      requiredOverallStatus: dateOnly ? dateStatus : dateStatus === 'does_not_meet' ? 'does_not_meet' : null,
      reason: otherUnproven ? 'OTHER_CONDITIONS_UNPROVEN' : dateStatus === 'meets' ? 'IN_WINDOW'
        : dateStatus === 'does_not_meet' ? 'OUTSIDE_WINDOW' : 'DATE_UNCLEAR' });
  }
  return result;
}

/** Generation-only guard. Never revalidates/rewrites already stored historical reports. */
export function checkGraduationConclusions(report: Report, context: ReportContext): void {
  const failures: string[] = [];
  for (const check of graduationChecks(context)) {
    const q = report.qualifications.find(q => q.jdId === check.jdId)!;
    const dateDenial = /(?:毕业时间|毕业日期|毕业区间|毕业窗口)[^。；\n]{0,24}(?:未明确|不明确|待确认|需核验|需确认|无法确认|不满足|不符合)/.test(q.explanation);
    const withoutNegatedClaims = q.explanation.replace(/(?:不|未能|未)(?:完全)?(?:满足|符合)|(?:未|不曾)落在/g, '否定');
    const dateAffirmation = /(?:毕业时间|毕业日期|毕业区间|毕业窗口)[^。；\n]{0,24}(?:满足|符合|落在)/.test(withoutNegatedClaims);
    const unproved = check.reason === 'OTHER_CONDITIONS_UNPROVEN' && q.status === 'meets';
    if ((check.requiredOverallStatus !== null && q.status !== check.requiredOverallStatus)
      || (check.dateStatus !== 'needs_confirmation' && !q.factIds.some(id => check.factIds.includes(id)))
      || (check.dateStatus === 'meets' && dateDenial)
      || (check.dateStatus === 'does_not_meet' && dateAffirmation) || unproved) failures.push('GRADUATION_CONCLUSION_CONFLICT');
  }
  if (failures.length) throw new ReportValidationError(failures, failures.map(() => 'OTHER'));
}
