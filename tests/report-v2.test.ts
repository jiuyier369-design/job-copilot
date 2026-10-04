import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fictionalCompleteReportV2, fictionalConfirmedV2Plan, fictionalNarrativeV2 } from '../src/fixtures/report-v2-fictional.ts';
import { fictionalId, fictionalV2Material } from '../src/fixtures/evidence-plan-v2-fictional.ts';
import { compileReportV2Manifest, ReportV2Error } from '../src/lib/report-v2/manifest.ts';
import { parseCompleteReportV2, parseNarrativeBundle, parseNarrativeJson, parseReportV2Record } from '../src/lib/report-v2/schema.ts';
import { assembleReportV2, prepareAndSaveReportV2, validateCompleteReportV2, validateReportV2Record } from '../src/lib/report-v2/validate.ts';
import { validateReport, type ReportContext } from '../src/lib/report/validate.ts';
import type { Report } from '../src/types/job-copilot.ts';
import type { CompleteReportV2, NarrativeBundle } from '../src/types/report-v2.ts';
import { confirmedPlanDigest, planSourceDigest, reviewedSources, rowDigest, rowSourceDigest } from '../src/lib/evidence-plan-v2/domain.ts';

test('complete v2 synthetic record covers arbitrary N and all modules; not a slot-answer prototype', () => {
  for (const n of [1, 6, 14, 31]) {
    const s = fictionalCompleteReportV2(n), r = validateReportV2Record(s.record);
    assert.equal(r.report.qualifications.length + r.report.coreDuties.length + r.report.preferredItems.length, n);
    assert.deepEqual(validateCompleteReportV2(s.report, s.owner, s.plan, s.material), s.report);
    assert.ok(r.report.inferences.length); assert.equal(r.report.applicationAction.recommendationOnly, true);
    assert.ok(r.provenance.planSnapshot.confirmation); assert.equal(r.modelMetadata.costEstimate, null);
    assert.notEqual(s.manifest.digest, s.manifest.planDigest);
    assert.throws(() => parseCompleteReportV2({ answers: s.narrative.answers }), ReportV2Error);
  }
});
test('compound qualification date meets, employment remains unknown, and verification is mandatory first', () => {
  const s = fictionalCompleteReportV2(); const q = s.report.qualifications[0];
  assert.equal(q.conditions[0].status, 'meets'); assert.equal(q.conditions[1].status, 'needs_confirmation');
  assert.equal(q.status, 'needs_confirmation'); assert.deepEqual(q.conditions[0].factRefs, ['EDU']);
  assert.deepEqual(q.conditions[1].factRefs, []); assert.equal(s.report.applicationAction.category, 'verify_first');
  assert.equal(s.report.verificationItems[0].conditionKeys[0], q.conditions[1].conditionKey);
  for (const mutate of [(r: CompleteReportV2) => { r.qualifications[0].status = 'meets'; }, (r: CompleteReportV2) => { r.qualifications[0].conditions[1].status = 'meets'; }]) {
    const r = structuredClone(s.report); mutate(r); assert.throws(() => validateCompleteReportV2(r, s.owner, s.plan, s.material), ReportV2Error);
  }
});
test('bounded date reasoning covers both window edges, missing/conflicting dates and outside window', () => {
  for (const [statement, expected] of [['预计2026年9月毕业。', 'meets'], ['预计2027年8月毕业。', 'meets'],
    ['毕业日期待确认。', 'needs_confirmation'], ['预计2027年6月毕业。预计2028年6月毕业。', 'needs_confirmation'],
    ['预计2028年6月毕业。', 'does_not_meet']] as const) {
    const m = fictionalV2Material(); m.profile.facts[0].statement = statement;
    const s = fictionalConfirmedV2Plan(6, m), manifest = compileReportV2Manifest(s.owner, s.plan, s.material);
    assert.equal(manifest.slots[0].conditionSlots[0].status, expected);
    const r = assembleReportV2(fictionalNarrativeV2(manifest), manifest);
    assert.equal(r.qualifications[0].status, expected === 'does_not_meet' ? 'does_not_meet' : 'needs_confirmation');
  }
});
test('preferred education and mixed sections stay separate from qualifications and task labels', () => {
  const s = fictionalCompleteReportV2(6), p = s.report.preferredItems;
  assert.equal(p[0].isHardGate, false); assert.equal(p[0].sections[0].kind, 'background');
  if (p[0].sections[0].kind === 'background') { assert.equal(p[0].sections[0].backgroundSupport, 'supported'); assert.deepEqual(p[0].sections[0].educationFactRefs, ['EDU']); }
  assert.deepEqual(p[1].sections.map(s => s.kind), ['background', 'task']);
  if (p[1].sections[1].kind === 'task') assert.equal(p[1].sections[1].evidenceType, 'personal_practice');
  const m = fictionalV2Material(); m.profile.facts[0].statement = '预计2027年6月毕业。专业尚未确认。';
  const c = fictionalConfirmedV2Plan(6, m), manifest = compileReportV2Manifest(c.owner, c.plan, c.material);
  assert.equal(manifest.slots[3].preferredSections[0].backgroundSupport, 'needs_confirmation');
  m.profile.facts[0].statement = '预计2027年6月毕业。明确非计算机相关专业。';
  const negative = fictionalConfirmedV2Plan(6, m), nm = compileReportV2Manifest(negative.owner, negative.plan, negative.material);
  assert.equal(nm.slots[3].preferredSections[0].backgroundSupport, 'not_supported');
  assert.equal(nm.allowedActions.includes('explicit_hard_gate'), false);
});
test('zero omission/duplicate/extra/cross-slot answer, link, condition and preferred-section coverage', () => {
  const edits: ((b: NarrativeBundle) => void)[] = [b => { b.answers.pop(); }, b => { b.answers[1] = b.answers[0]; },
    b => { b.answers.push({ ...b.answers[0], slotKey: 'invented' }); }, b => { b.answers[1].links = b.answers[5].links; },
    b => { b.answers[0].conditions.pop(); }, b => { b.answers[0].conditions.push(b.answers[0].conditions[0]); },
    b => { b.answers[4].preferredSections.pop(); }, b => { b.answers[4].preferredSections[0].sectionKey = 'invented'; },
    b => { b.answers[1].links.push(b.answers[1].links[0]); }];
  for (const edit of edits) { const s = fictionalCompleteReportV2(6), b = structuredClone(s.narrative); edit(b);
    assert.throws(() => assembleReportV2(b, s.manifest), ReportV2Error); }
  const s = fictionalCompleteReportV2(6); s.narrative.answers.reverse();
  assert.deepEqual(assembleReportV2(s.narrative, s.manifest), s.report); // keyed lookup, never positional zip
});
test('server-controlled labels/scenes/quotes/JD and background status cannot be forged', () => {
  for (const edit of [r => { r.coreDuties[0].evidenceType = 'same_task'; },
    r => { r.coreDuties[0].evidenceLinks[0].evidenceType = 'transferable'; },
    r => { r.coreDuties[0].evidenceLinks[0].scene = 'formal_work'; }, r => { r.coreDuties[0].evidenceLinks[0].factId = 'EDU'; },
    r => { r.coreDuties[0].evidenceLinks[0].exactQuote = 'fabricated'; }, r => { r.coreDuties[0].evidenceLinks[0].start++; },
    r => { r.coreDuties[0].jdId = 'R3'; }, r => { r.coreDuties[0].exactText = 'fabricated'; },
    r => { r.coreDuties[0].evidenceLinks = []; r.coreDuties[0].evidenceType = 'no_evidence'; },
    r => { r.coreDuties[1].evidenceType = 'personal_practice'; },
    r => { if (r.preferredItems[0].sections[0].kind === 'background') r.preferredItems[0].sections[0].educationFactRefs = ['PROJECT']; },
  ] satisfies ((r: CompleteReportV2) => void)[]) {
    const s = fictionalCompleteReportV2(6); edit(s.report);
    assert.throws(() => validateCompleteReportV2(s.report, s.owner, s.plan, s.material), ReportV2Error);
  }
});
test('model cannot submit status, labels, evidence snapshots or configuration in narrative', () => {
  const s = fictionalCompleteReportV2();
  for (const extra of [{ provider: 'x' }, { model: 'x' }, { userId: 'x' }, { reportStructureVersion: '2.0.0' }])
    assert.throws(() => parseNarrativeBundle({ ...s.narrative, ...extra }), ReportV2Error);
  assert.throws(() => parseNarrativeBundle({ ...s.narrative, answers: [{ ...s.narrative.answers[0], status: 'meets' }] }), ReportV2Error);
});
test('overview/action/inference/verification/resume references must be permitted, unique and supported', () => {
  for (const edit of [b => { b.materialFit.supportingSlotKeys = ['invented']; }, b => { b.materialFit.supportingSlotKeys = ['slot/JD3']; },
    b => { b.materialFit.limitingSlotKeys.push(b.materialFit.limitingSlotKeys[0]); }, b => { b.inferences[0].basisSlotKeys = []; },
    b => { b.inferences[0].inferenceKey = 'invented'; }, b => { b.verificationAnswers.shift(); },
    b => { b.verificationAnswers[0].answerImpacts = ['one']; }, b => { b.applicationAction.verificationKeys = []; },
    b => { b.applicationAction.category = 'explicit_hard_gate'; }, b => { b.resumeSuggestions[0].basisLinkKeys = []; },
    b => { b.resumeSuggestions[0].basisLinkKeys = ['invented']; }, b => { b.verificationAnswers[0].verificationKey = 'invented'; },
  ] satisfies ((b: NarrativeBundle) => void)[]) { const s = fictionalCompleteReportV2(6); edit(s.narrative);
    assert.throws(() => assembleReportV2(s.narrative, s.manifest), ReportV2Error); }
});
test('bounded r22/r24/r25 semantic regressions reject gates, blanket denial, invented metrics and upgraded prose', () => {
  for (const edit of [b => { b.materialFit.summary = '完全没有相关个人实践。'; },
    b => { b.applicationAction.summary = '专业不对口构成硬门槛，不能投递。'; }, b => { b.applicationAction.summary = '缺少实习因此不能投递。'; },
    b => { b.verificationAnswers[0].question = '核验全日制资格。'; }, b => { b.answers[4].explanation = '必须有企业项目。'; },
    b => { b.resumeSuggestions[0].suggestedWording = '提升产品转化率99%。'; },
    b => { b.resumeSuggestions[0].suggestedWording = '完成商业化验证。'; },
    b => { b.answers[1].links[0].connection = '已完成企业上线。'; },
    b => { b.applicationAction.summary = '已确认在招。'; },
    b => { b.answers[0].conditions[0].explanation = '毕业日期需确认。'; },
  ] satisfies ((b: NarrativeBundle) => void)[]) { const s = fictionalCompleteReportV2(6); edit(s.narrative);
    assert.throws(() => assembleReportV2(s.narrative, s.manifest), ReportV2Error); }
  const s = fictionalCompleteReportV2(6); s.narrative.answers[1].missingAspects = ['缺少正式企业环境的用户验证与上线交付证据。'];
  assert.doesNotThrow(() => assembleReportV2(s.narrative, s.manifest));
});
test('knowledge workflow selected as metrics evidence is rejected even with valid personal_practice label', () => {
  const c = fictionalConfirmedV2Plan(6, fictionalV2Material(6));
  const row = c.plan.rows[2], fact = c.material.profile.facts.find(f => f.factId === 'KNOWLEDGE')!;
  row.sources = reviewedSources(c.material, row.jdId, [{ factId: fact.factId, start: 0, end: fact.statement.length, evidenceType: 'personal_practice', sectionKey: null }]);
  row.choice = 'limited_support'; row.existingAction = row.sources.map(s => s.quote).join('；');
  row.confirmation = { ...row.confirmation!, rowDigest: rowDigest(row), rowSourceDigest: rowSourceDigest(row) };
  c.plan.confirmation = { revision: c.plan.revision, sourceDigest: planSourceDigest(c.plan), planDigest: confirmedPlanDigest(c.plan) };
  assert.throws(() => compileReportV2Manifest(c.owner, c.plan, c.material), { code: 'EVIDENCE_BOUNDARY' });
});
test('strict JSON/version/size parsing, missing metadata usage stays unknown instead of zero cost', () => {
  const s = fictionalCompleteReportV2(6);
  for (const input of ['', 'not json', '{}', 'null']) assert.throws(() => parseNarrativeJson(input), ReportV2Error);
  assert.throws(() => parseNarrativeBundle({ ...s.narrative, materialFit: { ...s.narrative.materialFit, summary: 'x'.repeat(4001) } }), ReportV2Error);
  const absent = parseReportV2Record(s.record); assert.equal(absent.modelMetadata.costEstimate, null);
  for (const edit of [r => { r.modelMetadata.costEstimate = { currency: 'CNY', amount: 0 }; }, r => { r.modelMetadata.inputTokens = 10; },
    r => { r.modelMetadata.inputTokens = 10; r.modelMetadata.outputTokens = 2; r.modelMetadata.totalTokens = 13; },
    r => { r.versions = { ...r.versions, reportStructureVersion: '1.0.0' as '2.0.0' }; },
    r => { r.provenance.jdConfirmationSnapshot.revision++; }, r => { r.provenance.profileSnapshot.facts[0].statement = 'invented'; },
    r => { r.provenance.planSnapshot.ownerId = fictionalId(999); },
  ] satisfies ((r: typeof s.record) => void)[]) { const r = structuredClone(s.record); edit(r); assert.throws(() => validateReportV2Record(r), ReportV2Error); }
  const r = structuredClone(s.record); Object.assign(r.modelMetadata, { inputTokens: 10, outputTokens: 2, totalTokens: 12,
    costEstimate: { currency: 'CNY', amount: 0.001 }, pricingVersion: 'mock-only' }); assert.doesNotThrow(() => validateReportV2Record(r));
});
test('presave rejects bad output, stale material/plan, truncation and boundaries with zero writes', async () => {
  const s = fictionalCompleteReportV2(6); let writes = 0;
  const base = { content: JSON.stringify(s.narrative), finishReason: 'stop', owner: s.owner, plan: s.plan, current: s.material,
    jdConfirmationSnapshot: s.draft, reread: async () => ({ plan: s.plan, material: s.material, jdConfirmationSnapshot: s.draft }), save: async () => { writes++; return 'saved'; } };
  for (const override of [{ finishReason: 'length' }, { content: '' }, { content: '{}' },
    { content: JSON.stringify({ ...s.narrative, manifestDigest: 'wrong' }) },
    { reread: async () => ({ plan: { ...s.plan, confirmation: null }, material: s.material, jdConfirmationSnapshot: s.draft }) },
    { reread: async () => ({ plan: s.plan, material: { ...s.material, binding: { ...s.material.binding, profileVersion: 3 } }, jdConfirmationSnapshot: s.draft }) },
  ]) await assert.rejects(prepareAndSaveReportV2({ ...base, ...override }), ReportV2Error);
  assert.equal(writes, 0); assert.equal(await prepareAndSaveReportV2(base), 'saved'); assert.equal(writes, 1);
  assert.equal(s.report.reportStructureVersion, '2.0.0');
});
test('manifest rejects unconfirmed/foreign/changed plan and material rather than trusting supplied digests', () => {
  const s = fictionalCompleteReportV2(6);
  for (const p of [{ ...s.plan, confirmation: null }, { ...s.plan, revision: s.plan.revision + 1 },
    { ...s.plan, ownerId: fictionalId(1) }, { ...s.plan, materialDigest: 'wrong' }])
    assert.throws(() => compileReportV2Manifest(s.owner, p, s.material), ReportV2Error);
});

test('fixed safe categories contain no candidate strings, raw errors or console logging', () => {
  const s = fictionalCompleteReportV2(6); s.narrative.answers[0].slotKey = 'SENSITIVE_PRIVATE_MATERIAL';
  let safe: string | undefined;
  try { assembleReportV2(s.narrative, s.manifest); } catch (e) { assert.ok(e instanceof ReportV2Error); safe = JSON.stringify({ code: e.code, message: e.message }); }
  assert.ok(safe); assert.equal(safe.includes('SENSITIVE'), false);
  for (const file of ['manifest.ts', 'schema.ts', 'validate.ts']) assert.equal(/console\.|\bfetch\(/.test(readFileSync(new URL(`../src/lib/report-v2/${file}`, import.meta.url), 'utf8')), false);
});
