import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceLink, Report } from '../src/types/job-copilot.ts';
import { validateReport, validateThenSave, type ReportContext } from '../src/lib/report/validate.ts';
import { ReportValidationError, a2Diagnostic } from '../src/lib/report/diagnostics.ts';
import { asyncFixture } from './helpers/async-analysis.ts';
import { mockDeepSeekEnv, deepSeekEnvelope } from './helpers/deepseek-generation.ts';
import { createWorkerModel } from '../src/lib/analysis/worker-model.ts';
import { enqueueAnalysis } from '../src/lib/analysis/async.ts';
import { consumeAnalysisOnce } from '../src/lib/analysis/worker.ts';
import { DEEPSEEK_PROMPT_VERSION } from '../src/lib/analysis/deepseek-prompt.ts';
import { safeDeepSeekAcceptance } from '../scripts/deepseek-async-tools.mjs';

// Purely fictional, minimal evidence relationships. No corpus, network or label repair.
const context: ReportContext = {
  jdText: '核对需求并形成方案。',
  jdItems: [{ jdId: 'J1', kind: 'core_duty', exactText: '核对需求并形成方案。' }],
  profile: { structureVersion: '1.0.0', targetDirections: [], facts: [
    { factId: 'P1', category: 'project', context: 'personal_project', statement: '虚构个人项目：整理访谈记录并形成需求清单。' },
    { factId: 'P2', category: 'work', context: 'formal_work', statement: '虚构工作经历：按既定模板核对客户需求。' },
  ] },
};
const personal = (): EvidenceLink => ({ evidenceType: 'personal_practice', factIds: ['P1'],
  connection: '个人项目中整理需求，有限支持需求梳理。', boundary: '个人项目场景，不能证明企业交付或商业结果。' });
const formal = (): EvidenceLink => ({ evidenceType: 'same_task', factIds: ['P2'],
  connection: '工作中执行过需求核对任务。', boundary: '仅按模板核对，不证明独立方案设计或全流程交付。' });
