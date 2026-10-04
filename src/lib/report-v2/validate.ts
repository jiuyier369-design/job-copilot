import { isDeepStrictEqual } from 'node:util';
import type { V2Material, V2Plan } from '../../types/evidence-plan-v2.ts';
import type { CompleteReportV2, LinkSlot, NarrativeBundle, ReportV2Manifest, ReportV2Record, ReportV2Task, RequirementSlot } from '../../types/report-v2.ts';
import { compileReportV2Manifest, rejectV2, validateV2JdSnapshot } from './manifest.ts';
import type { JdDraft } from '../../types/jd-review.ts';
import { parseCompleteReportV2, parseNarrativeBundle, parseNarrativeJson, parseReportV2Record } from './schema.ts';

const same = isDeepStrictEqual;
function references(actual: string[], allowed: string[], required = false): void {
  if ((required && !actual.length) || new Set(actual).size !== actual.length || actual.some(k => !allowed.includes(k))) rejectV2('REFERENCE');
}
function coverage(actual: string[], expected: string[]): void {
  references(actual, expected); if (actual.length !== expected.length || expected.some(k => !actual.includes(k))) rejectV2('COVERAGE');
}
const taskTypes = ['same_task', 'transferable', 'personal_practice'] as const;
const summaryType = (links: LinkSlot[]) => taskTypes.find(t => links.some(l => l.evidenceType === t)) ?? 'no_evidence';
const positive = (s: string, pattern: RegExp) => s.split(/[。；;，,\n]|但是|但|不过/).some(c => !/未|没有|缺少|暂无|不能|不代表|并非|不具备|希望|计划|不要求|不是|不构成/.test(c) && pattern.test(c));
const assertedGate = (s: string, topic: RegExp) => s.split(/[。；;，,\n]/).some(c => topic.test(c)
  && /硬门槛|基本资格不符合|不符合基本资格|不能投递|无投递资格/.test(c)
  && !/不构成|不意味着|不代表|不是|并非|不会导致|不能认为|不得视为/.test(c));
function wordingBoundary(text: string, links: LinkSlot[]): void {
  const source = links.map(l => l.exactQuote).join('；');
  const numbers = (s: string) => s.match(/\d+(?:\.\d+)?\s*\+?\s*%?/g)?.map(n => n.replace(/\s/g, '')) ?? [];
  if (numbers(text).some(n => !numbers(source).includes(n))) rejectV2('EVIDENCE_BOUNDARY');
  for (const risky of [/独立开发|独立软件开发/, /续约率/, /留存率/, /增购收入/, /完成商业化验证|已商业化验证/, /正式科技企业实习/])
    if (positive(text, risky) && !positive(source, risky)) rejectV2('EVIDENCE_BOUNDARY');
  if (links.every(l => l.scene !== 'formal_work') && positive(text, /正式企业经历|正式企业实习|企业任职|企业上线|交付企业客户|企业客户交付/)) rejectV2('EVIDENCE_BOUNDARY');
}
function proseChecks(b: NarrativeBundle, manifest: ReportV2Manifest): void {
  const all = [b.materialFit.summary, b.applicationAction.summary, b.applicationAction.conditionalNextAction ?? '',
    ...b.answers.flatMap(a => [a.explanation, ...a.missingAspects, ...a.links.flatMap(l => [l.connection, l.boundary]),
      ...a.conditions.map(c => c.explanation), ...a.preferredSections.map(s => s.explanation)]),
    ...b.inferences.flatMap(i => [i.statement, i.uncertainty]), ...b.verificationAnswers.flatMap(v => [v.question, v.reason, v.askWhomOrHow, ...v.answerImpacts]),
    ...b.resumeSuggestions.flatMap(s => [s.suggestedWording, s.factualBoundary])];
  const jd = manifest.slots.map(s => s.exactText).join('\n'), qualification = manifest.slots.filter(s => s.kind === 'qualification').map(s => s.exactText).join('\n');
  if (all.some(s => positive(s, /目前仍在招|当前仍在招|已确认在招|目前正在招聘/))) rejectV2('SEMANTIC');
  if (!/院校层次|全日制/.test(jd) && all.some(s => positive(s, /核验.{0,12}(?:院校层次|全日制)|必须.{0,12}(?:院校层次|全日制)/))) rejectV2('SEMANTIC');
  if (manifest.slots.some(s => s.kind === 'preferred' && /专业/.test(s.exactText)) && !/专业/.test(qualification)
    && all.some(s => assertedGate(s, /专业/))) rejectV2('SEMANTIC');
  if (!/实习/.test(qualification) && all.some(s => assertedGate(s, /实习/))) rejectV2('SEMANTIC');
  const personal = manifest.slots.some(s => s.links.some(l => l.evidenceType === 'personal_practice'));
  if (personal && all.some(s => /完全没有相关(?:个人)?(?:实践|经历)|没有任何相关(?:个人)?(?:实践|经历)|缺少\s*AI\s*产品领域推动想法落地的经历/.test(s))) rejectV2('SEMANTIC');
  if (/实习.*或.*项目/.test(jd) && !/必须.*企业项目/.test(jd)
    && all.some(s => positive(s, /必须(?:是|有|具备)?(?:正式)?企业项目/))) rejectV2('SEMANTIC');
  for (const a of b.answers) {
    const slot = manifest.slots.find(s => s.slotKey === a.slotKey)!;
    for (const l of a.links) {
      const source = slot.links.find(s => s.linkKey === l.linkKey)!;
      // Narrow assertion guard; arbitrary paraphrase truth still requires independent human review.
      if (source.evidenceType !== 'background' && source.evidenceType !== 'qualification') wordingBoundary(l.connection, [source]);
    }
    for (const c of a.conditions) {
      const expected = slot.conditionSlots.find(s => s.conditionKey === c.conditionKey)!;
      if (expected.status === 'meets' && /毕业(?:日期|时间|窗口).{0,20}(?:需确认|待确认|不符合|不满足)/.test(c.explanation)) rejectV2('QUALIFICATION');
      if (expected.status !== 'meets' && positive(c.explanation, /已满足全部资格|确认符合全部资格/)) rejectV2('QUALIFICATION');
    }
  }
  const links = manifest.slots.flatMap(s => s.links);
  for (const r of b.resumeSuggestions) wordingBoundary(r.suggestedWording, links.filter(l => r.basisLinkKeys.includes(l.linkKey)));
}

