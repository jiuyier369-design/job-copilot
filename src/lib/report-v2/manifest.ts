import type { V2Material, V2Plan } from '../../types/evidence-plan-v2.ts';
import type { LinkSlot, ReportV2Manifest, RequirementSlot } from '../../types/report-v2.ts';
import { checkV2Material, exactSlice, readV2Plan, v2Hash } from '../evidence-plan-v2/domain.ts';
import { graduationChecks } from '../report/graduation.ts';
import { generationEvidenceChecks } from '../report/generation-semantics.ts';
import type { JdDraft } from '../../types/jd-review.ts';
import { contentOf, validateContent } from '../jd/content.ts';
import { draftDigest } from '../jd/service.ts';

export const V2_FAILURES = ['STRUCTURE', 'SIZE_LIMIT', 'MANIFEST', 'COVERAGE', 'REFERENCE', 'EVIDENCE_BOUNDARY',
  'QUALIFICATION', 'SEMANTIC', 'VERSION_CONFLICT', 'OUTPUT_INCOMPLETE'] as const;
export type V2Failure = typeof V2_FAILURES[number];
/** Only fixed categories escape this offline port; materials/errors are never logged. */
export class ReportV2Error extends Error {
  readonly code: V2Failure;
  constructor(code: V2Failure) { super(code); this.code = code; }
}
export const rejectV2 = (code: V2Failure): never => { throw new ReportV2Error(code); };

export function validateV2JdSnapshot(draft: JdDraft, material: V2Material): void {
  try {
    validateContent(contentOf(draft));
    const items = draft.segments.filter(s => s.category !== 'background');
    if (draft.id !== material.binding.draftId || draft.revision !== material.binding.draftRevision
      || draft.rawText !== material.jdText || !draft.confirmation || draft.confirmation.revision !== draft.revision
      || !Number.isFinite(Date.parse(draft.confirmation.confirmedAt)) || draft.confirmation.digest !== draftDigest(draft)
      || draft.confirmation.digest !== material.binding.confirmationDigest || draft.segments.some(s => s.category === null)
      || items.length !== material.requirements.length || material.requirements.some(r => !items.some(s => s.id === r.jdId
        && s.category === r.kind && s.start === r.start && s.end === r.end))) return rejectV2('MANIFEST');
  } catch { return rejectV2('MANIFEST'); }
}

