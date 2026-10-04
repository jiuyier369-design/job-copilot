import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Report, QualificationStatus } from '../src/types/job-copilot.ts';
import type { ReportContext } from '../src/lib/report/validate.ts';
import { validateReport } from '../src/lib/report/validate.ts';
import { graduationChecks } from '../src/lib/report/graduation.ts';
import { validateGeneratedReport } from '../src/lib/report/validate-generated.ts';
import { buildModelInput } from '../src/lib/report/model-input.ts';
import { a2Diagnostic, COVERAGE_RULE_CATEGORIES, REFERENCE_RULE_CATEGORIES } from '../src/lib/report/diagnostics.ts';
import { createDeepSeekModel } from '../src/lib/analysis/deepseek.ts';
import { mockDeepSeekEnv, deepSeekEnvelope } from './helpers/deepseek-generation.ts';
import { asyncFixture } from './helpers/async-analysis.ts';
import { enqueueAnalysis } from '../src/lib/analysis/async.ts';
import { consumeAnalysisOnce } from '../src/lib/analysis/worker.ts';
import { transitionDraft } from '../src/lib/jd/transition.ts';
import { draftDigest } from '../src/lib/jd/service.ts';

function context(statement = '预计2027年6月毕业。', requirement = '毕业时间为2026年9月至2027年8月。'): ReportContext {
  return { jdText: requirement, jdItems: [{ jdId: 'Q', kind: 'qualification', exactText: requirement }],
    profile: { structureVersion: '1.0.0', targetDirections: [], facts: [{ factId: 'E', category: 'education', context: 'education', statement }] } };
}
function report(status: QualificationStatus = 'meets'): Report {
  return { materialFit: { level: 'partial', summary: '仅评价毕业窗口。', supportingJdIds: ['Q'], limitingJdIds: [] },
    applicationAction: { category: 'try_with_weak_evidence', summary: '日期适配不等于优先投递。', verificationItemIndexes: [] },
    qualifications: [{ jdId: 'Q', status, factIds: ['E'], explanation: '按画像预计毕业时间满足日期窗口，仍保留预计性质。' }],
    coreDuties: [], preferredItems: [], inferences: [], resumeSuggestions: [], verificationItems: [] };
}
for (const [date, expected] of [['2027年6月','meets'], ['2026年9月','meets'], ['2027年8月','meets'],
  ['2026年8月','does_not_meet'], ['2027年9月','does_not_meet']] as const) {
  test(`graduation window includes its boundary months: ${date}`, () => {
    const c = context(`预计${date}毕业。`), before = JSON.stringify(c);
    assert.equal(graduationChecks(c)[0].dateStatus, expected);
    const r=report(expected);if(expected==='does_not_meet')r.qualifications[0].explanation='按画像预计毕业时间不满足该窗口。';
    assert.equal(validateGeneratedReport(r, c).qualifications[0].status, expected);
    assert.equal(JSON.stringify(c), before);
  });
}
for (const statement of ['2027届本科。', '毕业日期待确认。', '预计2027年13月毕业。', '可能2027年6月毕业。',
  '预计2027年6月或2027年9月毕业。', '2025年9月入学，毕业待确认。']) {
  test(`missing/ambiguous/invalid graduation date is not guessed: ${statement}`, () => {
    const c = context(statement); assert.equal(graduationChecks(c)[0].dateStatus, 'needs_confirmation');
    assert.doesNotThrow(() => validateGeneratedReport(report('needs_confirmation'), c));
    assert.throws(() => validateGeneratedReport(report('meets'), c));
  });
}
test('different dates/degrees are ambiguous; unrelated enrollment is not a graduation date', () => {
  const c = context('本科预计2027年6月毕业。');
  c.profile.facts.push({ factId: 'E2', category: 'education', context: 'education', statement: '硕士预计2028年6月毕业。' });
  assert.equal(graduationChecks(c)[0].dateStatus, 'needs_confirmation');
  assert.equal(graduationChecks(context('2023年9月入学，预计2027年6月毕业。'))[0].dateStatus, 'meets');
  assert.equal(graduationChecks(context('预计2027年2月30日毕业。'))[0].dateStatus, 'needs_confirmation');
});
test('month-only date cannot resolve a partially overlapping exact-day window', () => {
  const c = context('预计2027年6月毕业。', '毕业日期为2027年6月15日至2027年6月30日。');
  assert.equal(graduationChecks(c)[0].dateStatus, 'needs_confirmation');
  assert.equal(graduationChecks(context('预计2027年6月20日毕业。', c.jdText))[0].dateStatus, 'meets');
});
test('ISO dates, graduation-first syntax and full exact-date bounds are supported', () => {
  assert.equal(graduationChecks(context('毕业时间预计为2027-06。', '毕业时间：2026-09至2027-08。'))[0].dateStatus, 'meets');
  assert.equal(graduationChecks(context('毕业日期：2027/06/20。', '毕业日期为2027/06/01至2027/06/30。'))[0].dateStatus, 'meets');
});
test('compound condition acknowledges the date without confirming unproved employment/degree conditions', () => {
  const c = context(undefined, '毕业时间为2026年9月至2027年8月，且毕业后没有全职工作经历。');
  const check = graduationChecks(c)[0]; assert.equal(check.dateStatus, 'meets'); assert.equal(check.requiredOverallStatus, null);
  assert.throws(() => validateGeneratedReport(report('meets'), c));
  const r = report('needs_confirmation'); r.qualifications[0].explanation = '预计毕业时间满足窗口；毕业后的全职经历条件需用户确认。';
  r.applicationAction={category:'verify_first',summary:'先核验毕业后全职经历这一未知资格。',verificationItemIndexes:[0]};
  r.verificationItems=[{jdIds:['Q'],question:'毕业后有无全职经历？',reason:'影响校招资格。',askWhomOrHow:'询问本人并核对招聘口径。',
    answerImpacts:['如有需核对资格。','如无可继续判断。']}];
  assert.doesNotThrow(() => validateGeneratedReport(r, c));
  r.qualifications[0].explanation = '毕业时间尚未明确，需确认。'; assert.throws(() => validateGeneratedReport(r, c));
});
test('new date guard detects r22-style mistaken confirmation but historical A2 still reads it unchanged', () => {
  const c = context(), r = report('needs_confirmation'); r.qualifications[0].explanation = '画像未明确毕业区间，因此需要确认。';
  const before = JSON.stringify(r); assert.equal(validateReport(r, c), r);
  assert.throws(() => validateGeneratedReport(r, c)); assert.equal(JSON.stringify(r), before);
  const wrongRefs = report(); wrongRefs.qualifications[0].factIds = [];
  assert.throws(() => validateGeneratedReport(wrongRefs, c));
});
test('date-only status and explanation cannot contradict a reliably outside-window date',()=>{
  const c=context('预计2028年6月毕业。');
  assert.throws(()=>validateGeneratedReport(report('does_not_meet'),c));
  const r=report('does_not_meet');r.qualifications[0].explanation='毕业时间不符合窗口。';
  assert.doesNotThrow(()=>validateGeneratedReport(r,c));
  r.qualifications[0].explanation='毕业时间未能完全满足窗口。';assert.doesNotThrow(()=>validateGeneratedReport(r,c));
});
test('only qualification windows apply, and only graduation education facts count', () => {
  const c = context(); c.jdItems[0].kind = 'preferred'; assert.deepEqual(graduationChecks(c), []);
  c.jdItems[0].kind = 'qualification'; c.profile.facts[0].category = 'project';
  assert.equal(graduationChecks(c)[0].dateStatus, 'needs_confirmation');
  assert.deepEqual(graduationChecks(context(undefined, '本科毕业。')), []);
});
test('server input contains derived facts but model output cannot override recomputed conclusions', async () => {
  const c = context(), input = buildModelInput(c), data = JSON.parse(input.data);
  assert.equal(data.serverGraduationChecks[0].dateStatus, 'meets');
  data.serverGraduationChecks[0].requiredOverallStatus = 'needs_confirmation'; input.data = JSON.stringify(data);
  const events: unknown[] = [], model = createDeepSeekModel(mockDeepSeekEnv,
    async () => Response.json(deepSeekEnvelope(report('needs_confirmation'))), undefined, false, e => events.push(e));
  await assert.rejects(model.generate(input, 'mock', new AbortController().signal), { category: 'A2_INVALID' });
  assert.equal((events[0] as ReturnType<typeof a2Diagnostic>).counts.OTHER, 1);
  assert.deepEqual(events, [{ diagnosticVersion: 2, coverageCounts: Object.fromEntries(COVERAGE_RULE_CATEGORIES.map(k=>[k,0])), referenceCounts: Object.fromEntries(REFERENCE_RULE_CATEGORIES.map(k=>[k,0])), event: 'analysis-a2-invalid', counts: { JD_COVERAGE: 0, REFERENCE: 0, EVIDENCE_TYPE: 0,
    VERIFICATION: 0, RESUME_WORDING: 0, OTHER: 1 }, evidenceCounts: { LABEL_LINK_CONFLICT: 0, OVERALL_LABEL_NO_MATCH: 0,
    EDUCATION_AS_TASK_EVIDENCE: 0, PERSONAL_PRACTICE_UPGRADED: 0 } }]);
  for (const privateValue of [c.jdText,c.profile.facts[0].statement,'"jdId"','"factIds"'])
    assert.ok(!JSON.stringify(events).includes(privateValue));
});
test('negated/alternative JD windows are outside the limited positive-window rule', () => {
  assert.deepEqual(graduationChecks(context(undefined, '毕业日期不在2026年9月至2027年8月。')), []);
  assert.deepEqual(graduationChecks(context(undefined, '毕业日期为2026年9月至2027年8月或2028年6月。')), []);
  assert.equal(graduationChecks(context('不是2027年6月毕业。'))[0].dateStatus, 'needs_confirmation');
});