export function validateNarrativeV2(value: unknown, manifest: ReportV2Manifest): NarrativeBundle {
  const b = parseNarrativeBundle(value);
  if (b.manifestDigest !== manifest.digest) return rejectV2('MANIFEST');
  coverage(b.answers.map(a => a.slotKey), manifest.slots.map(s => s.slotKey));
  for (const a of b.answers) {
    const slot = manifest.slots.find(s => s.slotKey === a.slotKey)!;
    coverage(a.links.map(l => l.linkKey), slot.links.map(l => l.linkKey));
    coverage(a.conditions.map(c => c.conditionKey), slot.conditionSlots.map(c => c.conditionKey));
    coverage(a.preferredSections.map(s => s.sectionKey), slot.preferredSections.map(s => s.sectionKey));
    // Unknown date/employment clauses cannot silently vanish in a compound-qualification explanation.
    if (slot.conditionSlots.some(c => c.status !== 'meets') && positive(a.explanation, /已满足全部资格|确认符合全部资格/)) rejectV2('QUALIFICATION');
  }
  const slotKeys = manifest.slots.map(s => s.slotKey);
  references(b.materialFit.supportingSlotKeys, slotKeys); references(b.materialFit.limitingSlotKeys, slotKeys);
  if (!b.materialFit.supportingSlotKeys.length && !b.materialFit.limitingSlotKeys.length) rejectV2('REFERENCE');
  for (const k of b.materialFit.supportingSlotKeys) {
    const s = manifest.slots.find(s => s.slotKey === k)!;
    if (!s.links.length && !s.conditionSlots.some(c => c.status === 'meets')) rejectV2('EVIDENCE_BOUNDARY');
  }
  if (!manifest.allowedActions.includes(b.applicationAction.category)) rejectV2('QUALIFICATION');
  coverage(b.verificationAnswers.filter(v => manifest.verificationAnchors.some(a => a.required && a.verificationKey === v.verificationKey)).map(v => v.verificationKey),
    manifest.verificationAnchors.filter(a => a.required).map(a => a.verificationKey));
  references(b.verificationAnswers.map(v => v.verificationKey), manifest.verificationAnchors.map(v => v.verificationKey));
  for (const v of b.verificationAnswers) if (v.answerImpacts.length < 2 || new Set(v.answerImpacts).size !== v.answerImpacts.length) rejectV2('REFERENCE');
  references(b.applicationAction.verificationKeys, b.verificationAnswers.map(v => v.verificationKey), b.applicationAction.category === 'verify_first');
  const required = manifest.verificationAnchors.filter(a => a.required).map(a => a.verificationKey);
  if (required.length && b.applicationAction.category !== 'explicit_hard_gate'
    && !same(b.applicationAction.verificationKeys.slice(0, required.length), required)) rejectV2('QUALIFICATION');
  references(b.inferences.map(i => i.inferenceKey), manifest.inferenceKeys);
  for (const i of b.inferences) references(i.basisSlotKeys, slotKeys, true);
  references(b.resumeSuggestions.map(s => s.suggestionKey), manifest.resumeAnchors.map(s => s.suggestionKey));
  for (const r of b.resumeSuggestions) coverage(r.basisLinkKeys, manifest.resumeAnchors.find(s => s.suggestionKey === r.suggestionKey)!.basisLinkKeys);
  proseChecks(b, manifest); return b;
}
function task(slot: RequirementSlot, links: LinkSlot[], explanation: string, missingAspects: string[], answer: NarrativeBundle['answers'][number]): ReportV2Task {
  const tasks = links.filter(l => taskTypes.includes(l.evidenceType as typeof taskTypes[number]));
  return { choice: tasks.length ? 'limited_support' : 'no_clue', evidenceType: summaryType(tasks), evidenceLinks: tasks.map(l => ({
    ...l, evidenceType: l.evidenceType as typeof taskTypes[number], ...answer.links.find(a => a.linkKey === l.linkKey)! })),
    reviewedExistingAction: tasks.map(l => l.exactQuote).join('；'), reviewedMissingScope: slot.reviewedMissingScope, explanation, missingAspects };
}
export function assembleReportV2(value: unknown, manifest: ReportV2Manifest): CompleteReportV2 {
  const b = validateNarrativeV2(value, manifest), answer = (s: RequirementSlot) => b.answers.find(a => a.slotKey === s.slotKey)!;
  return parseCompleteReportV2({ reportStructureVersion: '2.0.0', manifestDigest: manifest.digest, materialFit: b.materialFit,
    applicationAction: { ...b.applicationAction, recommendationOnly: true },
    qualifications: manifest.slots.filter(s => s.kind === 'qualification').map(s => ({ slotKey: s.slotKey, jdId: s.jdId, exactText: s.exactText,
      status: s.conditionSlots.some(c => c.status === 'does_not_meet') ? 'does_not_meet' : s.conditionSlots.every(c => c.status === 'meets') ? 'meets' : 'needs_confirmation',
      conditions: s.conditionSlots.map(c => ({ ...c, explanation: answer(s).conditions.find(a => a.conditionKey === c.conditionKey)!.explanation })),
      explanation: answer(s).explanation, unresolvedConditionKeys: s.conditionSlots.filter(c => c.status === 'needs_confirmation').map(c => c.conditionKey) })),
    coreDuties: manifest.slots.filter(s => s.kind === 'core_duty').map(s => ({ slotKey: s.slotKey, jdId: s.jdId, exactText: s.exactText,
      ...task(s, s.links, answer(s).explanation, answer(s).missingAspects, answer(s)) })),
    preferredItems: manifest.slots.filter(s => s.kind === 'preferred').map(s => ({ slotKey: s.slotKey, jdId: s.jdId, exactText: s.exactText, isHardGate: false,
      sections: s.preferredSections.map(p => { const explanation = answer(s).preferredSections.find(a => a.sectionKey === p.sectionKey)!.explanation;
        const base = { sectionKey: p.sectionKey, exactSourceSpan: p.exactSourceSpan, exactText: p.exactText, kind: p.kind };
        const links = s.links.filter(l => p.linkKeys.includes(l.linkKey));
        return p.kind === 'background' ? { ...base, kind: 'background', backgroundSupport: p.backgroundSupport,
          educationFactRefs: [...new Set(links.map(l => l.factId))], explanation } : { ...base, kind: 'task', ...task(s, links, explanation, answer(s).missingAspects, answer(s)) }; }) })),
    inferences: b.inferences.map(i => ({ ...i, kind: 'ai_inference' })),
    verificationItems: b.verificationAnswers.map(v => { const { required: _required, ...anchor } = manifest.verificationAnchors.find(a => a.verificationKey === v.verificationKey)!;
      return { ...anchor, ...v }; }), resumeSuggestions: b.resumeSuggestions });
}