export function compileReportV2Manifest(owner: string, plan: V2Plan, current: V2Material): ReportV2Manifest {
  try {
    checkV2Material(current);
    if (readV2Plan(owner, plan, current).status !== 'confirmed') return rejectV2('VERSION_CONFLICT');
  } catch { return rejectV2('VERSION_CONFLICT'); }
  const m = plan.material;
  const slots: RequirementSlot[] = m.requirements.map(item => {
    const row = plan.rows.find(r => r.jdId === item.jdId)!;
    const links: LinkSlot[] = row.sources.map(s => ({ linkKey: s.sourceKey, factId: s.factId, exactQuote: s.quote,
      start: s.start, end: s.end, scene: s.scene, evidenceType: s.evidenceType, reviewedScope: row.missingScope, sectionKey: s.sectionKey }));
    const conditionSlots = item.conditions.map(c => {
      const exactText = exactSlice(m.jdText, c);
      // Evaluate only explicitly selected education fragments, never model hints or unrelated dates.
      const profile = { ...m.profile, facts: links.filter(l => l.evidenceType === 'qualification').map(l => ({
        ...m.profile.facts.find(f => f.factId === l.factId)!, statement: l.exactQuote })) };
      const check = c.basisKind === 'verified_date_rule' ? graduationChecks({ jdText: m.jdText,
        jdItems: [{ jdId: c.key, kind: 'qualification', exactText }], profile })[0] : undefined;
      // A compound/unsupported anchor is not promoted by the bounded date rule.
      const status = check?.requiredOverallStatus ?? 'needs_confirmation';
      return { conditionKey: c.key, exactSourceSpan: { start: c.start, end: c.end }, exactText, status,
        factRefs: check?.factIds ?? [], basisKind: c.basisKind };
    });
    const preferredSections = item.sections.map(s => {
      const sectionLinks = links.filter(l => l.sectionKey === s.key), exactText = exactSlice(m.jdText, s);
      // Deliberately narrow educational-background rule; other majors/ambiguous prose remain unknown.
      const supported = s.kind === 'background' && /计算机相关专业优先/.test(exactText)
        && sectionLinks.some(l => /计算机相关专业/.test(l.exactQuote) && !/非计算机|不是|并非|未确定/.test(l.exactQuote));
      const notSupported = s.kind === 'background' && /计算机相关专业优先/.test(exactText)
        && sectionLinks.some(l => /明确非计算机相关专业/.test(l.exactQuote));
      return { sectionKey: s.key, kind: s.kind, exactSourceSpan: { start: s.start, end: s.end }, exactText,
        linkKeys: sectionLinks.map(l => l.linkKey), backgroundSupport: s.kind === 'background'
          ? supported && !notSupported ? 'supported' as const : notSupported && !supported ? 'not_supported' as const
            : 'needs_confirmation' as const : null };
    });
    const taskParts = item.kind === 'core_duty' ? [{ exactText: item.exactText, links }]
      : preferredSections.filter(s => s.kind === 'task').map(s => ({ exactText: s.exactText, links: links.filter(l => s.linkKeys.includes(l.linkKey)) }));
    for (const part of taskParts) {
      const check = generationEvidenceChecks({ jdText: m.jdText, profile: m.profile,
        jdItems: [{ jdId: item.jdId, kind: 'core_duty', exactText: part.exactText }] }).tasks[0];
      if (check && part.links.some(l => check.excludedTaskFactIds.includes(l.factId))) rejectV2('EVIDENCE_BOUNDARY');
    }
    return { slotKey: `slot/${item.jdId}`, jdId: item.jdId, kind: item.kind, exactText: item.exactText,
      sourceSpan: { start: item.start, end: item.end }, reviewChoice: row.choice as 'limited_support' | 'no_clue', links,
      reviewedExistingAction: row.existingAction, reviewedMissingScope: row.missingScope, conditionSlots, preferredSections };
  });
  const unresolved = slots.flatMap(s => s.conditionSlots.filter(c => c.status === 'needs_confirmation').map(c => ({
    verificationKey: `verify/${c.conditionKey}`, origin: 'jd_unresolved_condition' as const, basisSlotKeys: [s.slotKey],
    conditionKeys: [c.conditionKey], priority: 'before_decision' as const, required: true })));
  // Preserve eligibility-first ordering, independent of prose or model array order.
  unresolved.sort((a, b) => Number(/毕业后.*全职/.test(slots.flatMap(s => s.conditionSlots).find(c => c.conditionKey === b.conditionKeys[0])!.exactText))
    - Number(/毕业后.*全职/.test(slots.flatMap(s => s.conditionSlots).find(c => c.conditionKey === a.conditionKeys[0])!.exactText)));
  const body: Omit<ReportV2Manifest, 'digest'> = { contractVersion: 'slot-manifest/2', planDigest: plan.confirmation!.planDigest,
    sourceDigest: plan.confirmation!.sourceDigest, materialDigest: plan.materialDigest, slots,
    verificationAnchors: [...unresolved, ...slots.filter(s => s.kind === 'core_duty' || s.preferredSections.some(p => p.kind === 'task')).map(s => ({
      verificationKey: `verify/scope/${s.slotKey}`, origin: 'job_scope_question' as const, basisSlotKeys: [s.slotKey], conditionKeys: [],
      priority: 'before_interview' as const, required: false }))],
    allowedActions: slots.some(s => s.conditionSlots.some(c => c.status === 'does_not_meet')) ? ['explicit_hard_gate']
      : unresolved.length ? ['verify_first'] : ['prioritize', 'verify_first', 'try_with_weak_evidence'],
    inferenceKeys: ['inference/material-scope'], resumeAnchors: slots.flatMap(s => s.links.filter(l =>
      ['same_task', 'transferable', 'personal_practice'].includes(l.evidenceType)).map(l => ({ suggestionKey: `resume/${l.linkKey}`, basisLinkKeys: [l.linkKey] }))) };
  return structuredClone({ ...body, digest: v2Hash(body) });
}