function report(type: Report['coreDuties'][number]['evidenceType'], links: EvidenceLink[]): Report {
  return {
    materialFit: { level: 'partial', summary: '有有限任务支持，完整方案交付仍缺证据。', supportingJdIds: ['J1'], limitingJdIds: ['J1'] },
    applicationAction: { category: 'try_with_weak_evidence', summary: '可结合缺口由用户决定是否尝试。', verificationItemIndexes: [] },
    qualifications: [], coreDuties: [{ jdId: 'J1', evidenceType: type, evidenceLinks: links,
      missingAspects: ['完整方案交付暂无证据。'], needsUserConfirmation: true, explanation: '逐条链接分别表达场景和边界。' }],
    preferredItems: [], inferences: [], resumeSuggestions: [], verificationItems: [],
  };
}
function rejected(candidate: Report, rule: 'PERSONAL_PRACTICE_UPGRADED' | 'OVERALL_LABEL_NO_MATCH') {
  assert.throws(() => validateReport(candidate, context), error => {
    assert.ok(error instanceof ReportValidationError);
    const event = a2Diagnostic(error);
    assert.equal(event.counts.EVIDENCE_TYPE, 1);
    assert.equal(event.evidenceCounts[rule], 1);
    assert.equal(Object.values(event.evidenceCounts).reduce((sum, n) => sum + n, 0), 1);
    return true;
  });
}
test('personal-only evidence passes as personal_practice without mutating labels or source facts', () => {
  const candidate = report('personal_practice', [personal()]), before = JSON.stringify({ candidate, context });
  assert.equal(validateReport(candidate, context), candidate);
  assert.equal(JSON.stringify({ candidate, context }), before);
});
for (const upgraded of ['same_task', 'transferable'] as const) {
  test(`personal fact linked as ${upgraded} is rejected even when the overall label matches`, () => {
    const link = personal(); link.evidenceType = upgraded;
    rejected(report(upgraded, [link]), 'PERSONAL_PRACTICE_UPGRADED');
  });
}
for (const overall of ['same_task', 'personal_practice'] as const) {
  test(`mixed personal/work facts pass in separate links with matching ${overall} overall label`, () => {
    const candidate = report(overall, [personal(), formal()]), before = JSON.stringify(candidate);
    assert.equal(validateReport(candidate, context), candidate);
    assert.equal(JSON.stringify(candidate), before);
  });
}
test('merging personal/work facts into one same_task link does not hide a personal-practice upgrade', () => {
  const link = formal(); link.factIds = ['P2', 'P1'];
  rejected(report('same_task', [link]), 'PERSONAL_PRACTICE_UPGRADED');
});
test('a stronger overall label cannot replace its missing matching link', () => {
  rejected(report('transferable', [personal(), formal()]), 'OVERALL_LABEL_NO_MATCH');
  // The overall same_task label is valid only because a separate same_task work link exists.
  const candidate = report('same_task', [personal()]);
  rejected(candidate, 'OVERALL_LABEL_NO_MATCH');
});
test('valid mixed report is saved unchanged; rejected upgrade never reaches persistence', async () => {
  let writes = 0;
  const valid = report('same_task', [personal(), formal()]);
  await validateThenSave(valid, context, async value => { writes++; assert.equal(value, valid); });
  const link = formal(); link.factIds.push('P1');
  await assert.rejects(validateThenSave(report('same_task', [link]), context, async () => { writes++; }));
  assert.equal(writes, 1);
});
for (const upgraded of [false, true]) {
  test(`mock v1.2 Worker ${upgraded ? 'rejects merged upgraded' : 'preserves separate mixed'} links, replay never calls twice`, async () => {
    const x = asyncFixture(); x.profile.facts.push(structuredClone(context.profile.facts[1]));
    const candidate = structuredClone(x.report), task = candidate.coreDuties[0];
    task.evidenceType = 'same_task'; task.evidenceLinks = [personal(), formal()];
    if (upgraded) task.evidenceLinks = [{ ...formal(), factIds: ['P2', 'P1'] }];
    const before = JSON.stringify(candidate); let calls = 0;
    const model = createWorkerModel({ ...mockDeepSeekEnv, ANALYSIS_WORKER_MODEL_TIMEOUT_MS: '45000',
      ANALYSIS_USD_TO_CNY: '8', ANALYSIS_MAX_CALL_CNY: '1' }, async (_url, options) => {
      calls++; const body = JSON.parse(String(options?.body));
      assert.ok(body.messages[0].content.includes('按事实类型分开链接'));
      return Response.json({ ...deepSeekEnvelope(candidate), model: 'deepseek-flash' });
    });
    x.admission.metadata = model.metadata;
    const queue = { ...x.worker.queue, context: async (...args: Parameters<typeof x.worker.queue.context>) =>
      ({ ...await x.worker.queue.context(...args), metadata: model.metadata }) };
    await enqueueAnalysis('A', x.request, x.admission);
    assert.equal(await consumeAnalysisOnce({ ...model, queue }), upgraded ? 'failed' : 'completed');
    assert.equal(x.writes(), upgraded ? 0 : 1);
    const replay = await enqueueAnalysis('A', x.request, x.admission);
    assert.equal(replay.status, upgraded ? 'failed' : 'completed');
    x.jobs[0].archived = false; await consumeAnalysisOnce({ ...model, queue });
    assert.equal(calls, 1); assert.equal(JSON.stringify(candidate), before);
    assert.equal(model.metadata.promptVersion, DEEPSEEK_PROMPT_VERSION);
  });
}
test('safe metadata accepts current v1.4 without dropping earlier versions or admitting raw strings', () => {
  for (const version of ['job-copilot-deepseek-v1', 'job-copilot-deepseek-v1.1', 'job-copilot-deepseek-v1.2','job-copilot-deepseek-v1.3', DEEPSEEK_PROMPT_VERSION])
    assert.deepEqual(safeDeepSeekAcceptance({ promptVersion: version }), { promptVersion: version });
  assert.deepEqual(safeDeepSeekAcceptance({ promptVersion: 'PRIVATE_SOURCE_NOT_A_VERSION' }), {});
});