/** Independent v2 validation, never invokes v1 reportSchema/validateReport or rewrites candidate labels. */
export function validateCompleteReportV2(value: unknown, owner: string, plan: V2Plan, current: V2Material): CompleteReportV2 {
  const r = parseCompleteReportV2(value), m = compileReportV2Manifest(owner, plan, current);
  if (r.manifestDigest !== m.digest) rejectV2('MANIFEST');
  for (const [kind, rows] of [['qualification', r.qualifications], ['core_duty', r.coreDuties], ['preferred', r.preferredItems]] as const) {
    coverage(rows.map(s => s.slotKey), m.slots.filter(s => s.kind === kind).map(s => s.slotKey));
    for (const row of rows) { const s = m.slots.find(s => s.slotKey === row.slotKey)!;
      if (row.jdId !== s.jdId || row.exactText !== s.exactText) rejectV2('REFERENCE'); }
  }
  // Reconstruct only model-owned narrative fields; recomputation below compares every server-owned field.
  const answers = m.slots.map(s => {
    const q = r.qualifications.find(a => a.slotKey === s.slotKey), c = r.coreDuties.find(a => a.slotKey === s.slotKey), p = r.preferredItems.find(a => a.slotKey === s.slotKey);
    const tasks = c ? [c] : p ? p.sections.filter(a => a.kind === 'task') : [];
    return { slotKey: s.slotKey, explanation: q?.explanation ?? c?.explanation ?? p!.sections[0].explanation,
      missingAspects: c?.missingAspects ?? tasks[0]?.missingAspects ?? [],
      links: s.links.map(l => { const stored = tasks.flatMap(t => t.evidenceLinks).find(a => a.linkKey === l.linkKey);
        return { linkKey: l.linkKey, connection: stored?.connection ?? '仅核对资格或背景原句。', boundary: stored?.boundary ?? '不作任务证据。' }; }),
      conditions: q?.conditions.map(a => ({ conditionKey: a.conditionKey, explanation: a.explanation })) ?? [],
      preferredSections: p?.sections.map(a => ({ sectionKey: a.sectionKey, explanation: a.explanation })) ?? [] };
  });
  const { recommendationOnly: _only, ...applicationAction } = r.applicationAction;
  const b: NarrativeBundle = { contractVersion: 'narrative-bundle/2', manifestDigest: m.digest, answers, materialFit: r.materialFit, applicationAction,
    inferences: r.inferences.map(({ kind: _kind, ...i }) => i),
    verificationAnswers: r.verificationItems.map(({ verificationKey, question, reason, askWhomOrHow, answerImpacts }) => ({ verificationKey, question, reason, askWhomOrHow, answerImpacts })),
    resumeSuggestions: r.resumeSuggestions };
  const expected = assembleReportV2(b, m);
  // Different task sections may carry different missing-scope explanations; do not collapse their prose.
  expected.preferredItems.forEach(p => p.sections.forEach(s => { if (s.kind === 'task') {
    const original = r.preferredItems.find(p2 => p2.slotKey === p.slotKey)!.sections.find(s2 => s2.sectionKey === s.sectionKey)!;
    if (original.kind === 'task') s.missingAspects = original.missingAspects;
  } }));
  if (!same(expected, r)) rejectV2('EVIDENCE_BOUNDARY'); return r;
}
export function validateReportV2Record(value: unknown): ReportV2Record {
  const r = parseReportV2Record(value), p = r.provenance, plan = p.planSnapshot, m = plan.material;
  const manifest = compileReportV2Manifest(r.userId, plan, m);
  validateV2JdSnapshot(p.jdConfirmationSnapshot, m);
  if (p.jdText !== m.jdText || !same(p.jdItems, m.requirements)
    || !same(p.profileSnapshot, m.profile) || p.profileVersion !== m.binding.profileVersion || p.planRevision !== plan.revision
    || p.sourceDigest !== manifest.sourceDigest || p.planDigest !== manifest.planDigest || p.slotManifestDigest !== manifest.digest) rejectV2('MANIFEST');
  validateCompleteReportV2(r.report, r.userId, plan, m); return r;
}
/** Local presave port. Real transaction must repeat plan → JD → profile locks/version checks. */
export async function prepareAndSaveReportV2<T>(input: { content: string; finishReason: string; owner: string; plan: V2Plan;
  current: V2Material; jdConfirmationSnapshot: JdDraft; reread: () => Promise<{ plan: V2Plan; material: V2Material; jdConfirmationSnapshot: JdDraft }>;
  save: (report: CompleteReportV2) => Promise<T> }): Promise<T> {
  if (input.finishReason !== 'stop' || !input.content.trim()) return rejectV2('OUTPUT_INCOMPLETE');
  validateV2JdSnapshot(input.jdConfirmationSnapshot, input.current);
  const m = compileReportV2Manifest(input.owner, input.plan, input.current);
  const report = assembleReportV2(parseNarrativeJson(input.content), m);
  validateCompleteReportV2(report, input.owner, input.plan, input.current);
  const latest = await input.reread(); validateV2JdSnapshot(latest.jdConfirmationSnapshot, latest.material);
  const latestManifest = compileReportV2Manifest(input.owner, latest.plan, latest.material);
  if (latestManifest.digest !== m.digest) rejectV2('VERSION_CONFLICT');
  return input.save(structuredClone(report));
}