for (const valid of [true, false]) test(`Worker date guard ${valid ? 'saves valid output' : 'rejects wrong status'}; replay and redelivery never call twice`, async () => {
  const x = asyncFixture(), rawText = '岗位职责\n核对客户需求。\n任职要求\n毕业时间为2026年9月至2027年8月。';
  const options = { id: x.request.draftId, now: '2026-10-03T00:00:00Z', digest: draftDigest };
  const initial = transitionDraft(null, { action: 'create', rawText }, options)!;
  const draft = transitionDraft(initial, { action: 'confirm', id: initial.id, expectedRevision: 1, acknowledged: true }, options)!;
  x.request.expectedDraftRevision = draft.revision; x.ports.drafts.load = async () => structuredClone(draft);
  x.profile.facts.push(...context().profile.facts);
  const r = structuredClone(x.report); r.qualifications[0] = { jdId: 'JD4', status: valid ? 'meets' : 'needs_confirmation', factIds: ['E'], explanation: '按预计日期核对。' };
  let calls = 0; x.worker.model = async () => { calls++; return structuredClone(r); };
  await enqueueAnalysis('A', x.request, x.admission);
  assert.equal(await consumeAnalysisOnce(x.worker), valid ? 'completed' : 'failed');
  assert.equal(x.writes(), valid ? 1 : 0);
  const replay = await enqueueAnalysis('A', x.request, x.admission); assert.equal(replay.status, valid ? 'completed' : 'failed');
  if (!valid) assert.equal(replay.failureCode, 'REPORT_INVALID');
  x.jobs[0].archived = false; await consumeAnalysisOnce(x.worker); assert.equal(calls, 1);
});
